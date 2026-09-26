// Service layer shared by REST (UI) and MCP (agents). Every read is filtered by the visibility
// rule; every write is permission-checked and audited, including refusals.
import { randomBytes } from "node:crypto";
import { type DB, now } from "./db.js";
import { hashPassword, verifyPassword, newToken } from "./auth.js";
import {
  type User, type Role, type Status, type Index,
  loadIndex, canSeeTask, isWorker, canApprove, allowedActions, canReadDoc, capabilities,
  Forbidden, NotFound, BadRequest, HttpError, LEVEL,
} from "./permissions.js";
import { emit } from "./webhooks.js";

export type Via = "ui" | "agent";
export type Ctx = { db: DB; user: User; via: Via; agentName?: string };

const LIVE_MS = 60_000;
const IDLE_MS = 30 * 60_000;
const USER_COLS = "id, name, role, department, email, title";

// ---------- auth ----------
export function login(db: DB, email: string, password: string) {
  const row = db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email)=lower(?)`).get(email ?? "") as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password ?? "", row.password_hash)) throw new HttpError(401, "Invalid email or password");
  const token = newToken("st");
  db.prepare("INSERT INTO auth_sessions (token, user_id, created_at) VALUES (?,?,?)").run(token, row.id, now());
  const { password_hash: _, ...user } = row;
  return { token, user };
}
export function logout(db: DB, token: string) {
  db.prepare("DELETE FROM auth_sessions WHERE token=?").run(token);
  return { ok: true };
}
export function userBySession(db: DB, token: string) {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=(SELECT user_id FROM auth_sessions WHERE token=?)`).get(token) as User | undefined;
}
export function userByAgentKey(db: DB, key: string) {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE agent_key=?`).get(key) as User | undefined;
}
export const createUserRow = (db: DB, u: { id: string; name: string; email: string; password: string; title: string; department: string; role: Role; agentKey?: string }) =>
  db.prepare("INSERT INTO users (id,name,email,password_hash,title,department,role,agent_key) VALUES (?,?,?,?,?,?,?,?)")
    .run(u.id, u.name, u.email, hashPassword(u.password), u.title, u.department, u.role, u.agentKey ?? newToken("ak"));

// ---------- helpers ----------
type TaskRow = { id: string; project_id: string; milestone_id: string; parent_id: string | null; title: string; description: string; scope: string; status: Status; due: string | null; created_at: string; updated_at: string };
type UpdateRow = { id: number; task_id: string; user_id: string; via: Via; agent_name: string | null; kind: string; status_from: Status | null; status_to: Status | null; summary: string; agents_used: string; cost_usd: number; links: string; created_at: string };

function userRefs(db: DB) {
  const m = new Map((db.prepare("SELECT id, name, role, department FROM users").all() as User[]).map(u => [u.id, u]));
  return (id: string) => { const u = m.get(id); return u ? { id: u.id, name: u.name, role: u.role, department: u.department } : { id, name: id, role: "junior" as Role, department: "" }; };
}

function audit(c: Ctx, action: string, entityId: string | null, allowed: boolean, detail?: unknown) {
  c.db.prepare("INSERT INTO audit (at, actor_id, via, action, entity_id, allowed, detail) VALUES (?,?,?,?,?,?,?)")
    .run(now(), c.user.id, c.via, action, entityId, allowed ? 1 : 0, detail === undefined ? null : JSON.stringify(detail));
}
/** Run a write; refusals are logged too so managers can see blocked agent actions. */
function guarded<T>(c: Ctx, action: string, id: string | null, fn: () => T): T {
  try { const r = fn(); audit(c, action, id, true); return r; }
  catch (e) { if (e instanceof Forbidden) audit(c, action, id, false, { reason: e.message }); throw e; }
}

const taskRow = (db: DB, id: string) => db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as TaskRow | undefined;

function visibleTask(c: Ctx, ix: Index, id: string) {
  const t = taskRow(c.db, id);
  if (!t || !canSeeTask(ix, c.user, id)) throw new NotFound(`Task ${id} not found`); // don't leak existence
  return t;
}

function liveFor(db: DB, taskId: string) {
  const s = db.prepare("SELECT agent_name, activity, started_at, last_seen FROM agent_sessions WHERE task_id=?").all(taskId) as { agent_name: string; activity: string; started_at: string; last_seen: string }[];
  const active = s.find(x => Date.now() - Date.parse(x.last_seen) < LIVE_MS);
  return active ? { agent_name: active.agent_name, activity: active.activity, since: active.started_at } : null;
}

function makeSummary(c: Ctx, ix: Index, t: TaskRow, ref = userRefs(c.db)) {
  const ms = c.db.prepare("SELECT id, name FROM milestones WHERE id=?").get(t.milestone_id) as { id: string; name: string } | undefined;
  const cost = (c.db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM task_updates WHERE task_id=?").get(t.id) as { s: number }).s;
  return {
    id: t.id, title: t.title, status: t.status,
    milestone: ms ?? { id: t.milestone_id, name: t.milestone_id },
    parent_id: t.parent_id,
    departments: ix.departments.get(t.id) ?? [],
    workers: (ix.workers.get(t.id) ?? []).map(ref),
    access: (ix.access.get(t.id) ?? []).map(ref),
    due: t.due,
    overdue: isOverdue(t.due, t.status),
    live: liveFor(c.db, t.id),
    cost_usd: round(cost),
    updated_at: t.updated_at,
    allowed_actions: allowedActions(ix, c.user, t.id, t.status),
  };
}
const round = (n: number) => Math.round(n * 100) / 100;
/** A task is overdue once its due date (end of that day, UTC) has passed and it isn't done. */
export const isOverdue = (due: string | null, status: Status) => !!due && status !== "done" && Date.parse(`${due.slice(0, 10)}T23:59:59Z`) < Date.now();

function presentUpdate(db: DB, u: UpdateRow, ref = userRefs(db)) {
  const t = db.prepare("SELECT id, title FROM tasks WHERE id=?").get(u.task_id) as { id: string; title: string };
  return {
    id: u.id, task: t, kind: u.kind, via: u.via, user: ref(u.user_id), agent_name: u.agent_name,
    summary: u.summary, agents_used: JSON.parse(u.agents_used), cost_usd: round(u.cost_usd), links: JSON.parse(u.links),
    status_from: u.status_from, status_to: u.status_to, created_at: u.created_at,
  };
}

function artifactsOf(db: DB, taskId: string, ref = userRefs(db)) {
  return (db.prepare("SELECT id, name, mime, user_id, created_at FROM artifacts WHERE task_id=? ORDER BY created_at DESC").all(taskId) as { id: string; name: string; mime: string; user_id: string; created_at: string }[])
    .map(a => ({ id: a.id, name: a.name, mime: a.mime, url: `/api/artifacts/${a.id}`, user: ref(a.user_id), created_at: a.created_at }));
}

// ---------- reads ----------
export function me(c: Ctx) {
  const project = c.db.prepare("SELECT id, name, description FROM projects LIMIT 1").get();
  return { user: c.user, capabilities: capabilities(c.user), project };
}

export function agentKey(c: Ctx, baseUrl: string) {
  const { agent_key } = c.db.prepare("SELECT agent_key FROM users WHERE id=?").get(c.user.id) as { agent_key: string };
  const mcp_url = `${baseUrl}/mcp`;
  return { agent_key, mcp_url, command: `claude mcp add --transport http orchestra ${mcp_url} --header "Authorization: Bearer ${agent_key}"` };
}

export function listTasks(c: Ctx, f: { status?: string; department?: string; person?: string; mine?: boolean } = {}) {
  const ix = loadIndex(c.db);
  const ref = userRefs(c.db);
  const people = (id: string) => [...(ix.workers.get(id) ?? []), ...(ix.access.get(id) ?? [])];
  return (c.db.prepare("SELECT * FROM tasks ORDER BY milestone_id, CAST(SUBSTR(id,3) AS INTEGER)").all() as TaskRow[])
    .filter(t => canSeeTask(ix, c.user, t.id))
    .filter(t => !f.status || t.status === f.status)
    .filter(t => !f.department || (ix.departments.get(t.id) ?? []).includes(f.department))
    .filter(t => !f.person || people(t.id).includes(f.person))
    .filter(t => !f.mine || people(t.id).includes(c.user.id))
    .map(t => makeSummary(c, ix, t, ref));
}

function linkedTasks(c: Ctx, ix: Index, sql: string, ...args: string[]) {
  const ids = [...new Set((c.db.prepare(sql).all(...args) as { id: string }[]).map(r => r.id))];
  return ids.filter(id => canSeeTask(ix, c.user, id)).map(id => {
    const t = taskRow(c.db, id)!;
    return { id: t.id, title: t.title, status: t.status };
  });
}

export function getTask(c: Ctx, id: string) {
  const ix = loadIndex(c.db);
  const t = visibleTask(c, ix, id);
  const ref = userRefs(c.db);
  return {
    ...makeSummary(c, ix, t, ref),
    description: t.description, scope: t.scope,
    docs: (c.db.prepare("SELECT d.id, d.title, d.min_role FROM task_docs td JOIN kb_docs d ON d.id=td.doc_id WHERE td.task_id=?").all(id) as { id: string; title: string; min_role: Role }[])
      .map(d => ({ id: d.id, title: d.title, readable: canReadDoc(c.user, d.min_role) })),
    depends_on: linkedTasks(c, ix, "SELECT to_task AS id FROM task_links WHERE from_task=? AND type='depends_on'", id),
    blocks: linkedTasks(c, ix, "SELECT from_task AS id FROM task_links WHERE to_task=? AND type='depends_on'", id),
    mentions: linkedTasks(c, ix, "SELECT to_task AS id FROM task_links WHERE from_task=? AND type='mentions' UNION SELECT from_task FROM task_links WHERE to_task=? AND type='mentions'", id, id),
    subtasks: (c.db.prepare("SELECT * FROM tasks WHERE parent_id=? ORDER BY id").all(id) as TaskRow[]).filter(s => canSeeTask(ix, c.user, s.id)).map(s => makeSummary(c, ix, s, ref)),
    updates: (c.db.prepare("SELECT * FROM task_updates WHERE task_id=? ORDER BY id DESC").all(id) as UpdateRow[]).map(u => presentUpdate(c.db, u, ref)),
    artifacts: artifactsOf(c.db, id, ref),
  };
}

export function activity(c: Ctx, f: { limit?: number; task?: string; via?: string; kind?: string } = {}) {
  const ix = loadIndex(c.db);
  const ref = userRefs(c.db);
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const where: string[] = []; const args: string[] = [];
  if (f.task) { where.push("task_id=?"); args.push(f.task); }
  if (f.via) { where.push("via=?"); args.push(f.via); }
  if (f.kind) { where.push("kind=?"); args.push(f.kind); }
  const rows = c.db.prepare(`SELECT * FROM task_updates ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`).all(...args) as UpdateRow[];
  return rows.filter(u => canSeeTask(ix, c.user, u.task_id)).slice(0, limit).map(u => presentUpdate(c.db, u, ref));
}

/** People whose agents the caller may see: themselves, same-department people at or below their level; PM sees all. */
export function liveAgents(c: Ctx) {
  const ix = loadIndex(c.db);
  const ref = userRefs(c.db);
  const rows = c.db.prepare("SELECT * FROM agent_sessions ORDER BY last_seen DESC").all() as { user_id: string; agent_name: string; task_id: string | null; activity: string; last_seen: string }[];
  return rows.filter(s => Date.now() - Date.parse(s.last_seen) < IDLE_MS).filter(s => {
    const u = ref(s.user_id);
    return c.user.role === "pm" || u.id === c.user.id || (u.department === c.user.department && LEVEL[u.role] <= LEVEL[c.user.role]);
  }).map(s => {
    const task = s.task_id && canSeeTask(ix, c.user, s.task_id) ? c.db.prepare("SELECT id, title FROM tasks WHERE id=?").get(s.task_id) as { id: string; title: string } : null;
    return { user: ref(s.user_id), agent_name: s.agent_name, status: Date.now() - Date.parse(s.last_seen) < LIVE_MS ? "active" : "idle", task, activity: s.activity, last_seen: s.last_seen };
  });
}

function reviewItem(c: Ctx, ix: Index, t: TaskRow, ref: ReturnType<typeof userRefs>) {
  const last = c.db.prepare("SELECT * FROM task_updates WHERE task_id=? AND kind='completion' ORDER BY id DESC LIMIT 1").get(t.id) as UpdateRow | undefined;
  return { ...makeSummary(c, ix, t, ref), latest_completion: last ? presentUpdate(c.db, last, ref) : null, artifacts: artifactsOf(c.db, t.id, ref) };
}

export function overview(c: Ctx) {
  const ix = loadIndex(c.db);
  const ref = userRefs(c.db);
  const tasks = (c.db.prepare("SELECT * FROM tasks").all() as TaskRow[]).filter(t => canSeeTask(ix, c.user, t.id));
  const by_status = { todo: 0, in_progress: 0, review: 0, done: 0 };
  tasks.forEach(t => by_status[t.status]++);
  const milestones = (c.db.prepare("SELECT id, name, due FROM milestones ORDER BY due").all() as { id: string; name: string; due: string }[]).map(m => {
    const ts = tasks.filter(t => t.milestone_id === m.id);
    const done = ts.filter(t => t.status === "done").length;
    return { ...m, total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
  });
  const review_queue = tasks.filter(t => t.status === "review" && canApprove(ix, c.user, t.id)).map(t => reviewItem(c, ix, t, ref));
  let cost = null;
  if (capabilities(c.user).cost) {
    const ids = new Set(tasks.map(t => t.id));
    const ups = (c.db.prepare("SELECT task_id, user_id, cost_usd FROM task_updates").all() as { task_id: string; user_id: string; cost_usd: number }[]).filter(u => ids.has(u.task_id));
    const byDept = new Map<string, number>(); const byPerson = new Map<string, number>();
    for (const u of ups) {
      const d = ref(u.user_id).department;
      byDept.set(d, (byDept.get(d) ?? 0) + u.cost_usd);
      byPerson.set(u.user_id, (byPerson.get(u.user_id) ?? 0) + u.cost_usd);
    }
    const doneBy = (uid: string) => tasks.filter(t => t.status === "done" && (ix.workers.get(t.id) ?? []).includes(uid)).length;
    cost = {
      total_usd: round(ups.reduce((s, u) => s + u.cost_usd, 0)),
      by_department: [...byDept].map(([department, v]) => ({ department, cost_usd: round(v) })).sort((a, b) => b.cost_usd - a.cost_usd),
      by_person: [...byPerson].map(([uid, v]) => ({ user: ref(uid), cost_usd: round(v), tasks_done: doneBy(uid) })).sort((a, b) => b.cost_usd - a.cost_usd),
    };
  }
  const overdue = tasks.filter(t => isOverdue(t.due, t.status)).length;
  return { milestones, by_status, overdue, review_queue, cost };
}

export function listKb(c: Ctx, q?: string) {
  const ref = userRefs(c.db);
  const needle = q?.trim().toLowerCase();
  return (c.db.prepare("SELECT * FROM kb_docs ORDER BY created_at DESC").all() as { id: string; title: string; body: string; min_role: Role; author_id: string; created_at: string }[])
    .filter(d => canReadDoc(c.user, d.min_role))
    .filter(d => !needle || d.title.toLowerCase().includes(needle) || d.body.toLowerCase().includes(needle))
    .map(d => ({ id: d.id, title: d.title, excerpt: excerpt(d.body), min_role: d.min_role, author: ref(d.author_id), created_at: d.created_at }));
}
const excerpt = (md: string) => { const s = md.replace(/[#*_`>\[\]()-]/g, "").replace(/\s+/g, " ").trim(); return s.length > 160 ? s.slice(0, 157) + "…" : s; };

