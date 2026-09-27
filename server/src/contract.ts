// The frontend API contract (docs/LOVABLE_PLAN.md §4) as zod schemas. Used by the contract checker
// (`npm run check`) and its test, so the backend and the spec can't silently drift apart.
// Schemas require every field the spec names; extra fields are allowed.
import { z } from "zod";

const iso = z.string().refine(s => !Number.isNaN(Date.parse(s)), "ISO date-time");
export const Role = z.enum(["pm", "senior", "junior"]);
export const Status = z.enum(["todo", "in_progress", "review", "done"]);
export const UserRef = z.object({ id: z.string(), name: z.string(), role: Role, department: z.string() });
const TaskRef = z.object({ id: z.string(), title: z.string(), status: Status });

export const TaskSummary = z.object({
  id: z.string().regex(/^T-\d+$/), title: z.string(), status: Status,
  milestone: z.object({ id: z.string(), name: z.string() }),
  parent_id: z.string().nullable(),
  departments: z.array(z.string()), workers: z.array(UserRef), access: z.array(UserRef),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable(), overdue: z.boolean(),
  sequence: z.number().int().positive().nullable(), locked: z.boolean(), blocked_by: z.array(TaskRef),
  live: z.object({ agent_name: z.string(), activity: z.string(), since: iso }).nullable(),
  cost_usd: z.number().min(0), updated_at: iso,
  allowed_actions: z.array(z.enum(["approve", "reopen"])),
});

export const Update = z.object({
  id: z.number(), task: z.object({ id: z.string(), title: z.string() }),
  kind: z.enum(["progress", "completion", "approval", "status"]), via: z.enum(["agent", "ui"]),
  user: UserRef, agent_name: z.string().nullable(), summary: z.string(),
  agents_used: z.array(z.string()), cost_usd: z.number().min(0),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  status_from: Status.nullable(), status_to: Status.nullable(), created_at: iso,
});

export const Artifact = z.object({
  id: z.string(), name: z.string(), mime: z.string(), url: z.string().regex(/^\/api\/artifacts\//), user: UserRef, created_at: iso,
});

export const ReviewItem = TaskSummary.extend({ latest_completion: Update.nullable(), artifacts: z.array(Artifact) });

export const TaskDetail = TaskSummary.extend({
  description: z.string(), scope: z.string(),
  docs: z.array(z.object({ id: z.string(), title: z.string(), readable: z.boolean() })),
  depends_on: z.array(TaskRef), blocks: z.array(TaskRef), mentions: z.array(TaskRef),
  subtasks: z.array(TaskSummary), updates: z.array(Update), artifacts: z.array(Artifact),
});

export const Login = z.object({ token: z.string(), user: UserRef.extend({ email: z.string(), title: z.string().nullable() }) });
export const Me = z.object({
  user: UserRef, capabilities: z.object({ graph: z.boolean(), review: z.boolean(), cost: z.boolean() }),
  project: z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
});
export const AgentKey = z.object({ agent_key: z.string(), mcp_url: z.string().regex(/\/mcp$/), command: z.string().startsWith("claude mcp add") });
export const LiveAgent = z.object({
  user: UserRef, agent_name: z.string(), status: z.enum(["active", "idle"]),
  task: z.object({ id: z.string(), title: z.string() }).nullable(), activity: z.string(), last_seen: iso,
});
export const Overview = z.object({
  milestones: z.array(z.object({
    id: z.string(), name: z.string(), due: z.string().nullable(), total: z.number(), done: z.number(), pct: z.number().min(0).max(100),
    approved_at: iso.nullable(), approved_by: UserRef.nullable(), ready_for_signoff: z.boolean(),
  })),
  by_status: z.object({ todo: z.number(), in_progress: z.number(), review: z.number(), done: z.number() }),
  overdue: z.number(),
  review_queue: z.array(ReviewItem),
  cost: z.object({
    total_usd: z.number(),
    by_department: z.array(z.object({ department: z.string(), cost_usd: z.number() })),
    by_person: z.array(z.object({ user: UserRef, cost_usd: z.number(), tasks_done: z.number() })),
  }).nullable(),
});
const NodeType = z.enum(["project", "milestone", "task", "person"]);
export const Graph = z.object({
  nodes: z.array(z.object({ id: z.string(), type: NodeType, label: z.string() }).passthrough()),
  edges: z.array(z.object({ source: z.string(), target: z.string(), type: z.enum(["contains", "subtask", "depends_on", "mentions", "works_on"]) })),
});
export const KbListItem = z.object({ id: z.string(), title: z.string(), excerpt: z.string(), min_role: Role, author: UserRef, created_at: iso });
export const KbDoc = z.object({
  id: z.string(), title: z.string(), body: z.string(), min_role: Role, author: UserRef, created_at: iso,
  linked_tasks: z.array(z.object({ id: z.string(), title: z.string() })),
});
export const Ok = z.object({ ok: z.literal(true) });
export const ApiError = z.object({ error: z.string() });

// Run-demo button (LOVABLE_PLAN §12)
export const DemoAccount = z.object({ email: z.string(), name: z.string(), role: Role, department: z.string(), title: z.string().nullable() });
export const DemoStatus = z.object({
  projects: z.array(z.string()),
  running: z.boolean(), project: z.string().nullable(), started_at: iso.nullable(), finished_at: iso.nullable(), end_reason: z.string().nullable(),
  cast: z.array(UserRef),
  progress: z.object({ done: z.number(), total: z.number() }).nullable(),
  waiting_for_approval: z.array(z.object({ id: z.string(), title: z.string() })),
  log: z.array(z.string()),
});
