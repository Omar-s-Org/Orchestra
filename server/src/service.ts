// Service layer shared by REST (UI) and MCP (agents). Every read is filtered by the visibility
// rule; every write is permission-checked and audited, including refusals.
import { randomBytes } from "node:crypto";
import { type DB, now } from "./db.js";
import { hashPassword, verifyPassword, newToken } from "./auth.js";
import {
  type User, type Role, type Status, type Index,
  loadIndex, canSeeTask, isWorker, canApproveMilestone, allowedActions, canReadDoc, capabilities,
  Forbidden, NotFound, BadRequest, HttpError, Locked, LEVEL,
} from "./permissions.js";
import { emit } from "./webhooks.js";

export type Via = "ui" | "agent";
export type Ctx = { db: DB; user: User; via: Via; agentName?: string };

const LIVE_MS = 60_000;
const WORKING_MS = 15 * 60_000;
const IDLE_MS = 30 * 60_000;
/**
 * An agent is active if it called in the last minute, or if it has a started task and called in the last
 * 15 minutes: agents doing long work never need to call just to look alive (that would cost tokens).
 */
const isActive = (s: { task_id: string | null; last_seen: string }) => {
  const age = Date.now() - Date.parse(s.last_seen);
  return age < LIVE_MS || (!!s.task_id && age < WORKING_MS);
};
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

/**
 * Everything a task summary needs besides the permission index, read in a handful of queries per request.
 * Summaries used to query milestone, cost, live agent and prerequisite titles per task (N+1).
 */
type Lookup = {
  ref: ReturnType<typeof userRefs>;
  milestone: Map<string, { id: string; name: string }>;
  cost: Map<string, number>;
  live: Map<string, { agent_name: string; activity: string; since: string }>;
  brief: Map<string, { id: string; title: string; status: Status }>;
};
function lookup(db: DB): Lookup {
  const live = new Map<string, { agent_name: string; activity: string; since: string }>();
  for (const s of db.prepare("SELECT task_id, agent_name, activity, started_at, last_seen FROM agent_sessions WHERE task_id IS NOT NULL").all() as { task_id: string; agent_name: string; activity: string; started_at: string; last_seen: string }[])
    if (!live.has(s.task_id) && isActive(s)) live.set(s.task_id, { agent_name: s.agent_name, activity: s.activity, since: s.started_at });
  return {
    ref: userRefs(db),
    milestone: new Map((db.prepare("SELECT id, name FROM milestones").all() as { id: string; name: string }[]).map(m => [m.id, m])),
    cost: new Map((db.prepare("SELECT task_id, SUM(cost_usd) AS s FROM task_updates GROUP BY task_id").all() as { task_id: string; s: number }[]).map(r => [r.task_id, r.s])),
    live,
    brief: new Map((db.prepare("SELECT id, title, status FROM tasks").all() as { id: string; title: string; status: Status }[]).map(t => [t.id, t])),
  };
}

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
  catch (e) { if (e instanceof Forbidden || e instanceof Locked) audit(c, action, id, false, { reason: e.message }); throw e; }
}

const taskRow = (db: DB, id: string) => db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as TaskRow | undefined;

function visibleTask(c: Ctx, ix: Index, id: string) {
  const t = taskRow(c.db, id);
  if (!t || !canSeeTask(ix, c.user, id)) throw new NotFound(`Task ${id} not found`); // don't leak existence
  return t;
}