export function readKb(c: Ctx, id: string) {
  const d = c.db.prepare("SELECT * FROM kb_docs WHERE id=?").get(id) as { id: string; title: string; body: string; min_role: Role; author_id: string; created_at: string } | undefined;
  if (!d) throw new NotFound(`Document ${id} not found`);
  if (!canReadDoc(c.user, d.min_role)) { audit(c, "read_kb", id, false, { min_role: d.min_role }); throw new Forbidden(`"${d.title}" is restricted to ${d.min_role === "pm" ? "the PM" : "seniors and above"}`); }
  const ix = loadIndex(c.db);
  const linked = (c.db.prepare("SELECT t.id, t.title FROM task_docs td JOIN tasks t ON t.id=td.task_id WHERE td.doc_id=?").all(id) as { id: string; title: string }[]).filter(t => canSeeTask(ix, c.user, t.id));
  return { id: d.id, title: d.title, body: d.body, min_role: d.min_role, author: userRefs(c.db)(d.author_id), created_at: d.created_at, linked_tasks: linked };
}

export function getArtifact(c: Ctx, id: string) {
  const a = c.db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as { task_id: string; name: string; mime: string; data: Buffer } | undefined;
  if (!a || !canSeeTask(loadIndex(c.db), c.user, a.task_id)) throw new NotFound("Artifact not found");
  return a;
}

