export type Role = "pm" | "senior" | "junior";
export type Status = "todo" | "in_progress" | "review" | "done";

export type UserRef = { id: string; name: string; role: Role; department: string };
export type AuthUser = UserRef & { email: string; title: string };

export type Live = { agent_name: string; activity: string; since: string } | null;

export type TaskSummary = {
  id: string;
  title: string;
  status: Status;
  milestone: { id: string; name: string };
  parent_id: string | null;
  departments: string[];
  workers: UserRef[];
  access: UserRef[];
  live: Live;
  cost_usd: number;
  updated_at: string;
  due: string | null;
  overdue: boolean;
  /** Not yet sent by the backend; rendered only when present. */
  sequence?: number;
  locked?: boolean;
  blocked_by?: { id: string; title: string; status: Status }[];
  allowed_actions: ("approve" | "reopen")[];
};

export type Update = {
  id: number;
  task: { id: string; title: string };
  kind: "progress" | "completion" | "approval" | "status";
  via: "agent" | "ui";
  user: UserRef;
  agent_name: string | null;
  summary: string;
  agents_used: string[];
  cost_usd: number;
  links: { label: string; url: string }[];
  status_from: Status | null;
  status_to: Status | null;
  created_at: string;
};

export type Artifact = {
  id: string;
  name: string;
  mime: string;
  url: string;
  user: UserRef;
  created_at: string;
};

export type ReviewItem = TaskSummary & {
  latest_completion: Update | null;
  artifacts: Artifact[];
};

export type TaskDetail = TaskSummary & {
  description: string;
  scope: string;
  docs: { id: string; title: string; readable: boolean }[];
  depends_on: { id: string; title: string; status: Status }[];
  blocks: { id: string; title: string; status: Status }[];
  mentions: { id: string; title: string; status: Status }[];
  subtasks: TaskSummary[];
  updates: Update[];
  artifacts: Artifact[];
};

export type Capabilities = { graph: boolean; review: boolean; cost: boolean };

export type Me = {
  user: AuthUser;
  capabilities: Capabilities;
  project: { id: string; name: string; description: string };
};

export type AgentKey = { agent_key: string; mcp_url: string; command: string };

export type LiveAgent = {
  user: UserRef;
  agent_name: string;
  status: "active" | "idle";
  task: { id: string; title: string } | null;
  activity: string;
  last_seen: string;
};

export type Overview = {
  milestones: {
    id: string;
    name: string;
    due: string;
    total: number;
    done: number;
    pct: number;
    /** Milestone sign-off (optional so older servers and mock data still type-check). */
    approved_at?: string | null;
    approved_by?: UserRef | null;
    ready_for_signoff?: boolean;
  }[];
  by_status: { todo: number; in_progress: number; review: number; done: number };
  overdue: number;
  review_queue: ReviewItem[];
  cost: null | {
    total_usd: number;
    by_department: { department: string; cost_usd: number }[];
    by_person: { user: UserRef; cost_usd: number; tasks_done: number }[];
  };
};

export type GraphNode = {
  id: string;
  type: "project" | "milestone" | "task" | "person";
  label: string;
  status?: Status;
  department?: string;
  role?: Role;
  due?: string;
  overdue?: boolean;
  live?: boolean;
  parent_id?: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: "contains" | "subtask" | "depends_on" | "mentions" | "works_on";
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type KbSummary = {
  id: string;
  title: string;
  excerpt: string;
  min_role: Role;
  author: UserRef;
  created_at: string;
};

export type KbDoc = {
  id: string;
  title: string;
  body: string;
  min_role: Role;
  author: UserRef;
  created_at: string;
  linked_tasks: { id: string; title: string }[];
};

export type LoginResponse = { token: string; user: AuthUser };

/** GET /api/demo/accounts (public). */
export type DemoAccount = {
  email: string;
  name: string;
  role: Role;
  department: string;
  title: string | null;
};

/** GET /api/demo/status (LOVABLE_PLAN §12). */
export type DemoStatus = {
  projects: string[];
  running: boolean;
  project: string | null;
  started_at: string | null;
  finished_at: string | null;
  end_reason: string | null;
  cast: UserRef[];
  progress: { done: number; total: number } | null;
  waiting_for_approval: { id: string; title: string }[];
  log: string[];
};
