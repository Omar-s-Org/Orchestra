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
const MAX_RUN_REAL_MS = 60 * 60_000;   // real agents take longer than the simulator
const LOG_LINES = 40;

type Run = {
  project: string; file: string; startedAt: string; finishedAt: string | null; endReason: string | null;
  cast: string[]; real: string[]; taskIds: string[]; log: string[]; stop: AbortController | null; watcher: NodeJS.Timeout | null;
};
let current: Run | null = null;

/** Demo projects = project files that have simulator stories. Read once: the files ship with the server. */
let projectsCache: string[] | null = null;
export function demoProjects() {
  return projectsCache ??= fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""))
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

/** Who works a demo project's scripted tasks (first worker of each task that has a story). */
const castCache = new Map<string, ReturnType<typeof readCast>>();
/** Cached: project files ship with the server and status is polled every 2 s. */
function castOf(project: string) {
  if (!castCache.has(project)) castCache.set(project, readCast(project));
  return castCache.get(project)!;
}
function readCast(project: string) {
  const file = path.join(PROJECTS_DIR, `${project}.json`);
  const stories = loadStories(file);
  const spec = validateProject(JSON.parse(fs.readFileSync(file, "utf8")));
  const storyTasks = spec.tasks.filter(t => stories[t.id]);
  const cast = [...new Set(storyTasks.map(t => t.workers[0]).filter(Boolean))];
  return { file, spec, taskIds: storyTasks.map(t => t.id), cast };
}

/**
 * opts.real: people whose own agents (e.g. Claude Code over MCP) work their tasks live; the simulator
 * leaves those tasks alone and plays everyone else.
 */
export function startDemo(db: DB, selfUrl: string, opts: { project?: string; speed?: number; real?: string[] } = {}) {
  if (current && !current.finishedAt) throw new HttpError(409, "A demo is already running. Stop it first.");
  const project = opts.project ?? "lumen";
  if (!/^[a-z0-9-]+$/.test(project) || !demoProjects().includes(project))
    throw new BadRequest(`Unknown demo project "${project}". Available: ${demoProjects().join(", ")}`);
  const speed = Math.min(Math.max(Number(opts.speed ?? 1) || 0, 0), 5);
  const { file, taskIds, cast } = castOf(project);
  if (!taskIds.length || !cast.length) throw new BadRequest(`Demo project "${project}" has no simulator stories that match its tasks`);
  const real = [...new Set(Array.isArray(opts.real) ? opts.real.map(String) : [])];
  const unknown = real.filter(id => !cast.includes(id));
  if (unknown.length) throw new BadRequest(`Not in the demo cast: ${unknown.join(", ")}. Cast: ${cast.join(", ")}`);
  const simulated = cast.filter(id => !real.includes(id));

  reset(db, file);
  const stop = new AbortController();
  const run: Run = { project, file, startedAt: new Date().toISOString(), finishedAt: null, endReason: null, cast, real, taskIds, log: [], stop, watcher: null };
  current = run;
  const log = (line: string) => { run.log.push(line); if (run.log.length > LOG_LINES) run.log.shift(); };

  if (real.length) log(`Real agents (not simulated): ${real.join(", ")}. Their tasks wait for their own agents.`);
  // Agents re-check for newly unlocked work every 3 s, so an approval is picked up almost immediately.
  if (simulated.length) runSim({ baseUrl: selfUrl, projectFile: file, people: simulated, speed, loop: true, heartbeatMs: speed === 0 ? 50 : 3000, signal: stop.signal, log })
    .then(r => log(`Agents went offline (${r.submitted} task(s) submitted).`))
    .catch(e => { log(`Simulator error: ${(e as Error).message}`); if (current === run) finish("error"); });

  run.watcher = setInterval(() => {
    if (current !== run) return;
    try {
      const open = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND id IN (${taskIds.map(() => "?").join(",")})`).get(...taskIds) as { n: number }).n;
      if (open === 0) finish("complete: every task is done");
      else if (Date.now() - Date.parse(run.startedAt) > (run.real.length ? MAX_RUN_REAL_MS : MAX_RUN_MS)) finish(`time limit (${run.real.length ? 60 : 15} min)`);
    } catch (e) {
      // A timer error must never take the server down; end the run instead.
      log(`Progress check failed: ${(e as Error).message}`);
      finish("error");
    }
  }, 2000);
  run.watcher.unref?.();
  return demoStatus(db);
}

/** Project files that can be loaded (Northwind, Lumen, …); test fixtures are left out. */
export function loadableProjects() {
  return fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith(".json") && !f.includes("test")).map(f => f.replace(/\.json$/, "")).sort();
}

/** Stop any running demo and load a project (fresh data, no agents). PM only (checked by the route). */
export function loadDemo(db: DB, project: string) {
  if (!/^[a-z0-9-]+$/.test(project) || !loadableProjects().includes(project))
    throw new BadRequest(`Unknown project "${project}". Available: ${loadableProjects().join(", ")}`);
  stopDemo(db);
  const loaded = reset(db, path.join(PROJECTS_DIR, `${project}.json`));
  return { loaded, ...demoStatus(db) };
}

export function stopDemo(db: DB) {
  if (current && !current.finishedAt) finish("stopped");
  return demoStatus(db);
}

export function demoStatus(db: DB) {
  const run = current;
  const users = db.prepare("SELECT id, name, role, department FROM users").all() as { id: string; name: string; role: string; department: string }[];
  // Who can be chosen as a real agent for the default (Lumen) demo, from the project file.
  const lumen = demoProjects().includes("lumen") ? castOf("lumen") : null;
  const people = lumen ? lumen.spec.people : [];
  const base = {
    projects: demoProjects(),
    available_cast: (lumen?.cast ?? []).map(id => { const p = people.find(x => x.id === id)!; return { id, name: p.name, role: p.role, department: p.department }; }),
  };
  if (!run) return { ...base, running: false, project: null, started_at: null, finished_at: null, end_reason: null, cast: [], real: [], progress: null, waiting_for_approval: [], log: [] };
  const ids = run.taskIds;
  const rows = ids.length ? db.prepare(`SELECT id, title, status FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; title: string; status: string }[] : [];
  return {
    ...base,
    running: !run.finishedAt, project: run.project, started_at: run.startedAt, finished_at: run.finishedAt, end_reason: run.endReason,
    cast: run.cast.map(id => users.find(u => u.id === id)).filter(Boolean),
    real: run.real.map(id => users.find(u => u.id === id)).filter(Boolean),
    progress: { done: rows.filter(r => r.status === "done").length, total: ids.length },
    waiting_for_approval: rows.filter(r => r.status === "review").map(r => ({ id: r.id, title: r.title })),
    log: run.log.slice(-20),
  };
}

/** For tests: forget any previous run. */
export function resetDemoState() { if (current && !current.finishedAt) finish("stopped"); current = null; }