/** PM-only relational graph: project → milestones → tasks → subtasks, plus dependencies, mentions and people. */
export function graph(c: Ctx) {
  if (c.user.role !== "pm") throw new Forbidden("The project graph is available to the PM only");
  const ix = loadIndex(c.db);
  const ref = userRefs(c.db);
  const project = c.db.prepare("SELECT id, name FROM projects LIMIT 1").get() as { id: string; name: string };
  const tasks = c.db.prepare("SELECT * FROM tasks").all() as TaskRow[];
  const liveUsers = new Set((c.db.prepare("SELECT user_id, last_seen FROM agent_sessions").all() as { user_id: string; last_seen: string }[])
    .filter(s => Date.now() - Date.parse(s.last_seen) < LIVE_MS).map(s => s.user_id));
  const nodes: Record<string, unknown>[] = [{ id: `project:${project.id}`, type: "project", label: project.name }];
  const edges: { source: string; target: string; type: string }[] = [];
  for (const m of c.db.prepare("SELECT id, name FROM milestones ORDER BY due").all() as { id: string; name: string }[]) {
    nodes.push({ id: `milestone:${m.id}`, type: "milestone", label: m.name });
    edges.push({ source: `project:${project.id}`, target: `milestone:${m.id}`, type: "contains" });
  }
  const people = new Set<string>();
  for (const t of tasks) {
    nodes.push({ id: `task:${t.id}`, type: "task", label: `${t.id} ${t.title}`, status: t.status, due: t.due, overdue: isOverdue(t.due, t.status), department: (ix.departments.get(t.id) ?? [])[0] ?? null, live: !!liveFor(c.db, t.id), parent_id: t.parent_id ? `task:${t.parent_id}` : null });
    edges.push(t.parent_id ? { source: `task:${t.parent_id}`, target: `task:${t.id}`, type: "subtask" } : { source: `milestone:${t.milestone_id}`, target: `task:${t.id}`, type: "contains" });
    for (const w of ix.workers.get(t.id) ?? []) { people.add(w); edges.push({ source: `person:${w}`, target: `task:${t.id}`, type: "works_on" }); }
  }
  for (const p of people) { const u = ref(p); nodes.push({ id: `person:${p}`, type: "person", label: u.name, role: u.role, department: u.department, live: liveUsers.has(p) }); }
  const seen = new Set<string>();
  for (const l of c.db.prepare("SELECT from_task, to_task, type FROM task_links").all() as { from_task: string; to_task: string; type: string }[]) {
    const key = l.type === "mentions" ? [l.from_task, l.to_task].sort().join("|") + "|m" : `${l.from_task}|${l.to_task}|d`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: `task:${l.from_task}`, target: `task:${l.to_task}`, type: l.type });
  }
  return { nodes, edges };
}

