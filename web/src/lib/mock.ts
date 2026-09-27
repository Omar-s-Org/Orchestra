/**
 * Mock backend. Serves every endpoint of the API contract from in-memory demo
 * data ("Northwind Launch"). Data mutates slightly on each poll so the live UI
 * can be demoed with no backend running.
 */
import chartImage from "@/assets/mock-chart.jpg";

import type {
  AgentKey,
  Artifact,
  AuthUser,
  Capabilities,
  GraphData,
  GraphEdge,
  GraphNode,
  KbDoc,
  KbSummary,
  LiveAgent,
  LoginResponse,
  Me,
  Overview,
  ReviewItem,
  Role,
  Status,
  TaskDetail,
  TaskSummary,
  Update,
  UserRef,
} from "./types";

export const MOCK_PASSWORD = "demo1234";

type MockUser = AuthUser & { agent_name: string };

const USERS: MockUser[] = [
  {
    id: "layla",
    name: "Layla Haddad",
    role: "pm",
    department: "Management",
    email: "layla@northwind.test",
    title: "Project Manager",
    agent_name: "Layla's Claude",
  },
  {
    id: "sara",
    name: "Sara Weber",
    role: "senior",
    department: "Engineering",
    email: "sara@northwind.test",
    title: "Engineering Lead",
    agent_name: "Sara's Claude",
  },
  {
    id: "tom",
    name: "Tom Berger",
    role: "senior",
    department: "Marketing",
    email: "tom@northwind.test",
    title: "Marketing Lead",
    agent_name: "Tom's Claude",
  },
  {
    id: "john",
    name: "John Carter",
    role: "junior",
    department: "Engineering",
    email: "john@northwind.test",
    title: "Backend Engineer",
    agent_name: "John's Claude",
  },
  {
    id: "priya",
    name: "Priya Nair",
    role: "junior",
    department: "Engineering",
    email: "priya@northwind.test",
    title: "Full-stack Engineer",
    agent_name: "Priya's Claude",
  },
  {
    id: "omar",
    name: "Omar",
    role: "junior",
    department: "Engineering",
    email: "omar@northwind.test",
    title: "Frontend Engineer",
    agent_name: "Omar's Claude",
  },
  {
    id: "hassan",
    name: "Hassan",
    role: "junior",
    department: "Engineering",
    email: "hassan@northwind.test",
    title: "Platform Engineer",
    agent_name: "Hassan's Claude",
  },
  {
    id: "mia",
    name: "Mia Hofer",
    role: "junior",
    department: "Marketing",
    email: "mia@northwind.test",
    title: "Content Marketer",
    agent_name: "Mia's Claude",
  },
];

export const DEMO_ACCOUNTS = USERS.map((u) => ({
  email: u.email,
  name: u.name,
  role: u.role,
  department: u.department,
  title: u.title,
}));

const PROJECT = {
  id: "P-1",
  name: "Northwind Launch",
  description: "Launch of a new product line, run with AI agents.",
};

const MILESTONES = [
  { id: "M-1", name: "MVP ready", due: "2026-10-03" },
  { id: "M-2", name: "Beta with 10 customers", due: "2026-10-17" },
  { id: "M-3", name: "Public launch", due: "2026-10-31" },
];

function ref(id: string): UserRef {
  const u = user(id);
  return { id: u.id, name: u.name, role: u.role, department: u.department };
}

function user(id: string): MockUser {
  const found = USERS.find((u) => u.id === id);
  if (!found) throw new Error(`unknown mock user ${id}`);
  return found;
}

function milestone(id: string) {
  const m = MILESTONES.find((x) => x.id === id)!;
  return { id: m.id, name: m.name };
}

type MockTask = {
  id: string;
  title: string;
  status: Status;
  milestone_id: string;
  parent_id: string | null;
  departments: string[];
  workers: string[];
  access: string[];
  live: { agent: string; activity: string; since_min: number } | null;
  cost_usd: number;
  updated_min: number;
  description: string;
  scope: string;
  docs: { id: string; title: string; readable: boolean }[];
  depends_on: string[];
  mentions: string[];
};

