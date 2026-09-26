import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { resetDemoState } from "../src/demo-runner.js";
import * as S from "../src/service.js";

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
  it("PM runs the Lumen demo: four agents work, a human approves each wave, it ends by itself", async () => {
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

    // A human (Sara) approves whatever is waiting until the run ends by itself.
    const sara = db.prepare("SELECT id, name, role, department FROM users WHERE id='sara'").get() as S.Ctx["user"];
    const finished = await until(async () => {
      for (const t of db.prepare("SELECT id FROM tasks WHERE status='review'").all() as { id: string }[]) S.approveTask({ db, user: sara, via: "ui" }, t.id);
      const s = await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }));
      return !s.running;
    });
    expect(finished).toBe(true);
    const end = await json(await fetch(`${base}/api/demo/status`, { headers: auth(pm) }));
    expect(end).toMatchObject({ running: false, end_reason: "complete: every task is done", progress: { done: 10, total: 10 } });
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