// ---------- agent writes (MCP) ----------
function touchSession(c: Ctx, patch: { taskId?: string | null; activity?: string } = {}) {
  const name = c.agentName || `${c.user.name}'s agent`;
  const cur = c.db.prepare("SELECT task_id, started_at FROM agent_sessions WHERE user_id=?").get(c.user.id) as { task_id: string | null; started_at: string } | undefined;
  const ts = now();
  const taskId = patch.taskId === undefined ? cur?.task_id ?? null : patch.taskId;
  const started = !cur || taskId !== cur.task_id ? ts : cur.started_at;
  c.db.prepare(`INSERT INTO agent_sessions (user_id, agent_name, task_id, activity, started_at, last_seen) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET agent_name=excluded.agent_name, task_id=excluded.task_id,
      activity=COALESCE(?, agent_sessions.activity), started_at=excluded.started_at, last_seen=excluded.last_seen`)
    .run(c.user.id, name, taskId, patch.activity ?? "", started, ts, patch.activity ?? null);
}
/** Called on every MCP request so the live view knows the agent is online. */
export const heartbeat = (c: Ctx) => touchSession(c);

function workerTask(c: Ctx, id: string) {
  const ix = loadIndex(c.db);
  const t = visibleTask(c, ix, id);
  if (!isWorker(ix, c.user, id)) throw new Forbidden(`${c.user.name} is not a worker on ${id}; only its workers can change it`);
  return t;
}

