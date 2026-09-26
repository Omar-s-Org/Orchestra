// The slim MCP responses must not lose information: everything the REST API (the source of truth the UI
// uses) returns is still reachable by an agent, under exactly the same permissions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { compact } from "../src/mcp-view.js";
import { runSim } from "../sim/sim.js";

const LUMEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../projects/lumen.json");
let server: Server; let base: string;
const PEOPLE = [["layla", "pm"], ["sara", "senior"], ["tom", "senior"], ["priya", "junior"], ["mia", "junior"]] as const;

beforeAll(async () => {
  const db = openDb(":memory:"); reset(db, LUMEN);
  server = createApp(db).listen(0); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // Give tasks real history, artifacts and mentions first.
  await runSim({ baseUrl: base, projectFile: LUMEN, speed: 0, log: () => {} });
}, 30_000);
afterAll(() => server.close());

async function as(id: string) {
  const token = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${id}@lumen.test`, password: "demo1234" }) })).json()).token as string;
  const rest = async (p: string) => { const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
  const client = new Client({ name: "accuracy", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ak_${id}` } } }));
  const mcp = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError ? r.content[0].text : null, body: r.isError ? null : JSON.parse(r.content[0].text) };
  };
  return { rest, mcp, close: () => client.close() };
}
/** REST data as MCP encodes it (nulls and empty values dropped). */
const asMcp = (v: unknown) => JSON.parse(compact(v));

describe("slim MCP keeps 100% of the information, with the same permissions", () => {
  for (const [id, role] of PEOPLE) {
    it(`${id} (${role}): get_task include:all equals the REST task detail for every task`, async () => {
      const u = await as(id);
      const all = (await u.rest("/api/tasks")).body as { id: string }[];
      const ids = Array.from({ length: 17 }, (_, i) => `T-${i + 1}`);
      for (const tid of ids) {
        const m = await u.mcp("get_task", { task_id: tid, include: ["all"], history_limit: 0 });
        const r = await u.rest(`/api/tasks/${tid}`);
        if (r.status === 404) { expect(m.error).toMatch(/^NotFound \(404\)/); continue; }  // invisible stays invisible
        expect(m.body).toEqual(asMcp(r.body));
      }
      // The board shows exactly the tasks REST shows, in the same order and states.
      const board = (await u.mcp("team_board")).body as { id: string; status: string; locked?: boolean }[];
      expect(board.map(t => [t.id, t.status, !!t.locked])).toEqual((all as any[]).map(t => [t.id, t.status, t.locked]));
      // Knowledge base: same docs, same clearance.
      const kb = (await u.mcp("search_kb")).body as { id: string }[];
      expect(kb.map(d => d.id)).toEqual(((await u.rest("/api/kb")).body as { id: string }[]).map(d => d.id));
      await u.close();
    }, 30_000);
  }

  it("an empty result is still valid JSON", async () => {
    const u = await as("mia");
    expect((await u.mcp("team_board", { status: "review", department: "Nowhere" })).body).toEqual([]);
    expect((await u.mcp("search_kb", { query: "zzz-no-such-doc" })).body).toEqual([]);
    await u.close();
  });

  it("next_task inlines only docs the person is cleared to read", async () => {
    const seen = { inlined: 0, restricted: 0 };
    for (const id of ["priya", "sara"]) {
      const u = await as(id);
      for (const t of (await u.rest("/api/tasks")).body as { id: string }[]) {
        for (const d of (await u.mcp("next_task", { task_id: t.id })).body.task.docs ?? []) {
          const r = await u.rest(`/api/kb/${d.id}`);
          if (r.status === 403) { expect(d.restricted).toBe(true); expect(d.body).toBeUndefined(); seen.restricted++; }
          else { expect(r.body.body.startsWith(d.body)).toBe(true); expect(!!d.truncated).toBe(r.body.body.length > d.body.length); seen.inlined++; }
        }
      }
      await u.close();
    }
    expect(seen.inlined).toBeGreaterThan(0);
    expect(seen.restricted).toBeGreaterThan(0);
  });
});