function makeSummary(c: Ctx, ix: Index, t: TaskRow, L: Lookup) {
  const ref = L.ref;
  return {
    id: t.id, title: t.title, status: t.status,
    milestone: L.milestone.get(t.milestone_id) ?? { id: t.milestone_id, name: t.milestone_id },
    parent_id: t.parent_id,
    departments: ix.departments.get(t.id) ?? [],
    workers: (ix.workers.get(t.id) ?? []).map(ref),
    access: (ix.access.get(t.id) ?? []).map(ref),
    due: t.due,
    overdue: isOverdue(t.due, t.status),
    sequence: ix.order.sequence.get(t.id) ?? null,
    ...lockInfo(ix, t, L),
    live: L.live.get(t.id) ?? null,
    cost_usd: round(L.cost.get(t.id) ?? 0),
    updated_at: t.updated_at,
    allowed_actions: allowedActions(),
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** locked = a prerequisite isn't done yet. blocked_by lists those prerequisites (titles only if visible). */
function lockInfo(ix: Index, t: TaskRow, L: Lookup) {
  const open = t.status === "done" ? [] : ix.order.blockedBy(t.id);
  return { locked: open.length > 0, blocked_by: open.map(id => L.brief.get(id)!) };
}
/** A task is overdue once its due date (end of that day, UTC) has passed and it isn't done. */
export const isOverdue = (due: string | null, status: Status) => !!due && status !== "done" && Date.parse(`${due.slice(0, 10)}T23:59:59Z`) < Date.now();

function presentUpdate(u: UpdateRow, L: Lookup) {
  const t = L.brief.get(u.task_id);
  return {
    id: u.id, task: { id: u.task_id, title: t?.title ?? u.task_id }, kind: u.kind, via: u.via, user: L.ref(u.user_id), agent_name: u.agent_name,
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
  const L = lookup(c.db);
  const people = (id: string) => [...(ix.workers.get(id) ?? []), ...(ix.access.get(id) ?? [])];
  const seq = (id: string) => ix.order.sequence.get(id) ?? Infinity;
  return (c.db.prepare("SELECT * FROM tasks").all() as TaskRow[])
    .sort((a, b) => seq(a.id) - seq(b.id))
    .filter(t => canSeeTask(ix, c.user, t.id))
    .filter(t => !f.status || t.status === f.status)
    .filter(t => !f.department || (ix.departments.get(t.id) ?? []).includes(f.department))
    .filter(t => !f.person || people(t.id).includes(f.person))
    .filter(t => !f.mine || people(t.id).includes(c.user.id))
    .map(t => makeSummary(c, ix, t, L));
}

function linkedTasks(c: Ctx, ix: Index, L: Lookup, sql: string, ...args: string[]) {
  const ids = [...new Set((c.db.prepare(sql).all(...args) as { id: string }[]).map(r => r.id))];
  return ids.filter(id => L.brief.has(id) && canSeeTask(ix, c.user, id)).map(id => L.brief.get(id)!);
}

export function getTask(c: Ctx, id: string) {
  const ix = loadIndex(c.db);
  const t = visibleTask(c, ix, id);
  const L = lookup(c.db);
  return {
    ...makeSummary(c, ix, t, L),
    description: t.description, scope: t.scope,
    docs: (c.db.prepare("SELECT d.id, d.title, d.min_role FROM task_docs td JOIN kb_docs d ON d.id=td.doc_id WHERE td.task_id=?").all(id) as { id: string; title: string; min_role: Role }[])
      .map(d => ({ id: d.id, title: d.title, readable: canReadDoc(c.user, d.min_role) })),
    depends_on: linkedTasks(c, ix, L, "SELECT to_task AS id FROM task_links WHERE from_task=? AND type='depends_on'", id),
    blocks: linkedTasks(c, ix, L, "SELECT from_task AS id FROM task_links WHERE to_task=? AND type='depends_on'", id),
    mentions: linkedTasks(c, ix, L, "SELECT to_task AS id FROM task_links WHERE from_task=? AND type='mentions' UNION SELECT from_task FROM task_links WHERE to_task=? AND type='mentions'", id, id),
    subtasks: (c.db.prepare("SELECT * FROM tasks WHERE parent_id=? ORDER BY id").all(id) as TaskRow[]).filter(s => canSeeTask(ix, c.user, s.id)).map(s => makeSummary(c, ix, s, L)),
    updates: (c.db.prepare("SELECT * FROM task_updates WHERE task_id=? ORDER BY id DESC").all(id) as UpdateRow[]).map(u => presentUpdate(u, L)),
    artifacts: artifactsOf(c.db, id, L.ref),
  };
}

export function activity(c: Ctx, f: { limit?: number; task?: string; via?: string; kind?: string } = {}) {
  const ix = loadIndex(c.db);
  const L = lookup(c.db);
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const where: string[] = []; const args: string[] = [];
  if (f.task) { where.push("task_id=?"); args.push(f.task); }
  if (f.via) { where.push("via=?"); args.push(f.via); }
  if (f.kind) { where.push("kind=?"); args.push(f.kind); }
  // Stream newest-first and stop at the limit instead of loading the whole history on every poll.
  const out: ReturnType<typeof presentUpdate>[] = [];
  for (const u of c.db.prepare(`SELECT * FROM task_updates ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`).iterate(...args) as IterableIterator<UpdateRow>) {
    if (!canSeeTask(ix, c.user, u.task_id)) continue;
    out.push(presentUpdate(u, L));
    if (out.length >= limit) break;
  }
  return out;
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
    return { user: ref(s.user_id), agent_name: s.agent_name, status: isActive(s) ? "active" : "idle", task, activity: s.activity, last_seen: s.last_seen };
  });
}

export function overview(c: Ctx) {
  const ix = loadIndex(c.db);
  const L = lookup(c.db);
  const ref = L.ref;
  const tasks = (c.db.prepare("SELECT * FROM tasks").all() as TaskRow[]).filter(t => canSeeTask(ix, c.user, t.id));
  const by_status = { todo: 0, in_progress: 0, review: 0, done: 0 };
  const byMilestone = new Map<string, TaskRow[]>();
  for (const t of tasks) { by_status[t.status]++; byMilestone.set(t.milestone_id, [...(byMilestone.get(t.milestone_id) ?? []), t]); }
  // Sign-off state uses every task in the milestone, not only the ones this person can see.
  const tasksOf = milestoneTasks(c.db);
  const allOpen = new Map((c.db.prepare("SELECT milestone_id, COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks GROUP BY milestone_id").all() as { milestone_id: string; total: number; done: number }[]).map(r => [r.milestone_id, r]));
  const milestones = (c.db.prepare("SELECT id, name, due, approved_at, approved_by FROM milestones ORDER BY due").all() as { id: string; name: string; due: string; approved_at: string | null; approved_by: string | null }[]).map(({ approved_at, approved_by, ...m }) => {
    const ts = byMilestone.get(m.id) ?? [];
    const done = ts.filter(t => t.status === "done").length;
    const all = allOpen.get(m.id);
    return {
      ...m, total: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : 0,
      approved_at, approved_by: approved_by ? ref(approved_by) : null,
      ready_for_signoff: !approved_at && !!all && all.total > 0 && all.done === all.total,
      can_approve: canApproveMilestone(ix, c.user, tasksOf.get(m.id) ?? []),
    };
  });
  // Task-level review is gone (approval is per milestone); kept empty so older clients don't break.
  const review_queue: never[] = [];
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
    const doneCount = new Map<string, number>();
    for (const t of tasks) if (t.status === "done") for (const w of ix.workers.get(t.id) ?? []) doneCount.set(w, (doneCount.get(w) ?? 0) + 1);
    const doneBy = (uid: string) => doneCount.get(uid) ?? 0;
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
  const L = lookup(c.db);
  const ref = L.ref;
  const project = c.db.prepare("SELECT id, name FROM projects LIMIT 1").get() as { id: string; name: string };
  const tasks = c.db.prepare("SELECT * FROM tasks").all() as TaskRow[];
  const liveUsers = new Set((c.db.prepare("SELECT user_id, task_id, last_seen FROM agent_sessions").all() as { user_id: string; task_id: string | null; last_seen: string }[])
    .filter(isActive).map(s => s.user_id));
  const nodes: Record<string, unknown>[] = [{ id: `project:${project.id}`, type: "project", label: project.name }];
  const edges: { source: string; target: string; type: string }[] = [];
  for (const m of c.db.prepare("SELECT id, name FROM milestones ORDER BY due").all() as { id: string; name: string }[]) {
    nodes.push({ id: `milestone:${m.id}`, type: "milestone", label: m.name });
    edges.push({ source: `project:${project.id}`, target: `milestone:${m.id}`, type: "contains" });
  }
  const people = new Set<string>();
  for (const t of tasks) {
    nodes.push({ id: `task:${t.id}`, type: "task", label: `${t.id} ${t.title}`, status: t.status, due: t.due, overdue: isOverdue(t.due, t.status), locked: t.status !== "done" && ix.order.blockedBy(t.id).length > 0, sequence: ix.order.sequence.get(t.id) ?? null, department: (ix.departments.get(t.id) ?? [])[0] ?? null, live: L.live.has(t.id), parent_id: t.parent_id ? `task:${t.parent_id}` : null });
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
  const open = t.status === "done" ? [] : ix.order.blockedBy(id);
  if (open.length) {
    const list = open.map(d => `${d} (${ix.order.status.get(d)})`).join(", ");
    throw new Locked(`${id} is locked until its prerequisites are done: ${list}. Work on another unlocked task (see next_task) or wait for approval.`);
  }
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
    // Submitting completes the task (approval happens per milestone), so dependents unlock right away.
    c.db.transaction(() => {
      setStatus(c, id, "done");
      addUpdate(c, id, "completion", r, t.status, "done");
      touchSession(c, { taskId: null, activity: `Completed ${id}` });
    })();
    emit(c.db, "task.submitted", { task_id: id, by: c.user.id, summary: r.summary });
    const ms = c.db.prepare("SELECT m.id, m.name, SUM(t.status != 'done') AS open FROM milestones m JOIN tasks t ON t.milestone_id = m.id WHERE m.id = (SELECT milestone_id FROM tasks WHERE id=?) GROUP BY m.id").get(id) as { id: string; name: string; open: number } | undefined;
    if (ms && ms.open === 0) emit(c.db, "milestone.ready", { milestone_id: ms.id, name: ms.name, completed_by_task: id });
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

/** The suggested next task for the caller: first unlocked todo/in-progress task they work on, by sequence. */
export function nextTask(c: Ctx) {
  const mine = listTasks(c, { mine: true }).filter(t => t.workers.some(w => w.id === c.user.id));
  const open = mine.filter(t => t.status === "todo" || t.status === "in_progress");
  const next = open.find(t => !t.locked);
  return {
    next: next ?? null,
    waiting: open.filter(t => t.locked).map(t => ({ id: t.id, title: t.title, blocked_by: t.blocked_by })),
    note: next ? "Suggested order only: any unlocked task may be done first." : open.length ? "All your open tasks are locked by prerequisites that aren't done yet." : "No open tasks.",
  };
}

// ---------- PM setup ----------
function requirePm(c: Ctx) { if (c.user.role !== "pm") throw new Forbidden("Only the PM can do this"); }

/** Next free id like M-4 / K-6: one past the highest number used, so ids from a project file never collide. */
function nextId(db: DB, table: "milestones" | "kb_docs", prefix: string) {
  const ids = (db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[]).map(r => r.id);
  const max = Math.max(0, ...ids.filter(id => id.startsWith(prefix)).map(id => Number(id.slice(prefix.length)) || 0));
  return `${prefix}${max + 1}`;
}

/** Task ids per milestone. */
function milestoneTasks(db: DB) {
  const m = new Map<string, string[]>();
  for (const r of db.prepare("SELECT id, milestone_id FROM tasks").all() as { id: string; milestone_id: string }[]) m.set(r.milestone_id, [...(m.get(r.milestone_id) ?? []), r.id]);
  return m;
}

/** The PM (any milestone) or a senior (milestones fully in their department) approves a milestone once every task in it is done. */
export function approveMilestone(c: Ctx, id: string, note?: string) {
  return guarded(c, "approve_milestone", id, () => {
    const m = c.db.prepare("SELECT id, name, approved_at FROM milestones WHERE id=?").get(id) as { id: string; name: string; approved_at: string | null } | undefined;
    if (!m) throw new NotFound(`Milestone ${id} not found`);
    if (!canApproveMilestone(loadIndex(c.db), c.user, milestoneTasks(c.db).get(id) ?? []))
      throw new Forbidden(c.user.role === "junior" ? "Juniors (and their agents) can't approve milestones; a senior or the PM must." : `${c.user.name} can only approve milestones whose tasks are all in ${c.user.department}`);
    if (m.approved_at) throw new BadRequest(`${m.name} is already signed off`);
    const open = c.db.prepare("SELECT id, status FROM tasks WHERE milestone_id=? AND status != 'done' ORDER BY id").all(id) as { id: string; status: string }[];
    const total = (c.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE milestone_id=?").get(id) as { n: number }).n;
    if (!total) throw new BadRequest(`${m.name} has no tasks to sign off`);
    if (open.length) throw new Locked(`${m.name} still has open tasks: ${open.map(t => `${t.id} (${t.status})`).join(", ")}`);
    const at = now();
    c.db.prepare("UPDATE milestones SET approved_at=?, approved_by=? WHERE id=?").run(at, c.user.id, id);
    emit(c.db, "milestone.approved", { milestone_id: id, by: c.user.id, note: note?.trim() || null });
    return { id, name: m.name, approved_at: at, approved_by: userRefs(c.db)(c.user.id) };
  });
}

export function createMilestone(c: Ctx, m: { name: string; due?: string }) {
  return guarded(c, "create_milestone", null, () => {
    requirePm(c);
    if (!m.name?.trim()) throw new BadRequest("name is required");
    const id = nextId(c.db, "milestones", "M-");
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
    const ms = c.db.prepare("SELECT name, approved_at FROM milestones WHERE id=?").get(t.milestoneId) as { name: string; approved_at: string | null } | undefined;
    if (!ms) throw new NotFound(`Milestone ${t.milestoneId} not found`);
    if (ms.approved_at) throw new BadRequest(`${ms.name} is signed off; add the task to an open milestone`);
    // Every reference must exist, or the task would point at people/tasks/docs nobody can resolve.
    const missing = (table: string, ids: string[] | null = []) => (ids ?? []).filter(x => !c.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(x));
    const bad = [
      ...missing("users", [...(t.workers ?? []), ...(t.access ?? [])]).map(x => `unknown person "${x}"`),
      ...missing("tasks", [...(t.dependsOn ?? []), ...(t.parentId ? [t.parentId] : [])]).map(x => `unknown task "${x}"`),
      ...missing("kb_docs", t.docIds).map(x => `unknown doc "${x}"`),
    ];
    if (bad.length) throw new BadRequest(bad.join("; "));
    const id = c.db.transaction(() => insertTask(c.db, { ...t, id: undefined, status: "todo" }, c.user.id))();
    return getTask(c, id);
  });
}

export function createDoc(c: Ctx, d: { title: string; body: string; minRole?: Role }) {
  return guarded(c, "create_doc", null, () => {
    requirePm(c);
    if (!d.title?.trim() || !d.body?.trim()) throw new BadRequest("title and body are required");
    const id = nextId(c.db, "kb_docs", "K-");
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