const MENTION = /\bT-\d+\b/g;
/** Obsidian-style backlinks: any task id mentioned in text links the two tasks. */
export function extractMentions(db: DB, fromTask: string, text: string, source: string) {
  for (const id of new Set(text.match(MENTION) ?? [])) {
    if (id !== fromTask && taskRow(db, id)) db.prepare("INSERT OR IGNORE INTO task_links (from_task, to_task, type, source) VALUES (?,?,'mentions',?)").run(fromTask, id, source);
  }
}

type Report = { summary: string; agentsUsed?: string[]; costUsd?: number; links?: { label: string; url: string }[] };

function addUpdate(c: Ctx, taskId: string, kind: string, r: Report, from: Status | null, to: Status | null) {
  const res = c.db.prepare("INSERT INTO task_updates (task_id,user_id,via,agent_name,kind,status_from,status_to,summary,agents_used,cost_usd,links,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(taskId, c.user.id, c.via, c.via === "agent" ? c.agentName || `${c.user.name}'s agent` : null, kind, from, to, r.summary,
      JSON.stringify(r.agentsUsed ?? []), Math.max(0, Number(r.costUsd) || 0), JSON.stringify(r.links ?? []), now());
  extractMentions(c.db, taskId, r.summary, `update:${res.lastInsertRowid}`);
  return Number(res.lastInsertRowid);
}

