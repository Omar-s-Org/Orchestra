// Permission engine. Every read and write in REST and MCP goes through here.
// Model: role gives a clearance level + a capability ceiling; task assignment + task scope
// give concrete visibility. Clearance is a hard floor that no scope grant can bypass.
import type { DB } from "./db.js";

export type Role = "admin" | "manager" | "lead" | "contributor";
export type Status = "todo" | "in_progress" | "blocked" | "review" | "done";
export type Classification = "internal" | "restricted" | "confidential";

export const LEVEL: Record<Role, number> = { contributor: 1, lead: 2, manager: 3, admin: 4 };
// Minimum role level required to read a document of each classification.
export const CLEARANCE: Record<Classification, number> = { internal: 1, restricted: 2, confidential: 3 };

export type User = { id: string; name: string; role: Role; title?: string; department?: string };
export type Task = {
  id: string; project_id: string; milestone_id: string | null; parent_id: string | null;
  title: string; status: Status; assignee_id: string | null; lead_id: string | null; created_by: string | null;
};
export type Doc = { id: string; project_id: string; classification: Classification; visibility: "project" | "scoped"; owner_id: string | null };

export class Forbidden extends Error { status = 403; }
export class NotFound extends Error { status = 404; }
export class BadRequest extends Error { status = 400; }

const isAdmin = (u: User) => u.role === "admin";

export function isProjectMember(db: DB, u: User, projectId: string) {
  return isAdmin(u) || !!db.prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(projectId, u.id);
}

/** Managers oversee every task in projects they belong to (management view). */
function managesProject(db: DB, u: User, projectId: string) {
  return isAdmin(u) || (u.role === "manager" && isProjectMember(db, u, projectId));
}

/** Task ids this user holds directly (assignee or lead). */
function heldTaskIds(db: DB, u: User): string[] {
  return (db.prepare("SELECT id FROM tasks WHERE assignee_id=? OR lead_id=?").all(u.id, u.id) as { id: string }[]).map(r => r.id);
}

function ancestors(db: DB, taskId: string): string[] {
  const out: string[] = [];
  let cur = db.prepare("SELECT parent_id FROM tasks WHERE id=?").get(taskId) as { parent_id: string | null } | undefined;
  while (cur?.parent_id && !out.includes(cur.parent_id)) {
    out.push(cur.parent_id);
    cur = db.prepare("SELECT parent_id FROM tasks WHERE id=?").get(cur.parent_id) as typeof cur;
  }
  return out;
}

/** Scope grants reachable through tasks the user holds. */
function scopeRefs(db: DB, u: User, kind: "document" | "person" | "task"): Set<string> {
  const held = heldTaskIds(db, u);
  if (!held.length) return new Set();
  const rows = db.prepare(`SELECT ref_id FROM task_scope WHERE kind=? AND task_id IN (${held.map(() => "?").join(",")})`)
    .all(kind, ...held) as { ref_id: string }[];
  return new Set(rows.map(r => r.ref_id));
}

export function canSeeTask(db: DB, u: User, t: Task): boolean {
  if (managesProject(db, u, t.project_id)) return true;
  if (t.assignee_id === u.id || t.lead_id === u.id) return true;
  // Leads see the full subtree under tasks they lead; assignees see subtasks under their tasks.
  const anc = ancestors(db, t.id);
  const held = new Set(heldTaskIds(db, u));
  if (anc.some(a => held.has(a))) return true;
  return scopeRefs(db, u, "task").has(t.id);
}

export function canReadDoc(db: DB, u: User, d: Doc): boolean {
  if (isAdmin(u)) return true;
  if (LEVEL[u.role] < CLEARANCE[d.classification]) return false; // hard floor
  if (d.owner_id === u.id) return true;
  if (!isProjectMember(db, u, d.project_id)) return scopeRefs(db, u, "document").has(d.id);
  if (d.visibility === "project") return true;
  // "scoped" = need-to-know: owner, admin, or an explicit task-scope grant. Managers don't get it by rank alone.
  return scopeRefs(db, u, "document").has(d.id);
}

