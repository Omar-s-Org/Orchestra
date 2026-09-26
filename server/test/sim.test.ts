import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { runSim, loadStories } from "../sim/sim.js";
import { DEFAULT_PROJECT } from "../src/project-file.js";

let server: Server | undefined;
afterEach(() => { server?.close(); delete process.env.AGENT_KEYS; });

async function start(db: DB) {
  server = createApp(db).listen(0);
  await new Promise(r => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status;

describe("simulated agents", () => {
  it("every story task in the demo belongs to a real task", () => {
    const db = openDb(":memory:"); reset(db);
    for (const id of Object.keys(loadStories(DEFAULT_PROJECT))) expect(status(db, id), id).toBeTruthy();
  });

  it("John, Priya and Mia work their tasks over MCP and submit them for review", async () => {
    const db = openDb(":memory:"); reset(db);
    const lines: string[] = [];
    const r = await runSim({ baseUrl: await start(db), speed: 0, log: l => lines.push(l) });

    expect(r.submitted).toBe(5);
    for (const id of ["T-4", "T-5", "T-9", "T-11", "T-13"]) expect(status(db, id)).toBe("review");
    // T-9 has two workers; only Mia (listed first) drives it.
    expect(db.prepare("SELECT DISTINCT user_id FROM task_updates WHERE task_id='T-9' AND created_at > datetime('now','-1 minute')").all()).toEqual([{ user_id: "mia" }]);
    // Updates carry the agent name, agents used and cost; the chart is embedded in the completion.
    const done = db.prepare("SELECT agent_name, agents_used, cost_usd, summary FROM task_updates WHERE task_id='T-5' AND kind='completion' ORDER BY id DESC").get() as { agent_name: string; agents_used: string; cost_usd: number; summary: string };
    expect(done.agent_name).toBe("John's Claude");
    expect(JSON.parse(done.agents_used)).toContain("data agent");
    expect(done.cost_usd).toBeGreaterThan(0);
    expect(done.summary).toMatch(/!\[reco-precision\.svg\]\(\/api\/artifacts\/[0-9a-f]{16}\)/);
    expect(done.summary).not.toContain("{{artifact}}");
    expect((db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE mime='image/svg+xml' AND user_id IN ('john','priya','mia')").get() as { n: number }).n).toBe(4);
    // Nothing was refused along the way.
    expect(lines.filter(l => l.includes("skipped"))).toEqual([]);

    // A second run finds nothing left to do instead of failing.
    expect((await runSim({ baseUrl: `http://127.0.0.1:${(server!.address() as { port: number }).port}`, speed: 0, log: () => {} })).submitted).toBe(0);
  });

  it("fetches agent keys through login when the server issues random keys", async () => {
    process.env.AGENT_KEYS = "random";
    const db = openDb(":memory:"); reset(db);
    expect((db.prepare("SELECT agent_key FROM users WHERE id='john'").get() as { agent_key: string }).agent_key).not.toBe("ak_john");
    const r = await runSim({ baseUrl: await start(db), people: ["john"], speed: 0, log: () => {} });
    expect(r.submitted).toBe(2); // with Mia not simulated, John also drives their shared T-9
    for (const id of ["T-5", "T-9"]) expect(status(db, id)).toBe("review");
  });

  it("can reset the demo first, as the PM", async () => {
    const db = openDb(":memory:"); reset(db);
    const base = await start(db);
    await runSim({ baseUrl: base, people: ["john"], speed: 0, log: () => {} });
    expect(status(db, "T-5")).toBe("review");
    const r = await runSim({ baseUrl: base, people: ["john"], speed: 0, reset: true, log: () => {} });
    expect(r.submitted).toBe(2); // reset put T-5 and T-9 back, so John could work them again
  });
});
