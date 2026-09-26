// "Run demo": load a demo project and let its simulated team (real MCP clients, see sim/) work it
// inside this server process. Humans approve finished work in the UI; each approval unlocks the next
// wave. The run stops by itself when every scripted task is done, after 15 minutes, or on Stop.
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import { reset } from "./seed.js";
import { DEFAULT_PROJECT, validateProject } from "./project-file.js";
import { runSim, loadStories } from "../sim/sim.js";
import { BadRequest, HttpError } from "./permissions.js";

const PROJECTS_DIR = path.dirname(DEFAULT_PROJECT);
const MAX_RUN_MS = 15 * 60_000;
const LOG_LINES = 40;

type Run = {
  project: string; file: string; startedAt: string; finishedAt: string | null; endReason: string | null;
  cast: string[]; taskIds: string[]; log: string[]; stop: AbortController | null; watcher: NodeJS.Timeout | null;
};
let current: Run | null = null;

/** Demo projects = project files that have simulator stories. */
export function demoProjects() {
  return fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""))
    .filter(name => Object.keys(loadStories(path.join(PROJECTS_DIR, `${name}.json`))).length > 0).sort();
}

function finish(reason: string) {
  if (!current || current.finishedAt) return;
  current.finishedAt = new Date().toISOString();
  current.endReason = reason;
  current.log.push(`Demo ended: ${reason}`);
  if (current.watcher) clearInterval(current.watcher);
  current.stop?.abort();
}

export function startDemo(db: DB, selfUrl: string, opts: { project?: string; speed?: number } = {}) {
  if (current && !current.finishedAt) throw new HttpError(409, "A demo is already running. Stop it first.");
  const project = opts.project ?? "lumen";
  if (!/^[a-z0-9-]+$/.test(project) || !demoProjects().includes(project))
    throw new BadRequest(`Unknown demo project "${project}". Available: ${demoProjects().join(", ")}`);
  const speed = Math.min(Math.max(Number(opts.speed ?? 1) || 0, 0), 5);
  const file = path.join(PROJECTS_DIR, `${project}.json`);
  const stories = loadStories(file);
  const spec = validateProject(JSON.parse(fs.readFileSync(file, "utf8")));
  const taskIds = spec.tasks.filter(t => stories[t.id]).map(t => t.id);
  const cast = [...new Set(spec.tasks.filter(t => stories[t.id]).map(t => t.workers[0]).filter(Boolean))];
  if (!taskIds.length || !cast.length) throw new BadRequest(`Demo project "${project}" has no simulator stories that match its tasks`);

  reset(db, file);
  const stop = new AbortController();
  const run: Run = { project, file, startedAt: new Date().toISOString(), finishedAt: null, endReason: null, cast, taskIds, log: [], stop, watcher: null };
  current = run;
  const log = (line: string) => { run.log.push(line); if (run.log.length > LOG_LINES) run.log.shift(); };

  // Agents re-check for newly unlocked work every 3 s, so an approval is picked up almost immediately.
  runSim({ baseUrl: selfUrl, projectFile: file, speed, loop: true, heartbeatMs: speed === 0 ? 50 : 3000, signal: stop.signal, log })
    .then(r => log(`Agents went offline (${r.submitted} task(s) submitted).`))
    .catch(e => { log(`Simulator error: ${(e as Error).message}`); if (current === run) finish("error"); });

  run.watcher = setInterval(() => {
    if (current !== run) return;
    try {
      const open = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND id IN (${taskIds.map(() => "?").join(",")})`).get(...taskIds) as { n: number }).n;
      if (open === 0) finish("complete: every task is done");
      else if (Date.now() - Date.parse(run.startedAt) > MAX_RUN_MS) finish("time limit (15 min)");
    } catch (e) {
      // A timer error must never take the server down; end the run instead.
      log(`Progress check failed: ${(e as Error).message}`);
      finish("error");
    }
  }, 2000);
  run.watcher.unref?.();
  return demoStatus(db);
}

export function stopDemo(db: DB) {
  if (current && !current.finishedAt) finish("stopped");
  return demoStatus(db);
}

export function demoStatus(db: DB) {
  const run = current;
  const base = { projects: demoProjects() };
  if (!run) return { ...base, running: false, project: null, started_at: null, finished_at: null, end_reason: null, cast: [], progress: null, waiting_for_approval: [], log: [] };
  const ids = run.taskIds;
  const rows = ids.length ? db.prepare(`SELECT id, title, status FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; title: string; status: string }[] : [];
  const users = db.prepare("SELECT id, name, role, department FROM users").all() as { id: string; name: string; role: string; department: string }[];
  return {
    ...base,
    running: !run.finishedAt, project: run.project, started_at: run.startedAt, finished_at: run.finishedAt, end_reason: run.endReason,
    cast: run.cast.map(id => users.find(u => u.id === id)).filter(Boolean),
    progress: { done: rows.filter(r => r.status === "done").length, total: ids.length },
    waiting_for_approval: rows.filter(r => r.status === "review").map(r => ({ id: r.id, title: r.title })),
    log: run.log.slice(-20),
  };
}

/** For tests: forget any previous run. */
export function resetDemoState() { if (current && !current.finishedAt) finish("stopped"); current = null; }