const TASKS: MockTask[] = [
  {
    id: "T-1",
    title: "Set up CI pipeline",
    status: "done",
    milestone_id: "M-1",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["john"],
    access: ["john", "priya", "omar", "hassan", "sara", "layla"],
    live: null,
    cost_usd: 1.84,
    updated_min: 640,
    description:
      "Build and test pipeline for every pull request, with cached dependencies and a preview deploy.",
    scope:
      "**In scope:** lint, typecheck, unit tests, preview deploy.\n\n**Out of scope:** production release automation.",
    docs: [{ id: "K-1", title: "Engineering conventions", readable: true }],
    depends_on: [],
    mentions: [],
  },
  {
    id: "T-2",
    title: "Auth service",
    status: "in_progress",
    milestone_id: "M-1",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["priya"],
    access: ["priya", "john", "omar", "hassan", "sara", "layla"],
    live: { agent: "Priya's Claude", activity: "writing token refresh tests", since_min: 14 },
    cost_usd: 4.12,
    updated_min: 3,
    description: "Email and password sign-in, sessions, token refresh and rate limiting.",
    scope: "**In scope:** sign-in, sign-out, refresh.\n\n**Out of scope:** social login.",
    docs: [
      { id: "K-2", title: "Auth threat model", readable: true },
      { id: "K-4", title: "Budget and burn rate", readable: false },
    ],
    depends_on: [],
    mentions: [],
  },
  {
    id: "T-13",
    title: "Password reset flow",
    status: "todo",
    milestone_id: "M-1",
    parent_id: "T-2",
    departments: ["Engineering"],
    workers: ["omar"],
    access: ["omar", "priya", "john", "hassan", "sara", "layla"],
    live: null,
    cost_usd: 0,
    updated_min: 210,
    description: "Reset link by email, single use, expires after 30 minutes.",
    scope: "**In scope:** request, verify, set new password.",
    docs: [],
    depends_on: ["T-2"],
    mentions: [],
  },
  {
    id: "T-3",
    title: "Data model design",
    status: "done",
    milestone_id: "M-1",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["sara"],
    access: ["sara", "layla"],
    live: null,
    cost_usd: 3.05,
    updated_min: 1500,
    description: "Tables, relations and indexes for projects, tasks, updates and artifacts.",
    scope: "**In scope:** schema and migrations.\n\n**Out of scope:** analytics warehouse.",
    docs: [{ id: "K-1", title: "Engineering conventions", readable: true }],
    depends_on: [],
    mentions: [],
  },
  {
    id: "T-5",
    title: "API endpoints",
    status: "in_progress",
    milestone_id: "M-1",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["john"],
    access: ["john", "priya", "omar", "hassan", "sara", "layla"],
    live: { agent: "John's Claude", activity: "implementing /api/tasks filters", since_min: 22 },
    cost_usd: 6.48,
    updated_min: 1,
    description: "Read endpoints for tasks, activity and overview, plus approve and reopen.",
    scope: "**In scope:** REST endpoints and role filtering.",
    docs: [{ id: "K-1", title: "Engineering conventions", readable: true }],
    depends_on: ["T-3"],
    mentions: [],
  },
  {
    id: "T-9",
    title: "Frontend integration",
    status: "todo",
    milestone_id: "M-1",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["priya", "omar"],
    access: ["priya", "omar", "john", "hassan", "sara", "layla"],
    live: null,
    cost_usd: 0,
    updated_min: 300,
    description: "Wire the board, drawer and activity feed to the API with polling.",
    scope: "**In scope:** data layer and screens.\n\n**Out of scope:** the graph view.",
    docs: [],
    depends_on: ["T-5"],
    mentions: [],
  },
  {
    id: "T-4",
    title: "Architecture review",
    status: "review",
    milestone_id: "M-2",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["sara"],
    access: ["sara", "layla"],
    live: null,
    cost_usd: 2.2,
    updated_min: 48,
    description: "Review the service boundaries and the polling strategy before beta.",
    scope: "**In scope:** service split, caching, polling intervals.",
    docs: [{ id: "K-2", title: "Auth threat model", readable: true }],
    depends_on: ["T-3"],
    mentions: [],
  },
  {
    id: "T-6",
    title: "Beta onboarding emails",
    status: "review",
    milestone_id: "M-2",
    parent_id: null,
    departments: ["Marketing"],
    workers: ["mia"],
    access: ["mia", "tom", "layla"],
    live: null,
    cost_usd: 1.37,
    updated_min: 26,
    description: "Five-step onboarding sequence for the first ten beta customers.",
    scope: "**In scope:** copy and sequencing.\n\n**Out of scope:** sending infrastructure.",
    docs: [{ id: "K-3", title: "Brand voice guide", readable: true }],
    depends_on: [],
    mentions: ["T-8"],
  },
  {
    id: "T-8",
    title: "Landing page copy",
    status: "in_progress",
    milestone_id: "M-2",
    parent_id: null,
    departments: ["Marketing"],
    workers: ["tom"],
    access: ["tom", "mia", "layla"],
    live: { agent: "Tom's Claude", activity: "rewriting the hero section", since_min: 8 },
    cost_usd: 2.91,
    updated_min: 2,
    description: "Hero, value props and social proof for the public launch page.",
    scope: "**In scope:** page copy.\n\n**Out of scope:** design and build.",
    docs: [{ id: "K-3", title: "Brand voice guide", readable: true }],
    depends_on: [],
    mentions: ["T-6"],
  },
  {
    id: "T-7",
    title: "Load testing",
    status: "todo",
    milestone_id: "M-2",
    parent_id: null,
    departments: ["Engineering"],
    workers: ["hassan"],
    access: ["hassan", "john", "priya", "omar", "sara", "layla"],
    live: null,
    cost_usd: 0,
    updated_min: 420,
    description: "Simulate 500 concurrent agents reporting progress.",
    scope: "**In scope:** scripts and a report.",
    docs: [],
    depends_on: ["T-5"],
    mentions: [],
  },
  {
    id: "T-10",
    title: "Launch blog post",
    status: "todo",
    milestone_id: "M-3",
    parent_id: null,
    departments: ["Marketing"],
    workers: ["mia"],
    access: ["mia", "tom", "layla"],
    live: null,
    cost_usd: 0,
    updated_min: 520,
    description: "Announcement post covering the agent workflow and the first results.",
    scope: "**In scope:** draft and review.",
    docs: [{ id: "K-3", title: "Brand voice guide", readable: true }],
    depends_on: [],
    mentions: [],
  },
  {
    id: "T-11",
    title: "Pricing page",
    status: "review",
    milestone_id: "M-3",
    parent_id: null,
    departments: ["Marketing"],
    workers: ["tom"],
    access: ["tom", "mia", "layla"],
    live: null,
    cost_usd: 1.95,
    updated_min: 62,
    description: "Three tiers with a comparison table and an FAQ.",
    scope: "**In scope:** copy and tier structure.",
    docs: [],
    depends_on: [],
    mentions: [],
  },
  {
    id: "T-12",
    title: "Docs site",
    status: "in_progress",
    milestone_id: "M-3",
    parent_id: null,
    departments: ["Engineering", "Marketing"],
    workers: ["hassan", "john"],
    access: ["hassan", "john", "priya", "omar", "sara", "tom", "layla"],
    live: { agent: "Hassan's Claude", activity: "generating the MCP quickstart", since_min: 31 },
    cost_usd: 3.6,
    updated_min: 5,
    description: "Public documentation with a quickstart for connecting an agent over MCP.",
    scope: "**In scope:** quickstart, reference, examples.",
    docs: [{ id: "K-1", title: "Engineering conventions", readable: true }],
    depends_on: [],
    mentions: [],
  },
];

