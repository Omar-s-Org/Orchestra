// Prerequisites and suggested order.
// - A task is LOCKED while any of its prerequisites (depends_on) is not done (approved).
//   Locked tasks can't be started, reported on or submitted: by agents or anyone else.
// - `sequence` is a suggested global order: prerequisites first (topological), then earlier due
//   date, then task number. It's a hint; unlocked tasks may be done in any order.
import type { DB } from "./db.js";

export type Order = {
  deps: Map<string, string[]>;        // task → prerequisites
  status: Map<string, string>;
  sequence: Map<string, number>;      // 1-based suggested position
  blockedBy: (id: string) => string[]; // prerequisites that aren't done yet
};

const num = (id: string) => Number(id.replace(/\D/g, "")) || 0;

export function loadOrder(db: DB): Order {
  const tasks = db.prepare("SELECT id, status, due FROM tasks").all() as { id: string; status: string; due: string | null }[];
  const deps = new Map<string, string[]>();
  for (const l of db.prepare("SELECT from_task, to_task FROM task_links WHERE type='depends_on'").all() as { from_task: string; to_task: string }[])
    deps.set(l.from_task, [...(deps.get(l.from_task) ?? []), l.to_task]);
  const status = new Map(tasks.map(t => [t.id, t.status]));
  const due = new Map(tasks.map(t => [t.id, t.due ?? "9999-12-31"]));

  // Kahn's algorithm with a stable tie-break; anything left in a cycle goes last.
  const indegree = new Map(tasks.map(t => [t.id, (deps.get(t.id) ?? []).filter(d => status.has(d)).length]));
  const dependents = new Map<string, string[]>();
  for (const [t, ds] of deps) for (const d of ds) dependents.set(d, [...(dependents.get(d) ?? []), t]);
  const cmp = (a: string, b: string) => due.get(a)!.localeCompare(due.get(b)!) || num(a) - num(b);
  const ready = tasks.map(t => t.id).filter(id => indegree.get(id) === 0).sort(cmp);
  const sequence = new Map<string, number>();
  while (ready.length) {
    const id = ready.shift()!;
    sequence.set(id, sequence.size + 1);
    for (const n of dependents.get(id) ?? []) {
      indegree.set(n, indegree.get(n)! - 1);
      if (indegree.get(n) === 0) { ready.push(n); ready.sort(cmp); }
    }
  }
  for (const id of tasks.map(t => t.id).filter(id => !sequence.has(id)).sort(cmp)) sequence.set(id, sequence.size + 1);

  return {
    deps, status, sequence,
    blockedBy: id => (deps.get(id) ?? []).filter(d => status.has(d) && status.get(d) !== "done"),
  };
}

/** Returns a dependency cycle (e.g. ["T-1","T-2","T-1"]) if there is one. */
export function findCycle(deps: Map<string, string[]>): string[] | null {
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 1); stack.push(n);
    for (const d of deps.get(n) ?? []) { const c = visit(d); if (c) return c; }
    stack.pop(); state.set(n, 2);
    return null;
  };
  for (const n of deps.keys()) { const c = visit(n); if (c) return c; }
  return null;
}
