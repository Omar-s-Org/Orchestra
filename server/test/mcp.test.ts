import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";

let server: Server; let base: string;
beforeAll(async () => {
  const db = openDb(":memory:"); reset(db);
  server = createApp(db).listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

async function agent(token: string) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}
const text = (r: any) => r.content[0].text as string;

describe("MCP agent flow", () => {
  it("Omar's agent works T-57: reads task, updates status, cannot close it", async () => {
    const a = await agent("tok_omar");
    const tools = (await a.listTools()).tools.map(t => t.name);
    expect(tools).toContain("update_task_status");
    const t = JSON.parse(text(await a.callTool({ name: "get_task", arguments: { task_id: "T-57" } })));
    expect(t.scope.people.map((p: any) => p.id)).toEqual(expect.arrayContaining(["tom", "nadia", "mia"]));
    const upd = await a.callTool({ name: "update_task_status", arguments: { task_id: "T-58", status: "review", note: "Done: 5 pain points" } });
    expect(JSON.parse(text(upd)).status).toBe("review");
    const denied = await a.callTool({ name: "update_task_status", arguments: { task_id: "T-58", status: "done" } });
    expect(denied.isError).toBe(true);
    const doc = await a.callTool({ name: "read_document", arguments: { document_id: "D-5" } });
    expect(doc.isError).toBe(true);
    await a.close();
  });
  it("rejects missing token", async () => {
    await expect(agent("nope")).rejects.toThrow();
  });
  it("REST shows the agent's work to the manager in the audit log", async () => {
    const r = await fetch(`${base}/api/audit`, { headers: { Authorization: "Bearer tok_karim" } });
    const rows = await r.json();
    expect(rows.some((x: any) => x.via === "agent" && x.actor_id === "omar")).toBe(true);
  });
});