type MockUpdate = {
  id: number;
  task_id: string;
  kind: Update["kind"];
  via: Update["via"];
  user_id: string;
  agent: boolean;
  summary: string;
  agents_used: string[];
  cost_usd: number;
  links: { label: string; url: string }[];
  status_from: Status | null;
  status_to: Status | null;
  min_ago: number;
};

const SEED_UPDATES: MockUpdate[] = [
  {
    id: 1,
    task_id: "T-1",
    kind: "completion",
    via: "agent",
    user_id: "john",
    agent: true,
    summary:
      "### How I did it\nI split the pipeline into three cached jobs (`lint`, `typecheck`, `test`) and added a preview deploy step.\n\n| Job | Before | After |\n| --- | --- | --- |\n| lint | 48s | 11s |\n| test | 3m12s | 1m04s |\n\nDependency caching was the big win: the install step now hits the cache on 9 of 10 runs.",
    agents_used: ["research agent", "devops agent"],
    cost_usd: 0.82,
    links: [{ label: "Pipeline run", url: "https://example.com/ci/8421" }],
    status_from: "review",
    status_to: "done",
    min_ago: 650,
  },
  {
    id: 2,
    task_id: "T-1",
    kind: "approval",
    via: "ui",
    user_id: "sara",
    agent: false,
    summary: "Approved. Caching setup looks solid, and the preview deploy saves us a review round.",
    agents_used: [],
    cost_usd: 0,
    links: [],
    status_from: "review",
    status_to: "done",
    min_ago: 640,
  },
  {
    id: 3,
    task_id: "T-3",
    kind: "completion",
    via: "agent",
    user_id: "sara",
    agent: true,
    summary:
      "### Schema\nEight tables, with `updates` as an append-only log so agent reports are never rewritten. Indexed `updates(task_id, created_at desc)` for the timeline query.\n\n```sql\ncreate index updates_task_created_idx on updates (task_id, created_at desc);\n```",
    agents_used: ["research agent", "schema agent"],
    cost_usd: 1.44,
    links: [{ label: "Migration diff", url: "https://example.com/pr/112" }],
    status_from: "in_progress",
    status_to: "done",
    min_ago: 1510,
  },
  {
    id: 4,
    task_id: "T-2",
    kind: "progress",
    via: "agent",
    user_id: "priya",
    agent: true,
    summary:
      "Sign-in and sign-out are done. Token refresh is behind a feature flag while I finish the replay tests.\n\n![Auth latency p95](__CHART__)",
    agents_used: ["writer agent", "test agent"],
    cost_usd: 0.61,
    links: [{ label: "Draft PR", url: "https://example.com/pr/131" }],
    status_from: "todo",
    status_to: "in_progress",
    min_ago: 18,
  },
  {
    id: 5,
    task_id: "T-5",
    kind: "progress",
    via: "agent",
    user_id: "john",
    agent: true,
    summary:
      "`/api/tasks` now supports `status`, `department`, `person` and `mine`, combinable. Role filtering happens before serialisation so juniors can never receive a task they may not see.",
    agents_used: ["research agent", "writer agent"],
    cost_usd: 0.94,
    links: [],
    status_from: null,
    status_to: null,
    min_ago: 7,
  },
  {
    id: 6,
    task_id: "T-4",
    kind: "completion",
    via: "agent",
    user_id: "sara",
    agent: true,
    summary:
      "### Review outcome\nThe polling model holds at beta size: 2s for page data, 5s for the graph, with previous data kept on screen.\n\n**Recommendations**\n1. Add an ETag to `/api/tasks`.\n2. Cap the activity feed at 200 items per response.\n3. Revisit websockets after beta.\n\n![Auth latency p95](__CHART__)",
    agents_used: ["research agent", "review agent"],
    cost_usd: 1.1,
    links: [{ label: "Review notes", url: "https://example.com/docs/arch-review" }],
    status_from: "in_progress",
    status_to: "review",
    min_ago: 48,
  },
  {
    id: 7,
    task_id: "T-6",
    kind: "completion",
    via: "agent",
    user_id: "mia",
    agent: true,
    summary:
      "### Sequence\nFive emails over eight days. Each one has a single call to action, and the copy reuses the phrasing from the landing page work in **T-8** so the beta and the public page sound like one product.",
    agents_used: ["research agent", "writer agent", "editor agent"],
    cost_usd: 0.74,
    links: [{ label: "Sequence doc", url: "https://example.com/docs/onboarding" }],
    status_from: "in_progress",
    status_to: "review",
    min_ago: 26,
  },
  {
    id: 8,
    task_id: "T-8",
    kind: "progress",
    via: "agent",
    user_id: "tom",
    agent: true,
    summary:
      "Third hero variant tested best with the internal panel. Keeping the onboarding wording aligned with **T-6**.",
    agents_used: ["writer agent"],
    cost_usd: 0.52,
    links: [],
    status_from: null,
    status_to: null,
    min_ago: 11,
  },
  {
    id: 9,
    task_id: "T-11",
    kind: "completion",
    via: "agent",
    user_id: "tom",
    agent: true,
    summary:
      "### Tiers\nStarter, Team and Scale, with agent runs as the metered unit. The comparison table has eight rows; the FAQ answers the three questions from the beta calls.",
    agents_used: ["research agent", "writer agent"],
    cost_usd: 0.88,
    links: [{ label: "Pricing draft", url: "https://example.com/docs/pricing" }],
    status_from: "in_progress",
    status_to: "review",
    min_ago: 62,
  },
  {
    id: 10,
    task_id: "T-12",
    kind: "progress",
    via: "agent",
    user_id: "hassan",
    agent: true,
    summary:
      "Quickstart drafted: install, add the MCP server, run the first task. Reference pages are generated from the endpoint table.",
    agents_used: ["writer agent"],
    cost_usd: 0.46,
    links: [],
    status_from: "todo",
    status_to: "in_progress",
    min_ago: 9,
  },
  {
    id: 11,
    task_id: "T-2",
    kind: "status",
    via: "ui",
    user_id: "sara",
    agent: false,
    summary: "Moved to in progress after the design sync.",
    agents_used: [],
    cost_usd: 0,
    links: [],
    status_from: "todo",
    status_to: "in_progress",
    min_ago: 120,
  },
];

