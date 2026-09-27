// One visibility rule for every endpoint (REST and MCP). The UI never decides permissions.
import type { DB } from "./db.js";
import { loadOrder, type Order } from "./ordering.js";

export type Role = "pm" | "senior" | "junior";
export type Status = "todo" | "in_progress" | "review" | "done";
export type User = { id: string; name: string; role: Role; department: string; email?: string; title?: string };

export const LEVEL: Record<Role, number> = { junior: 1, senior: 2, pm: 3 };

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export class Forbidden extends HttpError { constructor(m: string) { super(403, m); } }
export class NotFound extends HttpError { constructor(m: string) { super(404, m); } }
export class BadRequest extends HttpError { constructor(m: string) { super(400, m); } }
/** The task exists and you may work on it, but its prerequisites aren't done yet. */
export class Locked extends HttpError { constructor(m: string) { super(409, m); } }

type Row = { task_id: string };

/** Everything the visibility rule needs, loaded once per request. */
export type Index = {
  departments: Map<string, string[]>;
  workers: Map<string, string[]>;
  access: Map<string, string[]>;
  roles: Map<string, Role>;
  order: Order;
};

export function loadIndex(db: DB): Index {
  const group = (rows: (Row & { v: string })[]) => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r.v]);
    return m;
  };
  return {
    departments: group(db.prepare("SELECT task_id, department AS v FROM task_departments").all() as (Row & { v: string })[]),
    workers: group(db.prepare("SELECT task_id, user_id AS v FROM task_people WHERE relation='worker'").all() as (Row & { v: string })[]),
    access: group(db.prepare("SELECT task_id, user_id AS v FROM task_people WHERE relation='access'").all() as (Row & { v: string })[]),
    roles: new Map((db.prepare("SELECT id, role FROM users").all() as { id: string; role: Role }[]).map(r => [r.id, r.role])),
    order: loadOrder(db),
  };
}

/**
 * canSee = PM, OR worker/access on the task, OR (task shares a department with the user AND
 * every worker on the task is at or below the user's level).
 * Junior → own + junior coworkers' tasks in their department. Senior → their department. PM → all.
 */
export function canSeeTask(ix: Index, u: User, taskId: string): boolean {
  if (u.role === "pm") return true;
  if (ix.workers.get(taskId)?.includes(u.id) || ix.access.get(taskId)?.includes(u.id)) return true;
  if (!(ix.departments.get(taskId) ?? []).includes(u.department)) return false;
  const top = Math.max(0, ...(ix.workers.get(taskId) ?? []).map(w => LEVEL[ix.roles.get(w) ?? "junior"]));
  return top <= LEVEL[u.role];
}

export const isWorker = (ix: Index, u: User, taskId: string) => !!ix.workers.get(taskId)?.includes(u.id);

/**
 * Approval happens per milestone, not per task. The PM approves any milestone. A senior approves one
 * where every task belongs to their department and is visible to them, and none is their own work
 * (nobody approves their own work). Juniors never approve.
 */
export function canApproveMilestone(ix: Index, u: User, taskIds: string[]) {
  if (u.role === "pm") return true;
  return u.role === "senior" && taskIds.length > 0 && taskIds.every(id =>
    (ix.departments.get(id) ?? []).includes(u.department) && canSeeTask(ix, u, id) && !isWorker(ix, u, id));
}

/** Tasks carry no approve/reopen actions any more (kept so the API shape is unchanged). */
export const allowedActions = (): ("approve" | "reopen")[] => [];

export const canReadDoc = (u: User, minRole: Role) => LEVEL[u.role] >= LEVEL[minRole];

export const capabilities = (u: User) => ({ graph: u.role === "pm", review: u.role !== "junior", cost: u.role !== "junior" });
