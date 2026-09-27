import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const LUMEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../projects/lumen.json");
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 25)); return ok(); };

describe("simulated agents", () => {
  it("every story task in the demo belongs to a real task", () => {
    const db = openDb(":memory:"); reset(db);
    for (const id of Object.keys(loadStories(DEFAULT_PROJECT))) expect(status(db, id), id).toBeTruthy();
  });

  it("John, Priya and Mia work their unlocked tasks over MCP; locked ones wait for their prerequisites", async () => {
    const db = openDb(":memory:"); reset(db);
    const lines: string[] = [];
    const base = await start(db);
    const r = await runSim({ baseUrl: base, speed: 0, log: l => lines.push(l) });

    // Submitting completes a task; T-9 (waits on T-5) may be picked up in this run or the next.
    expect(r.submitted).toBeGreaterThanOrEqual(3);
    for (const id of ["T-4", "T-5", "T-11"]) expect(status(db, id)).toBe("done");
    // Updates carry the agent name, agents used and cost; the chart is embedded in the completion.
    const done = db.prepare("SELECT agent_name, agents_used, cost_usd, summary, status_to FROM task_updates WHERE task_id='T-5' AND kind='completion' ORDER BY id DESC").get() as { agent_name: string; agents_used: string; cost_usd: number; summary: string; status_to: string };
    expect(done.agent_name).toBe("John's Claude");
    expect(done.status_to).toBe("done");
    expect(JSON.parse(done.agents_used)).toContain("data agent");
    expect(done.cost_usd).toBeGreaterThan(0);
    expect(done.summary).toMatch(/!\[reco-precision\.svg\]\(\/api\/artifacts\/[0-9a-f]{16}\)/);
    expect(done.summary).not.toContain("{{artifact}}");
    // Nothing was refused along the way.
    expect(lines.filter(l => l.includes("skipped"))).toEqual([]);

    // T-5 is done, so T-9 is unlocked: a second run finishes it. T-9 has two workers; only Mia drives it.
    await runSim({ baseUrl: base, speed: 0, log: () => {} });
    expect(status(db, "T-9")).toBe("done");
    expect(db.prepare("SELECT DISTINCT user_id FROM task_updates WHERE task_id='T-9' AND via='agent'").all()).toEqual([{ user_id: "mia" }]);
  });

  it("--loop keeps agents online, picks up tasks the moment they unlock, and re-works after a reset", async () => {
    const db = openDb(":memory:"); reset(db);
    const stop = new AbortController();
    const run = runSim({ baseUrl: await start(db), speed: 0, loop: true, heartbeatMs: 50, signal: stop.signal, log: () => {} });
    const allDone = (ids: string[]) => () => ids.every(id => status(db, id) === "done");
    const seen = () => (db.prepare("SELECT last_seen FROM agent_sessions WHERE user_id='john'").get() as { last_seen: string } | undefined)?.last_seen ?? "";

    // T-9 unlocks as soon as T-5 is submitted, and Mia's looping agent picks it up with no human step.
    expect(await until(allDone(["T-4", "T-5", "T-11", "T-9"]))).toBe(true);
    const firstSeen = seen();
    expect(await until(() => seen() > firstSeen)).toBe(true); // heartbeat after the work is done

    reset(db); // "Reset demo": tasks are open again
    expect(status(db, "T-5")).toBe("in_progress");
    expect(await until(allDone(["T-4", "T-5", "T-11"]))).toBe(true);

    stop.abort();
    expect((await run).submitted).toBeGreaterThanOrEqual(7); // 4+ before the reset, 3+ after
  });

  it("fetches agent keys through login when the server issues random keys", async () => {
    process.env.AGENT_KEYS = "random";
    const db = openDb(":memory:"); reset(db);
    expect((db.prepare("SELECT agent_key FROM users WHERE id='john'").get() as { agent_key: string }).agent_key).not.toBe("ak_john");
    const r = await runSim({ baseUrl: await start(db), people: ["john"], speed: 0, log: () => {} });
    expect(r.submitted).toBe(1); // T-5 (T-9 was still locked when John listed his work)
    expect(status(db, "T-5")).toBe("done");
  });

  it("can reset the demo first, as the PM", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    await runSim({ baseUrl: base, people: ["john"], speed: 0, log: () => {} });
    expect(status(db, "T-5")).toBe("done");
    const r = await runSim({ baseUrl: base, people: ["john"], speed: 0, reset: true, log: () => {} });
    expect(r.submitted).toBe(1); // reset put T-5 back to in_progress, so John could work it again
  });

  it("Lumen demo: four agents complete the beta milestone on their own; the senior then approves the milestone", async () => {
    const db = openDb(":memory:");
    reset(db, LUMEN);
    const base = await start(db);
    const sara = db.prepare("SELECT id, name, role, department FROM users WHERE id='sara'").get() as S.Ctx["user"];
    const stop = new AbortController();
    const lines: string[] = [];
    const run = runSim({ baseUrl: base, projectFile: LUMEN, speed: 0, loop: true, heartbeatMs: 30, signal: stop.signal, log: l => lines.push(l) });
    const open = () => (db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE milestone_id='M-2' AND status!='done'").get() as { n: number }).n;
    expect(await until(() => open() === 0)).toBe(true);
    stop.abort();
    expect((await run).submitted).toBe(10);
    expect(S.approveMilestone({ db, user: sara, via: "ui" }, "M-2")).toMatchObject({ approved_by: { id: "sara" } });
    // All four simulated people did real work, and nothing was refused.
    const workers = (db.prepare("SELECT DISTINCT user_id FROM task_updates WHERE via='agent' AND task_id IN (SELECT id FROM tasks WHERE milestone_id='M-2')").all() as { user_id: string }[]).map(r => r.user_id).sort();
    expect(workers).toEqual(["hassan", "john", "omar", "priya"]);
    expect(lines.filter(l => l.includes(" skipped: "))).toEqual([]);
  });
});