const ARTIFACTS: Record<string, { id: string; name: string; mime: string; url: string; user_id: string; min_ago: number }[]> = {
  "T-2": [
    { id: "ab12cd", name: "auth-latency.jpg", mime: "image/jpeg", url: chartImage, user_id: "priya", min_ago: 18 },
    { id: "ab12ce", name: "token-refresh-notes.md", mime: "text/markdown", url: chartImage, user_id: "priya", min_ago: 16 },
  ],
  "T-4": [
    { id: "cd34ef", name: "architecture-review.jpg", mime: "image/jpeg", url: chartImage, user_id: "sara", min_ago: 48 },
    { id: "cd34eg", name: "review-notes.pdf", mime: "application/pdf", url: chartImage, user_id: "sara", min_ago: 47 },
  ],
  "T-6": [{ id: "ef56gh", name: "onboarding-sequence.pdf", mime: "application/pdf", url: chartImage, user_id: "mia", min_ago: 26 }],
  "T-11": [{ id: "gh78ij", name: "pricing-tiers.jpg", mime: "image/jpeg", url: chartImage, user_id: "tom", min_ago: 62 }],
  "T-1": [{ id: "ij90kl", name: "pipeline-report.pdf", mime: "application/pdf", url: chartImage, user_id: "john", min_ago: 650 }],
};

const KB: (Omit<KbDoc, "author" | "created_at"> & { author_id: string; min_ago: number; excerpt: string })[] = [
  {
    id: "K-1",
    title: "Engineering conventions",
    excerpt: "How we name things, review pull requests and keep the pipeline green.",
    min_role: "junior",
    author_id: "sara",
    min_ago: 4300,
    body: "# Engineering conventions\n\n## Branches\n`type/short-description`, e.g. `feat/token-refresh`.\n\n## Reviews\n- One reviewer for routine work, two for anything touching auth.\n- Agents must attach their reasoning summary to the completion update.\n\n## Testing\nUnit tests for logic, one end-to-end path per screen.",
    linked_tasks: [],
  },
  {
    id: "K-2",
    title: "Auth threat model",
    excerpt: "Attack surface for sign-in, sessions and token refresh, plus the mitigations we chose.",
    min_role: "junior",
    author_id: "sara",
    min_ago: 2600,
    body: "# Auth threat model\n\n| Threat | Mitigation |\n| --- | --- |\n| Credential stuffing | Rate limit per IP and per account |\n| Token replay | Single-use refresh tokens |\n| Session fixation | Rotate the session id on sign-in |\n\nArtifact URLs in the demo carry a token in the query string. Production uses short-lived signed URLs.",
    linked_tasks: [],
  },
  {
    id: "K-3",
    title: "Brand voice guide",
    excerpt: "Plain, concrete, never breathless. Words we use and words we avoid.",
    min_role: "junior",
    author_id: "tom",
    min_ago: 5200,
    body: "# Brand voice\n\n**Use:** plain verbs, concrete numbers, short sentences.\n\n**Avoid:** revolutionary, seamless, game-changing, unlock.\n\nEvery page should answer what it does, who it is for and what it costs.",
    linked_tasks: [],
  },
  {
    id: "K-4",
    title: "Budget and burn rate",
    excerpt: "Agent spend per department and the cap per milestone.",
    min_role: "senior",
    author_id: "layla",
    min_ago: 900,
    body: "# Budget\n\nCap per milestone is **$40** of agent spend. Engineering is tracking at 61% of its share, Marketing at 39%.\n\nRaise a flag in the review queue when a single task passes $8.",
    linked_tasks: [],
  },
  {
    id: "K-5",
    title: "Launch runbook",
    excerpt: "Hour-by-hour plan for launch day, owners and rollback steps.",
    min_role: "pm",
    author_id: "layla",
    min_ago: 300,
    body: "# Launch runbook\n\n1. **T-2h** freeze deploys.\n2. **T-1h** final smoke test of sign-in and the board.\n3. **T-0** publish the blog post and the pricing page.\n4. **T+1h** review agent activity and cost.\n\nRollback: revert the release tag and re-point the CDN.",
    linked_tasks: [],
  },
];

