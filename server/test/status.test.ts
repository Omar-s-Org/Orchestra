import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { resetDemoState } from "../src/demo-runner.js";

let server: Server; let base: string;
beforeEach(async () => {
  const db = openDb(":memory:"); reset(db);
  server = createApp(db).listen(0); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(() => { resetDemoState(); server.close(); });

const login = async (email: string) => (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "demo1234" }) })).json()).token as string;
const post = (path: string, token: string, body: unknown = {}) => fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("status page and test controls", () => {
  it("GET / shows the loaded project and the test controls", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("content-type")).toMatch(/html/);
    const html = await r.text();
    expect(html).toContain("Northwind Launch");
    expect(html).toContain("Self-test");
  });

  it("GET /mcp explains itself to a browser but stays 405 for clients", async () => {
    expect(await (await fetch(`${base}/mcp`, { headers: { Accept: "text/html" } })).text()).toMatch(/for AI agents/);
    expect((await fetch(`${base}/mcp`, { headers: { Accept: "application/json" } })).status).toBe(405);
  });

  it("demo/load is PM-only, validates the project and stops a running demo", async () => {
    const pm = await login("layla@northwind.test");
    expect((await post("/api/demo/load", await login("john@northwind.test"), { project: "lumen" })).status).toBe(403);
    expect((await post("/api/demo/load", pm, { project: "../etc" })).status).toBe(400);
    await post("/api/demo/run", pm, { project: "lumen", speed: 1 });
    const r = await (await post("/api/demo/load", pm, { project: "northwind" })).json();
    expect(r).toMatchObject({ loaded: { project: "Northwind Launch" }, running: false, end_reason: "stopped" });
  });

  it("self-test passes end to end on a healthy server and leaves Northwind loaded", async () => {
    const pm = await login("layla@northwind.test");
    const r = await (await post("/api/demo/selftest", pm)).json();
    const failed = r.steps.filter((s: { ok: boolean }) => !s.ok);
    expect(failed).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.steps.length).toBe(6);
    const accounts = await (await fetch(`${base}/api/demo/accounts`)).json();
    expect(accounts[0].email).toBe("layla@northwind.test");
  }, 60_000);
});