function setStatus(c: Ctx, id: string, to: Status) {
  c.db.prepare("UPDATE tasks SET status=?, updated_at=? WHERE id=?").run(to, now(), id);
}

export function startTask(c: Ctx, id: string, plan: string) {
  return guarded(c, "start_task", id, () => {
    const t = workerTask(c, id);
    if (t.status === "done" || t.status === "review") throw new BadRequest(`${id} is ${t.status}; it can't be started`);
    const tx = c.db.transaction(() => {
      if (t.status === "todo") setStatus(c, id, "in_progress");
      addUpdate(c, id, "status", { summary: plan || "Started work" }, t.status, "in_progress");
      touchSession(c, { taskId: id, activity: firstLine(plan || "Started work") });
    });
    tx();
    emit(c.db, "task.status_changed", { task_id: id, from: t.status, to: "in_progress", by: c.user.id });
    return getTask(c, id);
  });
}

export function reportProgress(c: Ctx, id: string, r: Report) {
  if (!r.summary?.trim()) throw new BadRequest("summary is required: explain what was done and how");
  return guarded(c, "report_progress", id, () => {
    const t = workerTask(c, id);
    if (t.status === "done" || t.status === "review") throw new BadRequest(`${id} is ${t.status}; progress can't be reported`);
    c.db.transaction(() => {
      if (t.status === "todo") setStatus(c, id, "in_progress");
      else c.db.prepare("UPDATE tasks SET updated_at=? WHERE id=?").run(now(), id);
      addUpdate(c, id, "progress", r, t.status === "todo" ? "todo" : null, t.status === "todo" ? "in_progress" : null);
      touchSession(c, { taskId: id, activity: firstLine(r.summary) });
    })();
    emit(c.db, "task.progress", { task_id: id, by: c.user.id, summary: r.summary, cost_usd: r.costUsd ?? 0 });
    return getTask(c, id);
  });
}