/* ------------------------------------------------------------------ *
 * Mutating state: makes the mock feel live across polls.
 * ------------------------------------------------------------------ */

const ACTIVITY_TEXTS: Record<string, string[]> = {
  "T-2": [
    "writing token refresh tests",
    "replaying expired tokens against the new guard",
    "tightening the rate limiter",
    "updating the auth threat model notes",
  ],
  "T-5": [
    "implementing /api/tasks filters",
    "adding role filtering before serialisation",
    "benchmarking the activity query",
    "writing endpoint tests",
  ],
  "T-8": [
    "rewriting the hero section",
    "testing a shorter value proposition",
    "checking the copy against the brand voice guide",
    "drafting the social proof block",
  ],
  "T-12": [
    "generating the MCP quickstart",
    "cross-linking the endpoint reference",
    "adding a worked example",
    "checking code samples compile",
  ],
};

const EXTRA_SUMMARIES: { task_id: string; user_id: string; text: string; agents: string[] }[] = [
  { task_id: "T-5", user_id: "john", text: "Added `?mine=true` and confirmed it composes with `department`.", agents: ["writer agent"] },
  { task_id: "T-2", user_id: "priya", text: "Refresh replay test is green; removing the feature flag next.", agents: ["test agent"] },
  { task_id: "T-8", user_id: "tom", text: "Shortened the hero to nine words and kept the proof point.", agents: ["writer agent", "editor agent"] },
  { task_id: "T-12", user_id: "hassan", text: "Quickstart now ends with a working `claude mcp add` line.", agents: ["writer agent"] },
];

type MockState = { tick: number; lastTick: number; extra: MockUpdate[]; nextId: number };

const state: MockState = { tick: 0, lastTick: 0, extra: [], nextId: 1000 };

function advance() {
  const now = Date.now();
  if (now - state.lastTick < 1800) return;
  state.lastTick = now;
  state.tick += 1;

  for (const task of TASKS) {
    const texts = ACTIVITY_TEXTS[task.id];
    if (task.live && texts && texts.length > 0) {
      task.live.activity = texts[state.tick % texts.length]!;
    }
  }

  if (state.tick % 3 === 0) {
    const seed = EXTRA_SUMMARIES[Math.floor(state.tick / 3) % EXTRA_SUMMARIES.length]!;
    state.extra.unshift({
      id: state.nextId++,
      task_id: seed.task_id,
      kind: "progress",
      via: "agent",
      user_id: seed.user_id,
      agent: true,
      summary: seed.text,
      agents_used: seed.agents,
      cost_usd: Math.round((0.08 + Math.random() * 0.3) * 100) / 100,
      links: [],
      status_from: null,
      status_to: null,
      min_ago: 0,
    });
    const task = TASKS.find((t) => t.id === seed.task_id);
    if (task) {
      task.cost_usd = Math.round((task.cost_usd + 0.09) * 100) / 100;
      task.updated_min = 0;
    }
    if (state.extra.length > 30) state.extra.length = 30;
  }
}

export function resetMock() {
  state.tick = 0;
  state.lastTick = 0;
  state.extra = [];
  state.nextId = 1000;
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

const ROLE_RANK: Record<Role, number> = { junior: 0, senior: 1, pm: 2 };

function iso(minAgo: number) {
  return new Date(Date.now() - minAgo * 60_000).toISOString();
}

function capabilities(role: Role): Capabilities {
  return { graph: role === "pm", review: role !== "junior", cost: role !== "junior" };
}

function canSee(task: MockTask, viewer: MockUser): boolean {
  if (viewer.role === "pm") return true;
  if (!task.departments.includes(viewer.department)) return false;
  if (viewer.role === "senior") return true;
  return task.workers.some((w) => {
    const u = user(w);
    return u.role === "junior" && u.department === viewer.department;
  });
}

function allowedActions(task: MockTask, viewer: MockUser): ("approve" | "reopen")[] {
  if (task.status !== "review") return [];
  if (viewer.role === "pm") return ["approve", "reopen"];
  if (viewer.role === "senior" && task.departments.includes(viewer.department)) {
    return ["approve", "reopen"];
  }
  return [];
}

function toSummary(task: MockTask, viewer: MockUser): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    milestone: milestone(task.milestone_id),
    parent_id: task.parent_id,
    departments: [...task.departments],
    workers: task.workers.map(ref),
    access: task.access.map(ref),
    live: task.live
      ? {
          agent_name: task.live.agent,
          activity: task.live.activity,
          since: iso(task.live.since_min),
        }
      : null,
    cost_usd: task.cost_usd,
    updated_at: iso(task.updated_min),
    ...dueOf(task),
    allowed_actions: allowedActions(task, viewer),
  };
}

