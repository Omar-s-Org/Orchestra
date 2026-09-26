import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { runSim, loadStories } from "../sim/sim.js";
import { DEFAULT_PROJECT } from "../src/project-file.js";
import * as S from "../src/service.js";

let server: Server | undefined;
afterEach(() => { server?.close(); delete process.env.AGENT_KEYS; });

async function start(db: DB) {
  server = createApp(db).listen(0);
  await new Promise(r => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status;
const lastUpdateId = (db: DB) => (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM task_updates").get() as { n: number }).n;
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 25)); return ok(); };

describe("simulated agents", () => {
  it("every story task in the demo belongs to a real task", () => {
    const db = openDb(":memory:"); reset(db);
    for (const id of Object.keys(loadStories(DEFAULT_PROJECT))) expect(status(db, id), id).toBeTruthy();
  });

  it("John, Priya and Mia work their unlocked tasks over MCP; locked ones wait for approval", async () => {
    const db = openDb(":memory:"); reset(db);
    const lines: string[] = [];
    const base = await start(db);
    const r = await runSim({ baseUrl: base, speed: 0, log: l => lines.push(l) });

    // T-9 waits on T-5 and T-13 on T-8/T-9: prerequisites must be approved (done) first.
    expect(r.submitted).toBe(3);
    for (const id of ["T-4", "T-5", "T-11"]) expect(status(db, id)).toBe("review");
    for (const id of ["T-9", "T-13"]) expect(status(db, id)).toBe("todo");
    expect(lines.some(l => l.includes("T-9 waiting: locked until T-5"))).toBe(true);
    // Updates carry the agent name, agents used and cost; the chart is embedded in the completion.
    const done = db.prepare("SELECT agent_name, agents_used, cost_usd, summary FROM task_updates WHERE task_id='T-5' AND kind='completion' ORDER BY id DESC").get() as { agent_name: string; agents_used: string; cost_usd: number; summary: string };
    expect(done.agent_name).toBe("John's Claude");
    expect(JSON.parse(done.agents_used)).toContain("data agent");
    expect(done.cost_usd).toBeGreaterThan(0);
    expect(done.summary).toMatch(/!\[reco-precision\.svg\]\(\/api\/artifacts\/[0-9a-f]{16}\)/);
    expect(done.summary).not.toContain("{{artifact}}");
    // Nothing was refused along the way.
    expect(lines.filter(l => l.includes("skipped"))).toEqual([]);

    // Sara approves T-5 → T-9 unlocks, and the next run picks it up. T-9 has two workers; only Mia drives it.
    const before = lastUpdateId(db);
    const sara = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "sara@northwind.test", password: "demo1234" }) })).json();
    expect((await fetch(`${base}/api/tasks/T-5/approve`, { method: "POST", headers: { Authorization: `Bearer ${sara.token}` } })).status).toBe(200);
    expect((await runSim({ baseUrl: base, speed: 0, log: () => {} })).submitted).toBe(1);
    expect(status(db, "T-9")).toBe("review");
    expect(db.prepare("SELECT DISTINCT user_id FROM task_updates WHERE task_id='T-9' AND id > ?").all(before)).toEqual([{ user_id: "mia" }]);
  });

  it("--loop keeps agents online, picks up tasks the moment they unlock, and re-works after a reset", async () => {
    const db = openDb(":memory:"); reset(db);
    const stop = new AbortController();
    const run = runSim({ baseUrl: await start(db), speed: 0, loop: true, heartbeatMs: 50, signal: stop.signal, log: () => {} });
    const inReview = (ids: string[]) => () => ids.every(id => status(db, id) === "review");
    const unlocked = inReview(["T-4", "T-5", "T-11"]);
    const seen = () => (db.prepare("SELECT last_seen FROM agent_sessions WHERE user_id='john'").get() as { last_seen: string } | undefined)?.last_seen ?? "";

    expect(await until(unlocked)).toBe(true);
    expect(status(db, "T-9")).toBe("todo"); // locked behind T-5 (in review, not done)
    const firstSeen = seen();
    expect(await until(() => seen() > firstSeen)).toBe(true); // heartbeat after the work is done

    // Sara approves T-5 → T-9 unlocks → Mia's looping agent picks it up on its next heartbeat.
    const sara = db.prepare("SELECT id, name, role, department FROM users WHERE id='sara'").get() as S.Ctx["user"];
    S.approveTask({ db, user: sara, via: "ui" }, "T-5");
    expect(await until(inReview(["T-9"]))).toBe(true);

    reset(db); // "Reset demo": tasks are open again
    expect(status(db, "T-5")).toBe("in_progress");
    expect(await until(unlocked)).toBe(true);

    stop.abort();
    expect((await run).submitted).toBe(7); // 3 + T-9 + 3 after the reset
  });

  it("fetches agent keys through login when the server issues random keys", async () => {
    process.env.AGENT_KEYS = "random";
    const db = openDb(":memory:"); reset(db);
    expect((db.prepare("SELECT agent_key FROM users WHERE id='john'").get() as { agent_key: string }).agent_key).not.toBe("ak_john");
    const r = await runSim({ baseUrl: await start(db), people: ["john"], speed: 0, log: () => {} });
    expect(r.submitted).toBe(1); // T-5; their shared T-9 stays locked until T-5 is approved
    expect(status(db, "T-5")).toBe("review");
  });

  it("can reset the demo first, as the PM", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    await runSim({ baseUrl: base, people: ["john"], speed: 0, log: () => {} });
    expect(status(db, "T-5")).toBe("review");
    const r = await runSim({ baseUrl: base, people: ["john"], speed: 0, reset: true, log: () => {} });
    expect(r.submitted).toBe(1); // reset put T-5 back to in_progress, so John could work it again
  });
});