export function submitTask(c: Ctx, id: string, r: Report) {
  if (!r.summary || r.summary.trim().length < 20) throw new BadRequest("A completion explanation (at least 20 characters) is required: how was the task done?");
  return guarded(c, "submit_task", id, () => {
    const t = workerTask(c, id);
    if (t.status === "done" || t.status === "review") throw new BadRequest(`${id} is already ${t.status}`);
    c.db.transaction(() => {
      setStatus(c, id, "review");
      addUpdate(c, id, "completion", r, t.status, "review");
      touchSession(c, { taskId: null, activity: `Submitted ${id} for review` });
    })();
    emit(c.db, "task.submitted", { task_id: id, by: c.user.id, summary: r.summary });
    return getTask(c, id);
  });
}

const MAX_ARTIFACT = 5 * 1024 * 1024;
export function attachArtifact(c: Ctx, id: string, a: { name: string; mime: string; base64?: string; text?: string }) {
  return guarded(c, "attach_artifact", id, () => {
    workerTask(c, id);
    if (!a.name || !a.mime) throw new BadRequest("name and mime are required");
    const data = a.base64 != null ? Buffer.from(a.base64, "base64") : Buffer.from(a.text ?? "", "utf8");
    if (!data.length) throw new BadRequest("Provide base64 or text content");
    if (data.length > MAX_ARTIFACT) throw new BadRequest("Artifact exceeds 5 MB");
    const aid = randomBytes(8).toString("hex");
    c.db.prepare("INSERT INTO artifacts (id,task_id,user_id,name,mime,data,created_at) VALUES (?,?,?,?,?,?,?)").run(aid, id, c.user.id, a.name, a.mime, data, now());
    touchSession(c, { taskId: id, activity: `Attached ${a.name}` });
    const url = `/api/artifacts/${aid}`;
    return { id: aid, url, markdown: a.mime.startsWith("image/") ? `![${a.name}](${url})` : `[${a.name}](${url})` };
  });
}

// ---------- human writes (UI) ----------
export function approveTask(c: Ctx, id: string, note?: string) {
  return guarded(c, "approve", id, () => {
    const ix = loadIndex(c.db);
    const t = visibleTask(c, ix, id);
    if (!canApprove(ix, c.user, id)) throw new Forbidden(c.user.role === "junior" ? "Juniors (and their agents) can't approve tasks; a senior or the PM must." : `${c.user.name} can't approve ${id}`);
    if (t.status !== "review") throw new BadRequest(`${id} is ${t.status}; only tasks in review can be approved`);
    c.db.transaction(() => { setStatus(c, id, "done"); addUpdate(c, id, "approval", { summary: note?.trim() || "Approved" }, "review", "done"); })();
    emit(c.db, "task.approved", { task_id: id, by: c.user.id });
    return getTask(c, id);
  });
}

export function reopenTask(c: Ctx, id: string, note: string) {
  if (!note?.trim()) throw new BadRequest("A note is required when sending work back");
  return guarded(c, "reopen", id, () => {
    const ix = loadIndex(c.db);
    const t = visibleTask(c, ix, id);
    if (!canApprove(ix, c.user, id)) throw new Forbidden(`${c.user.name} can't send ${id} back`);
    if (t.status !== "review") throw new BadRequest(`${id} is ${t.status}; only tasks in review can be sent back`);
    c.db.transaction(() => { setStatus(c, id, "in_progress"); addUpdate(c, id, "status", { summary: note }, "review", "in_progress"); })();
    emit(c.db, "task.status_changed", { task_id: id, from: "review", to: "in_progress", by: c.user.id });
    return getTask(c, id);
  });
}

// ---------- PM setup ----------
function requirePm(c: Ctx) { if (c.user.role !== "pm") throw new Forbidden("Only the PM can do this"); }

export function createMilestone(c: Ctx, m: { name: string; due?: string }) {
  return guarded(c, "create_milestone", null, () => {
    requirePm(c);
    if (!m.name?.trim()) throw new BadRequest("name is required");
    const n = (c.db.prepare("SELECT COUNT(*) AS n FROM milestones").get() as { n: number }).n + 1;
    const id = `M-${n}`;
    const p = c.db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    c.db.prepare("INSERT INTO milestones (id, project_id, name, due) VALUES (?,?,?,?)").run(id, p.id, m.name, m.due ?? null);
    return { id, name: m.name, due: m.due ?? null };
  });
}