function dueOf(task: MockTask): { due: string; overdue: boolean } {
  const m = MILESTONES.find((x) => x.id === task.milestone_id)!;
  const n = Number(task.id.replace(/\D/g, "")) || 0;
  const d = new Date(m.due);
  d.setDate(d.getDate() - ((n * 3) % 9));
  const due = d.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return { due, overdue: task.status !== "done" && due < today };
}

function allUpdates(): MockUpdate[] {
  return [...state.extra, ...SEED_UPDATES].sort((a, b) => a.min_ago - b.min_ago);
}

function toUpdate(u: MockUpdate): Update {
  const task = TASKS.find((t) => t.id === u.task_id)!;
  const author = user(u.user_id);
  return {
    id: u.id,
    task: { id: task.id, title: task.title },
    kind: u.kind,
    via: u.via,
    user: ref(u.user_id),
    agent_name: u.agent ? author.agent_name : null,
    summary: u.summary.replaceAll("__CHART__", chartImage),
    agents_used: [...u.agents_used],
    cost_usd: u.cost_usd,
    links: u.links.map((l) => ({ ...l })),
    status_from: u.status_from,
    status_to: u.status_to,
    created_at: iso(u.min_ago),
  };
}

function toArtifacts(taskId: string): Artifact[] {
  return (ARTIFACTS[taskId] ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    mime: a.mime,
    url: a.url,
    user: ref(a.user_id),
    created_at: iso(a.min_ago),
  }));
}

function reviewItem(task: MockTask, viewer: MockUser): ReviewItem {
  const completion = allUpdates().find((u) => u.task_id === task.id && u.kind === "completion");
  return {
    ...toSummary(task, viewer),
    latest_completion: completion ? toUpdate(completion) : null,
    artifacts: toArtifacts(task.id),
  };
}

/* ------------------------------------------------------------------ *
 * Endpoint handlers
 * ------------------------------------------------------------------ */

export class MockError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function mockLogin(email: string, password: string): LoginResponse {
  const found = USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!found || password !== MOCK_PASSWORD) {
    throw new MockError(401, "Invalid email or password");
  }
  const { agent_name: _agent, ...rest } = found;
  return { token: `mock:${found.id}`, user: rest };
}

function viewerFromToken(token: string | null): MockUser {
  const id = token?.startsWith("mock:") ? token.slice(5) : null;
  const found = id ? USERS.find((u) => u.id === id) : null;
  if (!found) throw new MockError(401, "Session expired, please sign in again");
  return found;
}

function meOf(viewer: MockUser): Me {
  const { agent_name: _agent, ...rest } = viewer;
  return { user: rest, capabilities: capabilities(viewer.role), project: PROJECT };
}

function agentKey(viewer: MockUser): AgentKey {
  const key = `nw_${viewer.id}_${"9f3ac71e2b"}`;
  const mcp = "http://localhost:8787/mcp";
  return {
    agent_key: key,
    mcp_url: mcp,
    command: `claude mcp add orchestra --transport http ${mcp} --header "Authorization: Bearer ${key}"`,
  };
}

function liveAgents(viewer: MockUser): LiveAgent[] {
  const visible = TASKS.filter((t) => canSee(t, viewer));
  return USERS.filter((u) => u.id !== null)
    .map((u) => {
      const task = visible.find((t) => t.live && t.workers.includes(u.id));
      const idleTask = visible.find((t) => t.workers.includes(u.id) && t.status !== "done");
      const active = Boolean(task);
      return {
        user: ref(u.id),
        agent_name: u.agent_name,
        status: (active ? "active" : "idle") as "active" | "idle",
        task: task
          ? { id: task.id, title: task.title }
          : idleTask
            ? { id: idleTask.id, title: idleTask.title }
            : null,
        activity: active ? task!.live!.activity : "waiting for the next task",
        last_seen: iso(active ? 0 : 6 + (ROLE_RANK[u.role] + 1) * 3),
      };
    })
    .filter((a) => {
      if (viewer.role === "pm") return true;
      if (a.user.department !== viewer.department) return false;
      if (viewer.role === "senior") return true;
      return a.user.id === viewer.id || a.user.role === "junior";
    })
    .sort((a, b) => (a.status === b.status ? a.user.name.localeCompare(b.user.name) : a.status === "active" ? -1 : 1));
}

