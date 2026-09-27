import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { resetDemoState } from "../src/demo-runner.js";
import * as S from "../src/service.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let server: Server | undefined;
afterEach(() => { resetDemoState(); server?.close(); });

async function start(db: DB) {
  server = createApp(db).listen(0);
  await new Promise(r => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}
const until = async (ok: () => boolean | Promise<boolean>, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const json = (r: Response) => r.json() as Promise<any>;

describe("Run demo button", () => {
  it("PM runs the Lumen demo: four agents finish the milestone by themselves, then it waits for approval", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    const login = async (email: string) => (await json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "demo1234" }) }))).token as string;
    const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

    // Login screen data is public and follows the current project.
    expect((await json(await fetch(`${base}/api/demo/accounts`))).map((a: any) => a.email)).toContain("layla@northwind.test");

    const pm = await login("layla@northwind.test");
    const junior = await login("john@northwind.test");
    expect((await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(junior), body: "{}" })).status).toBe(403);
    expect((await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(pm), body: JSON.stringify({ project: "nope" }) })).status).toBe(400);

    const started = await json(await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(pm), body: JSON.stringify({ project: "lumen", speed: 0 }) }));
    expect(started).toMatchObject({ running: true, project: "lumen", progress: { done: 0, total: 10 } });
    expect(started.cast.map((u: any) => u.id).sort()).toEqual(["hassan", "john", "omar", "priya"]);
    expect((await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(pm), body: "{}" })).status).toBe(409); // already running

    // The PM's login survived the project switch; the login list is now Lumen's.
    expect((await fetch(`${base}/api/demo/status`, { headers: auth(pm) })).status).toBe(200);
    expect((await json(await fetch(`${base}/api/demo/accounts`))).map((a: any) => a.email)).toContain("sara@lumen.test");

    // No human step per task: the run ends by itself, and the finished milestone waits for approval.
    const finished = await until(async () => !(await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }))).running);
    expect(finished).toBe(true);
    const end = await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }));
    expect(end).toMatchObject({ running: false, end_reason: "complete: every task is done", progress: { done: 10, total: 10 } });
    expect(end.waiting_for_approval).toEqual([{ id: "M-2", title: "Beta: Lumen Assist v1" }]);
    const sara = await login("sara@lumen.test");
    expect((await fetch(`${base}/api/milestones/M-2/approve`, { method: "POST", headers: auth(sara), body: "{}" })).status).toBe(200);
    expect((await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }))).waiting_for_approval).toEqual([]);
  }, 30_000);

  it("live demo: Hassan's real agent does his task over MCP; the simulator covers the rest; the PM approves the milestone", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    const login = async (email: string) => (await json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "demo1234" }) }))).token as string;
    const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
    const pm = await login("layla@northwind.test");
    const before = await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }));
    expect(before.available_cast.map((u: { id: string }) => u.id).sort()).toEqual(["hassan", "john", "omar", "priya"]);
    expect((await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(pm), body: JSON.stringify({ project: "lumen", real: ["nobody"] }) })).status).toBe(400);
    const started = await json(await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth(pm), body: JSON.stringify({ project: "lumen", speed: 0, real: ["hassan"] }) }));
    expect(started.real.map((u: { id: string }) => u.id)).toEqual(["hassan"]);

    // Wave 1: the three simulated agents finish; Hassan's T-8 is left for his real agent.
    const status = (id: string) => (db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status;
    expect(await until(() => ["T-5", "T-6", "T-7"].every(id => status(id) === "done"))).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(status("T-8")).toBe("todo");

    // Hassan's own agent (any MCP client, here the SDK like Claude Code) does T-8.
    const agent = new Client({ name: "claude-code", version: "1" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: "Bearer ak_hassan", "X-Agent-Name": "Hassan's Claude Code" } } }));
    const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await agent.callTool({ name, arguments: args })) as any).content[0].text);
    expect((await call("next_task")).task.id).toBe("T-8");
    await call("start_task", { task_id: "T-8", plan: "Set up CI with GitHub Actions and a staging deploy." });
    await call("report_progress", { task_id: "T-8", summary: "A CI agent wrote the workflow; tests run on every push.", agents_used: ["CI agent"], cost_usd: 0.4 });
    const sub = await call("submit_task", { task_id: "T-8", explanation: "CI runs lint and tests on every push; main deploys to staging automatically. Built live by Hassan's Claude Code.", agents_used: ["CI agent", "deploy agent"], cost_usd: 0.6 });
    expect(sub).toMatchObject({ ok: true, id: "T-8", status: "done" });
    await agent.close();

    // The PM opens T-8 and reads what Hassan's agent did.
    const t8 = await json(await fetch(`${base}/api/tasks/T-8`, { headers: auth(pm) }));
    expect(t8.status).toBe("done");
    expect(t8.updates[0]).toMatchObject({ kind: "completion", agent_name: "Hassan's Claude Code", via: "agent", summary: expect.stringMatching(/Built live by Hassan/) });
    const live = await json(await fetch(`${base}/api/agents/live`, { headers: auth(pm) }));
    expect(live.some((a: { agent_name: string }) => a.agent_name === "Hassan's Claude Code")).toBe(true);

    // The simulator covers Hassan's later tasks (T-12, T-13), the run completes, and the PM approves the milestone.
    expect(await until(async () => !(await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }))).running)).toBe(true);
    const t13 = await json(await fetch(`${base}/api/tasks/T-13`, { headers: auth(pm) }));
    expect(t13.status).toBe("done");
    expect(t13.updates[0]).toMatchObject({ kind: "completion", agent_name: "Hassan's Claude" });
    const lumenPm = await login("layla@lumen.test");
    expect((await fetch(`${base}/api/milestones/M-2/approve`, { method: "POST", headers: auth(lumenPm), body: "{}" })).status).toBe(200);
  }, 30_000);

  it("Stop ends a running demo", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    const pm = (await json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "layla@northwind.test", password: "demo1234" }) }))).token;
    const auth = { Authorization: `Bearer ${pm}`, "Content-Type": "application/json" };
    await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth, body: JSON.stringify({ project: "lumen", speed: 1 }) });
    const s = await json(await fetch(`${base}/api/demo/stop`, { method: "POST", headers: auth }));
    expect(s).toMatchObject({ running: false, end_reason: "stopped" });
  });

  it("Reset demo also stops a running demo", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    const pm = (await json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "layla@northwind.test", password: "demo1234" }) }))).token;
    const auth = { Authorization: `Bearer ${pm}`, "Content-Type": "application/json" };
    await fetch(`${base}/api/demo/run`, { method: "POST", headers: auth, body: JSON.stringify({ project: "lumen", speed: 1 }) });
    expect((await fetch(`${base}/api/demo/reset`, { method: "POST", headers: auth })).status).toBe(200);
    expect(await json(await fetch(`${base}/api/demo/status`, { headers: auth }))).toMatchObject({ running: false, end_reason: "stopped" });
  });
});