export type NewTask = { milestoneId: string; parentId?: string; title: string; description?: string; scope?: string;
  departments?: string[]; workers?: string[]; access?: string[]; dependsOn?: string[]; docIds?: string[]; id?: string; status?: Status; due?: string };

/** Insert a fully specified task row (used by the PM endpoint and the seed). */
export function insertTask(db: DB, t: NewTask, createdBy: string) {
  const id = t.id ?? `T-${((db.prepare("SELECT MAX(CAST(SUBSTR(id,3) AS INTEGER)) AS n FROM tasks").get() as { n: number | null }).n ?? 0) + 1}`;
  const p = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
  const ts = now();
  db.prepare("INSERT INTO tasks (id,project_id,milestone_id,parent_id,title,description,scope,status,due,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, p.id, t.milestoneId, t.parentId ?? null, t.title, t.description ?? "", t.scope ?? "", t.status ?? "todo", t.due ?? null, createdBy, ts, ts);
  for (const d of t.departments ?? []) db.prepare("INSERT INTO task_departments VALUES (?,?)").run(id, d);
  for (const u of t.workers ?? []) db.prepare("INSERT INTO task_people VALUES (?,?,'worker')").run(id, u);
  for (const u of t.access ?? []) db.prepare("INSERT INTO task_people VALUES (?,?,'access')").run(id, u);
  for (const d of t.dependsOn ?? []) db.prepare("INSERT INTO task_links (from_task,to_task,type,source) VALUES (?,?,'depends_on','pm')").run(id, d);
  for (const d of t.docIds ?? []) db.prepare("INSERT INTO task_docs VALUES (?,?)").run(id, d);
  extractMentions(db, id, `${t.description ?? ""} ${t.scope ?? ""}`, "description");
  return id;
}

export function createTask(c: Ctx, t: NewTask) {
  return guarded(c, "create_task", null, () => {
    requirePm(c);
    if (!t.title?.trim() || !t.milestoneId) throw new BadRequest("title and milestoneId are required");
    if (!c.db.prepare("SELECT 1 FROM milestones WHERE id=?").get(t.milestoneId)) throw new NotFound(`Milestone ${t.milestoneId} not found`);
    const id = c.db.transaction(() => insertTask(c.db, { ...t, id: undefined, status: "todo" }, c.user.id))();
    return getTask(c, id);
  });
}

export function createDoc(c: Ctx, d: { title: string; body: string; minRole?: Role }) {
  return guarded(c, "create_doc", null, () => {
    requirePm(c);
    if (!d.title?.trim() || !d.body?.trim()) throw new BadRequest("title and body are required");
    const n = (c.db.prepare("SELECT COUNT(*) AS n FROM kb_docs").get() as { n: number }).n + 1;
    const id = `K-${n}`;
    const p = c.db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    c.db.prepare("INSERT INTO kb_docs (id,project_id,title,body,min_role,author_id,created_at) VALUES (?,?,?,?,?,?,?)").run(id, p.id, d.title, d.body, d.minRole ?? "junior", c.user.id, now());
    return readKb(c, id);
  });
}

export function addWebhook(c: Ctx, w: { url: string; events?: string[] }) {
  return guarded(c, "add_webhook", null, () => {
    requirePm(c);
    if (!/^https?:\/\//.test(w.url ?? "")) throw new BadRequest("url must be http(s)");
    const r = c.db.prepare("INSERT INTO webhooks (url, events, created_by) VALUES (?,?,?)").run(w.url, JSON.stringify(w.events ?? ["*"]), c.user.id);
    return { id: Number(r.lastInsertRowid), url: w.url, events: w.events ?? ["*"] };
  });
}

export function auditLog(c: Ctx) {
  requirePm(c);
  const ref = userRefs(c.db);
  return (c.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 200").all() as { actor_id: string }[]).map(r => ({ ...r, actor: ref(r.actor_id) }));
}

const firstLine = (s: string) => { const l = s.trim().split("\n")[0].replace(/[#*_`]/g, ""); return l.length > 120 ? l.slice(0, 117) + "…" : l; };