function overview(viewer: MockUser): Overview {
  const visible = TASKS.filter((t) => canSee(t, viewer));
  const caps = capabilities(viewer.role);

  const milestones = MILESTONES.map((m) => {
    const tasks = visible.filter((t) => t.milestone_id === m.id);
    const done = tasks.filter((t) => t.status === "done").length;
    return {
      id: m.id,
      name: m.name,
      due: m.due,
      total: tasks.length,
      done,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  });

  const by_status = {
    todo: visible.filter((t) => t.status === "todo").length,
    in_progress: visible.filter((t) => t.status === "in_progress").length,
    review: visible.filter((t) => t.status === "review").length,
    done: visible.filter((t) => t.status === "done").length,
  };

  const review_queue = caps.review
    ? visible
        .filter((t) => t.status === "review" && allowedActions(t, viewer).includes("approve"))
        .map((t) => reviewItem(t, viewer))
    : [];

  let cost: Overview["cost"] = null;
  if (caps.cost) {
    const departments = [...new Set(visible.flatMap((t) => t.departments))];
    const people = [...new Set(visible.flatMap((t) => t.workers))];
    cost = {
      total_usd: Math.round(visible.reduce((s, t) => s + t.cost_usd, 0) * 100) / 100,
      by_department: departments
        .map((department) => ({
          department,
          cost_usd:
            Math.round(
              visible.filter((t) => t.departments.includes(department)).reduce((s, t) => s + t.cost_usd, 0) * 100,
            ) / 100,
        }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      by_person: people
        .map((id) => {
          const mine = visible.filter((t) => t.workers.includes(id));
          return {
            user: ref(id),
            cost_usd:
              Math.round((mine.reduce((s, t) => s + t.cost_usd / t.workers.length, 0)) * 100) / 100,
            tasks_done: mine.filter((t) => t.status === "done").length,
          };
        })
        .sort((a, b) => b.cost_usd - a.cost_usd),
    };
  }

  return {
    milestones,
    by_status,
    overdue: visible.filter((t) => dueOf(t).overdue).length,
    review_queue,
    cost,
  };
}

function listTasks(viewer: MockUser, params: URLSearchParams): TaskSummary[] {
  const status = params.get("status");
  const department = params.get("department");
  const person = params.get("person");
  const mine = params.get("mine") === "true";

  return TASKS.filter((t) => canSee(t, viewer))
    .filter((t) => (status ? t.status === status : true))
    .filter((t) => (department ? t.departments.includes(department) : true))
    .filter((t) => (person ? t.workers.includes(person) : true))
    .filter((t) => (mine ? t.workers.includes(viewer.id) : true))
    .map((t) => toSummary(t, viewer));
}

function taskDetail(viewer: MockUser, id: string): TaskDetail {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new MockError(404, `Task ${id} not found`);
  if (!canSee(task, viewer)) throw new MockError(403, `You don't have access to ${id}`);

  const brief = (t: MockTask) => ({ id: t.id, title: t.title, status: t.status });
  const visible = (ids: string[]) =>
    ids
      .map((x) => TASKS.find((t) => t.id === x))
      .filter((t): t is MockTask => Boolean(t) && canSee(t!, viewer))
      .map(brief);

  const blocks = TASKS.filter((t) => t.depends_on.includes(task.id) && canSee(t, viewer)).map(brief);
  const mentionIds = [
    ...new Set([...task.mentions, ...TASKS.filter((t) => t.mentions.includes(task.id)).map((t) => t.id)]),
  ];

  return {
    ...toSummary(task, viewer),
    description: task.description,
    scope: task.scope,
    docs: task.docs.map((d) => ({ ...d })),
    depends_on: visible(task.depends_on),
    blocks,
    mentions: visible(mentionIds),
    subtasks: TASKS.filter((t) => t.parent_id === task.id && canSee(t, viewer)).map((t) => toSummary(t, viewer)),
    updates: allUpdates()
      .filter((u) => u.task_id === task.id)
      .map(toUpdate),
    artifacts: toArtifacts(task.id),
  };
}

function actOnTask(
  viewer: MockUser,
  id: string,
  action: "approve" | "reopen",
  note?: string | undefined,
): TaskDetail {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new MockError(404, `Task ${id} not found`);
  if (!canSee(task, viewer)) throw new MockError(403, `You don't have access to ${id}`);
  if (!allowedActions(task, viewer).includes(action)) {
    throw new MockError(403, `You are not allowed to ${action === "approve" ? "approve" : "send back"} ${id}`);
  }
  if (action === "reopen" && !note?.trim()) throw new MockError(400, "A note is required when sending work back");

  const from = task.status;
  task.status = action === "approve" ? "done" : "in_progress";
  task.updated_min = 0;
  state.extra.unshift({
    id: state.nextId++,
    task_id: task.id,
    kind: action === "approve" ? "approval" : "status",
    via: "ui",
    user_id: viewer.id,
    agent: false,
    summary: note?.trim()
      ? note.trim()
      : action === "approve"
        ? "Approved."
        : "Sent back for changes.",
    agents_used: [],
    cost_usd: 0,
    links: [],
    status_from: from,
    status_to: task.status,
    min_ago: 0,
  });
  return taskDetail(viewer, id);
}

function listActivity(viewer: MockUser, params: URLSearchParams): Update[] {
  const limit = Number(params.get("limit") ?? 50) || 50;
  const taskId = params.get("task");
  const via = params.get("via");
  const kind = params.get("kind");
  const visibleIds = new Set(TASKS.filter((t) => canSee(t, viewer)).map((t) => t.id));

  return allUpdates()
    .filter((u) => visibleIds.has(u.task_id))
    .filter((u) => (taskId ? u.task_id === taskId : true))
    .filter((u) => (via ? u.via === via : true))
    .filter((u) => (kind ? u.kind === kind : true))
    .slice(0, limit)
    .map(toUpdate);
}

function listKb(viewer: MockUser, params: URLSearchParams): KbSummary[] {
  const q = (params.get("q") ?? "").trim().toLowerCase();
  return KB.filter((d) => ROLE_RANK[viewer.role] >= ROLE_RANK[d.min_role])
    .filter((d) =>
      q ? `${d.title} ${d.excerpt} ${d.body}`.toLowerCase().includes(q) : true,
    )
    .map((d) => ({
      id: d.id,
      title: d.title,
      excerpt: d.excerpt,
      min_role: d.min_role,
      author: ref(d.author_id),
      created_at: iso(d.min_ago),
    }));
}

function readKb(viewer: MockUser, id: string): KbDoc {
  const doc = KB.find((d) => d.id === id);
  if (!doc) throw new MockError(404, `Document ${id} not found`);
  if (ROLE_RANK[viewer.role] < ROLE_RANK[doc.min_role]) {
    throw new MockError(403, "This document is restricted to a higher role");
  }
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    min_role: doc.min_role,
    author: ref(doc.author_id),
    created_at: iso(doc.min_ago),
    linked_tasks: TASKS.filter((t) => t.docs.some((d) => d.id === doc.id) && canSee(t, viewer)).map((t) => ({
      id: t.id,
      title: t.title,
    })),
  };
}

/** Derives the graph from the same project, milestones, tasks and people. */
export function buildGraph(viewer: MockUser): GraphData {
  const visible = TASKS.filter((t) => canSee(t, viewer));
  const nodes: GraphNode[] = [
    { id: `project:${PROJECT.id}`, type: "project", label: PROJECT.name },
  ];
  const edges: GraphEdge[] = [];

  for (const m of MILESTONES) {
    nodes.push({ id: `milestone:${m.id}`, type: "milestone", label: m.name });
    edges.push({ source: `project:${PROJECT.id}`, target: `milestone:${m.id}`, type: "contains" });
  }

  for (const t of visible) {
    nodes.push({
      id: `task:${t.id}`,
      type: "task",
      label: `${t.id} ${t.title}`,
      status: t.status,
      ...(t.departments[0] ? { department: t.departments[0] } : {}),
      ...dueOf(t),
      live: Boolean(t.live),
      parent_id: t.parent_id ? `task:${t.parent_id}` : null,
    });
    if (!t.parent_id) {
      edges.push({ source: `milestone:${t.milestone_id}`, target: `task:${t.id}`, type: "contains" });
    } else if (visible.some((p) => p.id === t.parent_id)) {
      edges.push({ source: `task:${t.parent_id}`, target: `task:${t.id}`, type: "subtask" });
    }
    for (const dep of t.depends_on) {
      if (visible.some((p) => p.id === dep)) {
        edges.push({ source: `task:${t.id}`, target: `task:${dep}`, type: "depends_on" });
      }
    }
  }

  const seenMention = new Set<string>();
  for (const t of visible) {
    for (const other of t.mentions) {
      if (!visible.some((p) => p.id === other)) continue;
      const key = [t.id, other].sort().join("|");
      if (seenMention.has(key)) continue;
      seenMention.add(key);
      edges.push({ source: `task:${t.id}`, target: `task:${other}`, type: "mentions" });
    }
  }

  const liveAgentIds = new Set(visible.filter((t) => t.live).flatMap((t) => t.workers));
  const people = [...new Set(visible.flatMap((t) => t.workers))];
  for (const id of people) {
    const u = user(id);
    nodes.push({
      id: `person:${u.id}`,
      type: "person",
      label: u.name,
      role: u.role,
      department: u.department,
      live: liveAgentIds.has(u.id),
    });
    for (const t of visible.filter((t) => t.workers.includes(id))) {
      edges.push({ source: `person:${u.id}`, target: `task:${t.id}`, type: "works_on" });
    }
  }

  return { nodes, edges };
}

/**
 * Routes a request to the mock data, mirroring the real API's paths,
 * query filters, status codes and error shape.
 */
export function handleMock(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): unknown {
  advance();
  const url = new URL(path, "http://mock.local");
  const p = url.pathname;
  const q = url.searchParams;
  const payload = (body ?? {}) as { email?: string; password?: string; note?: string };

  if (p === "/api/health") return { ok: true };
  if (p === "/api/auth/login" && method === "POST") {
    return mockLogin(payload.email ?? "", payload.password ?? "");
  }
  if (p === "/api/auth/logout" && method === "POST") return { ok: true };

  const viewer = viewerFromToken(token);

  if (p === "/api/me") return meOf(viewer);
  if (p === "/api/me/agent-key") return agentKey(viewer);
  if (p === "/api/tasks" && method === "GET") return listTasks(viewer, q);
  if (p === "/api/overview") return overview(viewer);
  if (p === "/api/activity") return listActivity(viewer, q);
  if (p === "/api/agents/live") return liveAgents(viewer);
  if (p === "/api/kb" && method === "GET") return listKb(viewer, q);
  if (p === "/api/graph") {
    if (!capabilities(viewer.role).graph) throw new MockError(403, "Only the project manager can see the graph");
    return buildGraph(viewer);
  }
  if (p === "/api/demo/reset" && method === "POST") {
    resetMock();
    return { ok: true };
  }

  const kbMatch = p.match(/^\/api\/kb\/([^/]+)$/);
  if (kbMatch) return readKb(viewer, kbMatch[1]!);

  const approve = p.match(/^\/api\/tasks\/([^/]+)\/approve$/);
  if (approve && method === "POST") return actOnTask(viewer, approve[1]!, "approve", payload.note);

  const reopen = p.match(/^\/api\/tasks\/([^/]+)\/reopen$/);
  if (reopen && method === "POST") return actOnTask(viewer, reopen[1]!, "reopen", payload.note);

  const task = p.match(/^\/api\/tasks\/([^/]+)$/);
  if (task && method === "GET") return taskDetail(viewer, task[1]!);

  throw new MockError(404, `Unknown endpoint ${method} ${p}`);
}

export const MOCK_IMAGE_URL = chartImage;
