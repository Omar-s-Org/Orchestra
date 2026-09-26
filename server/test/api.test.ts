import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";

let server: Server; let base: string;
let hookServer: Server; const hooks: { event: string }[] = [];

beforeAll(async () => {
  const db = openDb(":memory:"); reset(db);
  server = createApp(db).listen(0);
  hookServer = http.createServer((req, res) => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => { hooks.push(JSON.parse(b)); res.end(); }); }).listen(0);
  await Promise.all([new Promise(r => server.once("listening", r)), new Promise(r => hookServer.once("listening", r))]);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); hookServer.close(); });

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "demo1234" }) });
  return (await r.json()).token as string;
}
const get = (token: string, path: string) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
async function agent(key: string, name: string) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}`, "X-Agent-Name": name } } }));
  return c;
}
const text = (r: any) => r.content[0].text as string;

describe("REST + MCP end to end", () => {
  it("rejects bad credentials and missing tokens", async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "john@northwind.test", password: "x" }) });
    expect(r.status).toBe(401);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it("me returns capabilities per role", async () => {
    const pm = await (await get(await login("layla@northwind.test"), "/api/me")).json();
    const jr = await (await get(await login("john@northwind.test"), "/api/me")).json();
    expect(pm.capabilities).toEqual({ graph: true, review: true, cost: true });
    expect(jr.capabilities).toEqual({ graph: false, review: false, cost: false });
    expect(pm.project.name).toBe("Northwind Launch");
  });

  it("agent works a task over MCP, webhook fires, senior approves over REST", async () => {
    const pm = await login("layla@northwind.test");
    const port = (hookServer.address() as { port: number }).port;
    await fetch(`${base}/api/webhooks`, { method: "POST", headers: { Authorization: `Bearer ${pm}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: `http://127.0.0.1:${port}/hook` }) });

    const a = await agent("ak_omar", "Omar's Claude Code");
    const tools = (await a.listTools()).tools.map(t => t.name);
    expect(tools).toEqual(expect.arrayContaining(["start_task", "report_progress", "attach_artifact", "submit_task", "search_kb"]));
    await a.callTool({ name: "start_task", arguments: { task_id: "T-6", plan: "Build the sign-up screen" } });
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const art = JSON.parse(text(await a.callTool({ name: "attach_artifact", arguments: { task_id: "T-6", name: "mock.png", mime: "image/png", base64: png } })));
    const sub = await a.callTool({ name: "submit_task", arguments: { task_id: "T-6", explanation: `Built the screens with a UI agent. ${art.markdown}`, agents_used: ["ui agent"], cost_usd: 0.3 } });
    expect(JSON.parse(text(sub)).status).toBe("review");
    const refused = await a.callTool({ name: "read_kb", arguments: { doc_id: "K-5" } });
    expect(refused.isError).toBe(true);
    await a.close();

    const sara = await login("sara@northwind.test");
    const live = await (await get(sara, "/api/agents/live")).json();
    expect(live.find((x: any) => x.user.id === "omar").agent_name).toBe("Omar's Claude Code");
    const img = await get(sara, art.url);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect((await fetch(`${base}${art.url}?token=${sara}`)).status).toBe(200);

    const approved = await (await fetch(`${base}/api/tasks/T-6/approve`, { method: "POST", headers: { Authorization: `Bearer ${sara}`, "Content-Type": "application/json" }, body: "{}" })).json();
    expect(approved.status).toBe("done");

    const feed = await (await get(sara, "/api/activity?via=agent&kind=completion")).json();
    expect(feed[0].task.id).toBe("T-6");
    await new Promise(r => setTimeout(r, 200));
    expect(hooks.map(h => h.event)).toEqual(expect.arrayContaining(["task.status_changed", "task.submitted", "task.approved"]));
  });

  it("junior gets 403 on graph and approve", async () => {
    const john = await login("john@northwind.test");
    expect((await get(john, "/api/graph")).status).toBe(403);
    const r = await fetch(`${base}/api/tasks/T-4/approve`, { method: "POST", headers: { Authorization: `Bearer ${john}` } });
    expect(r.status).toBe(403);
  });

  it("demo reset needs a logged-in PM", async () => {
    expect((await fetch(`${base}/api/demo/reset`, { method: "POST" })).status).toBe(401);
    const john = await login("john@northwind.test");
    expect((await fetch(`${base}/api/demo/reset`, { method: "POST", headers: { Authorization: `Bearer ${john}` } })).status).toBe(403);
    const pm = await login("layla@northwind.test");
    const r = await fetch(`${base}/api/demo/reset`, { method: "POST", headers: { Authorization: `Bearer ${pm}` } });
    expect(await r.json()).toEqual({ ok: true });
  });

  it("MCP rejects an unknown agent key", async () => {
    await expect(agent("nope", "x")).rejects.toThrow();
  });
});
