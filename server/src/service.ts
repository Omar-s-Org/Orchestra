// Single service layer used by both REST (UI) and MCP (agents). Every call is permission-checked and audited.
import { randomBytes } from "node:crypto";
import { type DB, now } from "./db.js";
import {
  type User, type Task, type Doc, type Status, type Action,
  canSeeTask, canReadDoc, contactsOf, allowedActions, checkStatusChange, canCreateTask, checkScopeGrant,
  isProjectMember, Forbidden, NotFound, BadRequest, LEVEL,
} from "./permissions.js";

export type Via = "ui" | "agent";
export type Ctx = { db: DB; user: User; via: Via };

export function userByToken(db: DB, token: string): User | undefined {
  return db.prepare("SELECT id,name,role,title,department FROM users WHERE token=?").get(token) as User | undefined;
}
export function userById(db: DB, id: string): User | undefined {
  return db.prepare("SELECT id,name,role,title,department FROM users WHERE id=?").get(id) as User | undefined;
}

function audit(c: Ctx, action: string, entity: string, entityId: string | null, projectId: string | null, allowed: boolean, detail?: unknown) {
  c.db.prepare("INSERT INTO audit (at,actor_id,via,action,entity,entity_id,project_id,allowed,detail) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(now(), c.user.id, c.via, action, entity, entityId, projectId, allowed ? 1 : 0, detail === undefined ? null : JSON.stringify(detail));
}

/** Run a write; log denials too, so overrides and refused agent actions are visible. */
function guarded<T>(c: Ctx, action: string, entity: string, id: string | null, projectId: string | null, fn: () => T, detail?: unknown): T {
  try {
    const r = fn();
    audit(c, action, entity, id, projectId, true, detail);
    return r;
  } catch (e) {
    if (e instanceof Forbidden) audit(c, action, entity, id, projectId, false, { ...(detail as object), reason: e.message });
    throw e;
  }
}

function getTaskRow(db: DB, id: string): Task & Record<string, unknown> {
  const t = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as (Task & Record<string, unknown>) | undefined;
  if (!t) throw new NotFound(`Task ${id} not found`);
  return t;
}

function visibleTask(c: Ctx, id: string) {
  const t = getTaskRow(c.db, id);
  if (!canSeeTask(c.db, c.user, t)) throw new NotFound(`Task ${id} not found`); // don't leak existence
  return t;
}

const names = (db: DB) => {
  const m = new Map<string, string>();
  for (const r of db.prepare("SELECT id,name FROM users").all() as { id: string; name: string }[]) m.set(r.id, r.name);
  return (id: string | null) => (id ? { id, name: m.get(id) ?? id } : null);
};

function present(c: Ctx, t: Task & Record<string, unknown>) {
  const n = names(c.db);
  return { ...t, assignee: n(t.assignee_id), lead: n(t.lead_id), allowed_actions: allowedActions(c.db, c.user, t) };
}

export function me(c: Ctx) {
  const projects = c.db.prepare(c.user.role === "admin" ? "SELECT * FROM projects" :
    "SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=?").all(...(c.user.role === "admin" ? [] : [c.user.id]));
  return { user: c.user, level: LEVEL[c.user.role], view: c.user.role === "contributor" || c.user.role === "lead" ? "collaborate" : "manage", projects };
}

export function listTasks(c: Ctx, f: { projectId?: string; mine?: boolean; status?: Status } = {}) {
  let rows = c.db.prepare("SELECT * FROM tasks ORDER BY project_id, milestone_id, id").all() as (Task & Record<string, unknown>)[];
  rows = rows.filter(t => canSeeTask(c.db, c.user, t));
  if (f.projectId) rows = rows.filter(t => t.project_id === f.projectId);
  if (f.mine) rows = rows.filter(t => t.assignee_id === c.user.id);
  if (f.status) rows = rows.filter(t => t.status === f.status);
  return rows.map(t => present(c, t));
}

export function getTask(c: Ctx, id: string) {
  const t = visibleTask(c, id);
  const n = names(c.db);
  const scope = c.db.prepare("SELECT kind, ref_id FROM task_scope WHERE task_id=?").all(id) as { kind: string; ref_id: string }[];
  const docs = scope.filter(s => s.kind === "document").map(s => c.db.prepare("SELECT id,title,classification FROM documents WHERE id=?").get(s.ref_id) as Doc & { title: string })
    .filter(Boolean).map(d => ({ id: d.id, title: d.title, classification: d.classification, readable: canReadDoc(c.db, c.user, d) }));
  return {
    ...present(c, t),
    subtasks: (c.db.prepare("SELECT * FROM tasks WHERE parent_id=?").all(id) as (Task & Record<string, unknown>)[]).filter(s => canSeeTask(c.db, c.user, s)).map(s => present(c, s)),
    scope: {
      documents: docs,
      people: scope.filter(s => s.kind === "person").map(s => ({ ...n(s.ref_id)!, ...(userById(c.db, s.ref_id) ?? {}) })),
      tasks: scope.filter(s => s.kind === "task").map(s => s.ref_id),
    },
    comments: (c.db.prepare("SELECT * FROM comments WHERE task_id=? ORDER BY id").all(id) as { author_id: string }[]).map(x => ({ ...x, author: n(x.author_id) })),
  };
}

export function setStatus(c: Ctx, id: string, to: Status, note?: string) {
  const t = visibleTask(c, id);
  return guarded(c, "set_status", "task", id, t.project_id, () => {
    checkStatusChange(c.db, c.user, t, to);
    c.db.prepare("UPDATE tasks SET status=?, updated_at=? WHERE id=?").run(to, now(), id);
    if (note) c.db.prepare("INSERT INTO comments (task_id,author_id,via,body,at) VALUES (?,?,?,?,?)").run(id, c.user.id, c.via, note, now());
    return getTask(c, id);
  }, { from: t.status, to });
}

export function addComment(c: Ctx, id: string, body: string) {
  const t = visibleTask(c, id);
  if (!body?.trim()) throw new BadRequest("Empty comment");
  return guarded(c, "comment", "task", id, t.project_id, () => {
    c.db.prepare("INSERT INTO comments (task_id,author_id,via,body,at) VALUES (?,?,?,?,?)").run(id, c.user.id, c.via, body, now());
    return getTask(c, id);
  });
}

function need(c: Ctx, t: Task, a: Action) {
  if (!allowedActions(c.db, c.user, t).includes(a)) throw new Forbidden(`${c.user.name} is not allowed to ${a} on ${t.id}`);
}

export function createTask(c: Ctx, input: { projectId?: string; parentId?: string; milestoneId?: string; title: string; description?: string; assigneeId?: string; due?: string }) {
  if (!input.title?.trim()) throw new BadRequest("title required");
  let projectId = input.projectId;
  let milestoneId = input.milestoneId ?? null;
  if (input.parentId) {
    const p = visibleTask(c, input.parentId);
    projectId = p.project_id; milestoneId = p.milestone_id;
  }
  if (!projectId) throw new BadRequest("projectId or parentId required");
  const id = nextTaskId(c.db);
  return guarded(c, input.parentId ? "create_subtask" : "create_task", "task", id, projectId, () => {
    if (input.parentId) need(c, getTaskRow(c.db, input.parentId), "create_subtask");
    else if (!canCreateTask(c.db, c.user, projectId!)) throw new Forbidden(`${c.user.name} cannot create top-level tasks (lead or above required)`);
    if (input.assigneeId && input.assigneeId !== c.user.id && LEVEL[c.user.role] < LEVEL.lead)
      throw new Forbidden("Contributors can only create subtasks for themselves");
    const ts = now();
    c.db.prepare("INSERT INTO tasks (id,project_id,milestone_id,parent_id,title,description,status,assignee_id,lead_id,created_by,due,created_at,updated_at) VALUES (?,?,?,?,?,?,'todo',?,?,?,?,?,?)")
      .run(id, projectId, milestoneId, input.parentId ?? null, input.title, input.description ?? null, input.assigneeId ?? c.user.id,
        LEVEL[c.user.role] >= LEVEL.lead ? c.user.id : (input.parentId ? getTaskRow(c.db, input.parentId).lead_id : null), c.user.id, input.due ?? null, ts, ts);
    return getTask(c, id);
  }, { title: input.title });
}

function nextTaskId(db: DB) {
  const r = db.prepare("SELECT MAX(CAST(SUBSTR(id,3) AS INTEGER)) AS n FROM tasks WHERE id LIKE 'T-%'").get() as { n: number | null };
  return `T-${(r.n ?? 0) + 1}`;
}

export function assignTask(c: Ctx, id: string, assigneeId: string) {
  const t = visibleTask(c, id);
  return guarded(c, "assign", "task", id, t.project_id, () => {
    need(c, t, "assign");
    if (!userById(c.db, assigneeId)) throw new NotFound(`User ${assigneeId} not found`);
    c.db.prepare("UPDATE tasks SET assignee_id=?, updated_at=? WHERE id=?").run(assigneeId, now(), id);
    // Assignee joins the project so project-visible docs are readable.
    c.db.prepare("INSERT OR IGNORE INTO project_members (project_id,user_id) VALUES (?,?)").run(t.project_id, assigneeId);
    return getTask(c, id);
  }, { assigneeId });
}

export function grantScope(c: Ctx, id: string, kind: "document" | "person" | "task", refId: string) {
  const t = visibleTask(c, id);
  return guarded(c, "grant_scope", "task", id, t.project_id, () => {
    need(c, t, "edit_scope");
    checkScopeGrant(c.db, c.user, t.assignee_id ? userById(c.db, t.assignee_id)! : null, kind, refId);
    c.db.prepare("INSERT OR IGNORE INTO task_scope (task_id,kind,ref_id,granted_by) VALUES (?,?,?,?)").run(id, kind, refId, c.user.id);
    return getTask(c, id);
  }, { kind, refId });
}

export function revokeScope(c: Ctx, id: string, kind: string, refId: string) {
  const t = visibleTask(c, id);
  return guarded(c, "revoke_scope", "task", id, t.project_id, () => {
    need(c, t, "edit_scope");
    c.db.prepare("DELETE FROM task_scope WHERE task_id=? AND kind=? AND ref_id=?").run(id, kind, refId);
    return getTask(c, id);
  }, { kind, refId });
}

export function listDocuments(c: Ctx, q?: string) {
  const rows = c.db.prepare("SELECT id,project_id,title,classification,visibility,owner_id,tags FROM documents").all() as (Doc & { title: string; tags: string })[];
  const needle = q?.toLowerCase();
  return rows.filter(d => canReadDoc(c.db, c.user, d))
    .filter(d => !needle || d.title.toLowerCase().includes(needle) || (d.tags ?? "").toLowerCase().includes(needle) ||
      ((c.db.prepare("SELECT body FROM documents WHERE id=?").get(d.id) as { body: string }).body.toLowerCase().includes(needle)));
}

export function readDocument(c: Ctx, id: string) {
  const d = c.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as (Doc & Record<string, unknown>) | undefined;
  if (!d) throw new NotFound(`Document ${id} not found`);
  if (!canReadDoc(c.db, c.user, d)) {
    audit(c, "read_document", "document", id, d.project_id, false, { classification: d.classification });
    throw new Forbidden(`You do not have access to document ${id} (${d.classification})`);
  }
  audit(c, "read_document", "document", id, d.project_id, true);
  return d;
}

export function listContacts(c: Ctx) {
  return [...contactsOf(c.db, c.user)].map(id => userById(c.db, id)).filter(Boolean);
}

export function sendMessage(c: Ctx, toId: string, body: string, taskId?: string) {
  return guarded(c, "send_message", "user", toId, null, () => {
    if (!contactsOf(c.db, c.user).has(toId)) throw new Forbidden(`${toId} is not in your task scope. Ask your lead to add them to a task's people.`);
    if (!body?.trim()) throw new BadRequest("Empty message");
    if (taskId) visibleTask(c, taskId);
    const r = c.db.prepare("INSERT INTO messages (from_id,to_id,task_id,via,body,at) VALUES (?,?,?,?,?,?)").run(c.user.id, toId, taskId ?? null, c.via, body, now());
    return { id: r.lastInsertRowid, to: toId, task_id: taskId ?? null };
  }, { taskId });
}

export function inbox(c: Ctx) {
  const n = names(c.db);
  return (c.db.prepare("SELECT * FROM messages WHERE to_id=? OR from_id=? ORDER BY id DESC LIMIT 100").all(c.user.id, c.user.id) as { from_id: string; to_id: string }[])
    .map(m => ({ ...m, from: n(m.from_id), to: n(m.to_id) }));
}

/** Management view: roll-up of a project. Managers (project members) and admins only. */
export function projectOverview(c: Ctx, projectId: string) {
  if (!(c.user.role === "admin" || (c.user.role === "manager" && isProjectMember(c.db, c.user, projectId))))
    throw new Forbidden("Project overview requires manager or admin");
  const project = c.db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
  if (!project) throw new NotFound(`Project ${projectId} not found`);
  const tasks = c.db.prepare("SELECT * FROM tasks WHERE project_id=?").all(projectId) as (Task & { due: string | null })[];
  const count = (ts: Task[]) => {
    const by: Record<string, number> = { todo: 0, in_progress: 0, blocked: 0, review: 0, done: 0 };
    ts.forEach(t => by[t.status]++);
    return { total: ts.length, ...by, pct_done: ts.length ? Math.round((by.done / ts.length) * 100) : 0 };
  };
  const n = names(c.db);
  const workstreams = (c.db.prepare("SELECT * FROM workstreams WHERE project_id=?").all(projectId) as { id: string; name: string; owner_id: string }[]).map(w => {
    const ms = (c.db.prepare("SELECT * FROM milestones WHERE workstream_id=? ORDER BY due").all(w.id) as { id: string; name: string; due: string }[])
      .map(m => ({ ...m, progress: count(tasks.filter(t => t.milestone_id === m.id)) }));
    return { ...w, owner: n(w.owner_id), milestones: ms, progress: count(tasks.filter(t => ms.some(m => m.id === t.milestone_id))) };
  });
  const people = new Map<string, Task[]>();
  tasks.forEach(t => t.assignee_id && people.set(t.assignee_id, [...(people.get(t.assignee_id) ?? []), t]));
  const agentActions = (c.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE project_id=? AND via='agent' AND allowed=1").get(projectId) as { n: number }).n;
  const denied = (c.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE project_id=? AND allowed=0").get(projectId) as { n: number }).n;
  return {
    project, progress: count(tasks), workstreams,
    blocked: tasks.filter(t => t.status === "blocked").map(t => present(c, t as Task & Record<string, unknown>)),
    awaiting_review: tasks.filter(t => t.status === "review").map(t => present(c, t as Task & Record<string, unknown>)),
    people: [...people.entries()].map(([id, ts]) => ({ ...n(id)!, ...count(ts) })),
    metrics: { agent_actions: agentActions, denied_actions: denied },
  };
}

export function auditLog(c: Ctx, projectId?: string) {
  if (LEVEL[c.user.role] < LEVEL.manager) throw new Forbidden("Audit log requires manager or admin");
  const n = names(c.db);
  const rows = c.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 300").all() as { actor_id: string; project_id: string | null }[];
  return rows.filter(r => c.user.role === "admin" || (r.project_id ? isProjectMember(c.db, c.user, r.project_id) : r.actor_id === c.user.id))
    .filter(r => !projectId || r.project_id === projectId).map(r => ({ ...r, actor: n(r.actor_id) }));
}

// ---- Admin ----
function requireAdmin(c: Ctx) { if (c.user.role !== "admin") throw new Forbidden("Admin only"); }

export function listUsers(c: Ctx) {
  return c.db.prepare(`SELECT id,name,email,title,department,role${c.user.role === "admin" ? ",token" : ""} FROM users ORDER BY name`).all();
}

export function createUser(c: Ctx, u: { name: string; role: User["role"]; title?: string; department?: string; email?: string }) {
  requireAdmin(c);
  const id = u.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const token = `tok_${randomBytes(12).toString("hex")}`;
  return guarded(c, "create_user", "user", id, null, () => {
    c.db.prepare("INSERT INTO users (id,name,email,title,department,role,token) VALUES (?,?,?,?,?,?,?)").run(id, u.name, u.email ?? null, u.title ?? null, u.department ?? null, u.role, token);
    return { id, token };
  });
}

export function setRole(c: Ctx, userId: string, role: User["role"]) {
  requireAdmin(c);
  return guarded(c, "set_role", "user", userId, null, () => {
    if (!userById(c.db, userId)) throw new NotFound("user not found");
    c.db.prepare("UPDATE users SET role=? WHERE id=?").run(role, userId);
    return userById(c.db, userId);
  }, { role });
}

export function addMember(c: Ctx, projectId: string, userId: string) {
  if (!(c.user.role === "admin" || (c.user.role === "manager" && isProjectMember(c.db, c.user, projectId)))) throw new Forbidden("Manager or admin required");
  return guarded(c, "add_member", "project", projectId, projectId, () => {
    c.db.prepare("INSERT OR IGNORE INTO project_members (project_id,user_id) VALUES (?,?)").run(projectId, userId);
    return { ok: true };
  }, { userId });
}
