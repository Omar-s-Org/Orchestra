// What agents get back over MCP. Agents pay for every token they read, and every result stays in
// their context for the rest of the session, so MCP responses are shaped for the next step only:
// writes return a short acknowledgement, next_task returns everything needed to start (docs inline),
// and full detail is opt-in (get_task include / history_limit). All data comes from the same
// permission-checked service functions as the REST API; this file only selects and trims.
import * as S from "./service.js";

type Summary = ReturnType<typeof S.listTasks>[number];
type Detail = ReturnType<typeof S.getTask>;

/** Compact JSON without nulls, empty strings or empty arrays (agents are told missing = empty). */
export function compact(v: unknown) {
  // The root is always kept: an empty result must still read as [] (e.g. a filter that matches nothing).
  return JSON.stringify(v, (k, x) => (k !== "" && (x === null || x === "" || (Array.isArray(x) && x.length === 0)) ? undefined : x)) ?? "null";
}

const DOC_INLINE = 1200;
const names = (people: { name: string }[]) => people.map(p => p.name);
const who = (c: S.Ctx) => `${c.user.name} · ${c.user.role} · ${c.user.department}`;

/** Everything an agent needs to start a task in one read: the task, its prerequisites and its docs inline. */
export function brief(c: S.Ctx, taskId: string) {
  const t = S.getTask(c, taskId);
  const last = t.updates[0];
  return {
    id: t.id, title: t.title, status: t.status, due: t.due, overdue: t.overdue || undefined,
    milestone: t.milestone.name, departments: t.departments, workers: names(t.workers),
    locked: t.locked || undefined, blocked_by: t.blocked_by.map(b => `${b.id} (${b.status})`),
    description: t.description, scope: t.scope,
    depends_on: t.depends_on.map(d => `${d.id} ${d.title} (${d.status})`),
    docs: t.docs.map(d => {
      if (!d.readable) return { id: d.id, title: d.title, restricted: true };
      const body = S.readKb(c, d.id).body;
      return body.length > DOC_INLINE ? { id: d.id, title: d.title, body: body.slice(0, DOC_INLINE), truncated: true } : { id: d.id, title: d.title, body };
    }),
    // Resuming work: the latest update, so the agent doesn't need the full history.
    last_update: last ? { kind: last.kind, by: last.user.name, summary: last.summary.slice(0, 300) } : undefined,
    updates: t.updates.length || undefined,
  };
}

/** Suggested next task as a brief, or what the agent is waiting on. */
export function nextTask(c: S.Ctx, taskId?: string) {
  if (taskId) return { you: who(c), task: brief(c, taskId) };
  const n = S.nextTask(c);
  return {
    you: who(c),
    task: n.next ? brief(c, n.next.id) : undefined,
    waiting: n.waiting.map(w => `${w.id} ${w.title} ← ${w.blocked_by.map(b => b.id).join(", ")}`),
    note: n.next ? undefined : n.note,
  };
}

/** Writes: confirm what changed; the agent already knows the task. */
export const ack = (t: Detail) => ({ ok: true, id: t.id, status: t.status });

/** After submitting: what's next, so the agent can continue without another call. */
export function afterSubmit(c: S.Ctx, t: Detail) {
  const n = S.nextTask(c);
  return { ...ack(t), next: n.next ? `${n.next.id} ${n.next.title}` : undefined, waiting: n.waiting.length || undefined, note: n.next ? "Call next_task for its brief." : n.note };
}

export type Include = "history" | "artifacts" | "links" | "subtasks" | "all";

/** Full task, trimmed by default; include:["all"] + history_limit:0 returns exactly the REST task detail. */
export function taskDetail(c: S.Ctx, taskId: string, include: Include[] = [], historyLimit = 5) {
  const t = S.getTask(c, taskId);
  const all = include.includes("all");
  const has = (k: Include) => all || include.includes(k);
  const { updates, artifacts, mentions, subtasks, ...rest } = t;
  const out: Record<string, unknown> = all ? { ...rest } : (({ allowed_actions: _a, updated_at: _u, ...r }) => r)(rest);
  if (has("history")) out.updates = historyLimit > 0 ? updates.slice(0, historyLimit) : updates;
  else out.updates_count = updates.length;
  if (has("artifacts")) out.artifacts = artifacts;
  if (has("links")) out.mentions = mentions;
  if (has("subtasks")) out.subtasks = subtasks;
  return out;
}

/** One compact row per visible task. */
export const boardRow = (t: Summary) => ({
  id: t.id, title: t.title, status: t.status, parent: t.parent_id, workers: names(t.workers), due: t.due,
  locked: t.locked || undefined, blocked_by: t.blocked_by.map(b => b.id), live: t.live ? t.live.agent_name : undefined,
});

export const kbRow = (d: ReturnType<typeof S.listKb>[number]) => ({ id: d.id, title: d.title, excerpt: d.excerpt, min_role: d.min_role });