/** People this user may message: anyone on tasks they share, plus persons granted in task scope. Managers+: project members. */
export function contactsOf(db: DB, u: User): Set<string> {
  if (isAdmin(u)) return new Set((db.prepare("SELECT id FROM users").all() as { id: string }[]).map(r => r.id));
  const ids = new Set<string>(scopeRefs(db, u, "person"));
  const rows = db.prepare("SELECT assignee_id, lead_id, created_by FROM tasks WHERE assignee_id=? OR lead_id=?").all(u.id, u.id) as Record<string, string | null>[];
  for (const r of rows) for (const v of Object.values(r)) if (v) ids.add(v);
  if (u.role === "manager") {
    const m = db.prepare(`SELECT DISTINCT pm2.user_id AS id FROM project_members pm1 JOIN project_members pm2 ON pm1.project_id=pm2.project_id WHERE pm1.user_id=?`).all(u.id) as { id: string }[];
    m.forEach(r => ids.add(r.id));
  }
  // Anyone who granted you a person scope can reach you, and vice versa is covered above.
  ids.delete(u.id);
  return ids;
}

// ---- Actions ----
export type Action = "set_status" | "complete" | "comment" | "create_subtask" | "assign" | "edit_scope" | "create_task" | "delete";

const WORKER_STATUSES: Status[] = ["todo", "in_progress", "blocked", "review"];

/** Is this user the task's lead, or a manager/admin over its project? */
function supervises(db: DB, u: User, t: Task) {
  return managesProject(db, u, t.project_id) || t.lead_id === u.id || ancestors(db, t.id).some(a => {
    const p = db.prepare("SELECT lead_id FROM tasks WHERE id=?").get(a) as { lead_id: string | null };
    return p?.lead_id === u.id;
  });
}

export function allowedActions(db: DB, u: User, t: Task): Action[] {
  if (!canSeeTask(db, u, t)) return [];
  const a: Action[] = [];
  const sup = supervises(db, u, t);
  const isAssignee = t.assignee_id === u.id;
  if (isAssignee || sup) a.push("set_status", "comment", "create_subtask");
  else a.push("comment");
  if (sup) a.push("complete", "assign", "edit_scope");
  if (managesProject(db, u, t.project_id)) a.push("delete");
  return a;
}

/** Status change rules. Contributors (and their agents) can move work up to "review"; only a supervisor closes it. */
export function checkStatusChange(db: DB, u: User, t: Task, to: Status) {
  const acts = allowedActions(db, u, t);
  if (!acts.includes("set_status")) throw new Forbidden(`${u.name} cannot change the status of ${t.id}`);
  if (to === "done" && !acts.includes("complete"))
    throw new Forbidden(`Only the task lead or a project manager can mark ${t.id} done. Move it to "review" instead.`);
  if (t.status === "done" && !acts.includes("complete"))
    throw new Forbidden(`${t.id} is done; only its lead or a manager can reopen it.`);
  if (!WORKER_STATUSES.includes(to) && to !== "done") throw new BadRequest(`Unknown status ${to}`);
}

export function canCreateTask(db: DB, u: User, projectId: string) {
  return LEVEL[u.role] >= LEVEL.lead && isProjectMember(db, u, projectId);
}

/** A grant is valid only if the granter can see what they grant, and the grantee's clearance allows it. */
export function checkScopeGrant(db: DB, granter: User, grantee: User | null, kind: "document" | "person" | "task", refId: string) {
  if (kind === "document") {
    const d = db.prepare("SELECT * FROM documents WHERE id=?").get(refId) as Doc | undefined;
    if (!d) throw new NotFound(`Document ${refId} not found`);
    if (!canReadDoc(db, granter, d)) throw new Forbidden(`You cannot grant a document you cannot read`);
    if (grantee && LEVEL[grantee.role] < CLEARANCE[d.classification])
      throw new Forbidden(`${grantee.name} lacks clearance for ${d.classification} document "${refId}"`);
  } else if (kind === "task") {
    const t = db.prepare("SELECT * FROM tasks WHERE id=?").get(refId) as Task | undefined;
    if (!t) throw new NotFound(`Task ${refId} not found`);
    if (!canSeeTask(db, granter, t)) throw new Forbidden(`You cannot grant a task you cannot see`);
  } else {
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(refId)) throw new NotFound(`User ${refId} not found`);
  }
}
