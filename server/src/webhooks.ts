// Outbound webhooks: the open plug. Any external tool can subscribe to project events later.
import type { DB } from "./db.js";

export type Event = "task.status_changed" | "task.progress" | "task.submitted" | "milestone.ready" | "milestone.approved";

export function emit(db: DB, event: Event, data: Record<string, unknown>) {
  const hooks = db.prepare("SELECT url, events FROM webhooks").all() as { url: string; events: string }[];
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  for (const h of hooks) {
    const events = JSON.parse(h.events) as string[];
    if (!events.includes("*") && !events.includes(event)) continue;
    // Fire-and-forget: a slow or failing receiver must never block the agent.
    fetch(h.url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000) })
      .catch(err => console.warn(`webhook ${h.url} failed: ${(err as Error).message}`));
  }
}
