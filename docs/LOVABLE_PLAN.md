# Orchestra: frontend build plan (for Lovable)

> **How to use:** paste this entire file into Lovable as the first message, then add: *"Build the app exactly as specified. Start with the mock mode so every screen works without the backend."*

## 1. What we're building
**Orchestra** is a project-management workspace where every team member works through their own AI agent. Agents report progress to our backend, and this web app shows the project **live**. What each person sees depends on their role:

- **PM** sees the whole project, including a relational graph of all milestones, tasks and people.
- **Senior** sees their department's tasks, reviews finished work and sees their team's cost.
- **Junior** sees their own tasks and their junior coworkers' tasks.

The app is **read-mostly**. Agents do the work and the UI shows it. The only human actions in the UI are **log in/out**, **approve / send back** (senior, PM) and **copy agent connection key**.

## 2. Hard constraints
1. **Frontend only.** Do NOT enable Lovable Cloud, Supabase, any database or any auth provider. Our Express API is the only backend.
2. **API base URL:** read from `localStorage.apiBase`, default `http://localhost:8787`. Settings popover in the user menu to change it.
3. **All API calls go through one file, `src/lib/api.ts`,** using plain `fetch`. After login, send `Authorization: Bearer <token>` on every request. Store the token in `localStorage.token`. On any 401, clear the token and go to the login page.
4. **Never compute permissions in the UI.** The server already filters everything. Show action buttons **only** when the task's `allowed_actions` includes them, and show nav items **only** from `me.capabilities`.
5. **Live updates by polling:** the current page's data every **2 s**, the graph every **5 s**. Keep previous data on screen while refetching (no flicker, no spinners after the first load).
6. **Mock mode** (`localStorage.mock = "true"`, toggle in the settings popover, **ON by default until the backend is reachable**): `api.ts` returns data from `src/lib/mock.ts`, using the exact shapes in section 4. Make the mock data rich and consistent (Northwind project, section 7) and let it change slightly on each poll (a live agent's activity text, a new activity item), so the live UI can be demoed without the backend.
7. Errors come back as `{ "error": "message" }` with status 400/401/403/404. Show them in a toast; show 403 messages in amber (they explain permission refusals).
8. Libraries: React + TypeScript + Tailwind + shadcn/ui (Lovable default), `react-force-graph-2d` for the graph, `react-markdown` for explanations, `lucide-react` for icons.

## 3. Roles and navigation (one app, not one app per role)
There is **one** layout for everyone. What changes per role comes only from the API:
- **Nav items:** `Graph` (only if `me.capabilities.graph`), `Board`, `Activity`, `Knowledge`, `Review` (only if `me.capabilities.review`).
- **Cost tiles** are shown only if `me.capabilities.cost`.
- **Landing page:** Graph if `capabilities.graph`, otherwise Board.
- Role labels: `pm` → "Project Manager", `senior` → "Senior", `junior` → "Junior", shown as a coloured badge (PM violet, Senior blue, Junior slate).

## 4. API contract (all paths under `{apiBase}`)

### Types
```ts
type Role = "pm" | "senior" | "junior";
type Status = "todo" | "in_progress" | "review" | "done";
type UserRef = { id: string; name: string; role: Role; department: string };
type Live = { agent_name: string; activity: string; since: string } | null;   // an agent is working on it right now

type TaskSummary = {
  id: string;                    // "T-12"
  title: string;
  status: Status;
  milestone: { id: string; name: string };
  parent_id: string | null;      // subtask if set
  departments: string[];         // ["Engineering","Marketing"]
  workers: UserRef[];            // people who work on it
  access: UserRef[];             // people who can view it
  live: Live;
  cost_usd: number;              // total reported by agents so far
  updated_at: string;            // ISO
  allowed_actions: ("approve" | "reopen")[];   // UI-relevant actions for the current user
};

type Update = {                  // one agent/human report on a task
  id: number;
  task: { id: string; title: string };
  kind: "progress" | "completion" | "approval" | "status";
  via: "agent" | "ui";
  user: UserRef;
  agent_name: string | null;     // e.g. "John's Claude"
  summary: string;               // MARKDOWN: explanation of how the work was done; may contain links and images
  agents_used: string[];         // e.g. ["research agent","writer agent"]
  cost_usd: number;              // cost of this step
  links: { label: string; url: string }[];
  status_from: Status | null;
  status_to: Status | null;
  created_at: string;
};

type Artifact = { id: string; name: string; mime: string; url: string; user: UserRef; created_at: string };
// url is relative ("/api/artifacts/ab12cd"); display it with `${apiBase}${url}?token=${token}` (so <img src> works)

type TaskDetail = TaskSummary & {
  description: string;           // markdown
  scope: string;                 // markdown: what is in/out of scope for this task
  docs: { id: string; title: string; readable: boolean }[];
  depends_on: { id: string; title: string; status: Status }[];
  blocks: { id: string; title: string; status: Status }[];
  mentions: { id: string; title: string; status: Status }[];   // related tasks (either direction)
  subtasks: TaskSummary[];
  updates: Update[];             // newest first
  artifacts: Artifact[];
};
```

### Endpoints
| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user: UserRef & {email,title} }` (401 on bad credentials) |
| POST | `/api/auth/logout` | none | `{ ok: true }` |
| GET | `/api/health` | none | `{ ok: true }` (no auth) |
| GET | `/api/me` | none | `{ user, capabilities: { graph: boolean, review: boolean, cost: boolean }, project: { id, name, description } }` |
| GET | `/api/me/agent-key` | none | `{ agent_key, mcp_url, command }`, where `command` is a ready-to-copy `claude mcp add …` line |
| GET | `/api/tasks` | `?status=&department=&mine=true` | `TaskSummary[]` |
| GET | `/api/tasks/:id` | none | `TaskDetail` |
| POST | `/api/tasks/:id/approve` | `{ note? }` | `TaskDetail` (review → done) |
| POST | `/api/tasks/:id/reopen` | `{ note }` | `TaskDetail` (review → in_progress) |
| GET | `/api/activity` | `?limit=50&task=` | `Update[]` newest first |
| GET | `/api/agents/live` | none | `{ user: UserRef, agent_name: string, status: "active" \| "idle", task: {id,title} \| null, activity: string, last_seen: string }[]` |
| GET | `/api/overview` | none | see below |
| GET | `/api/graph` | none | see section 6 (PM only; others get 403) |
| GET | `/api/kb` | `?q=` | `{ id, title, excerpt, min_role: Role, author: UserRef, created_at }[]` |
| GET | `/api/kb/:id` | none | `{ id, title, body /* markdown */, min_role, author, created_at, linked_tasks: {id,title}[] }` |
| POST | `/api/demo/reset` | none | `{ ok: true }` (demo button in the settings popover) |

`GET /api/overview`:
```ts
{
  milestones: { id: string; name: string; due: string; total: number; done: number; pct: number }[];
  by_status: { todo: number; in_progress: number; review: number; done: number };
  review_queue: TaskSummary[];                       // tasks in review I can approve (empty for juniors)
  cost: null | {                                     // null when capabilities.cost is false
    total_usd: number;
    by_department: { department: string; cost_usd: number }[];
    by_person: { user: UserRef; cost_usd: number; tasks_done: number }[];
  };
}
```

## 5. Screens

### 5.1 Login
Centred card with the Orchestra logo, email and password fields, and a "Sign in" button. Below it, a collapsible **"Demo accounts"** list (section 7) where clicking a row fills the form. On success, save the token and go to the landing page.

### 5.2 App shell
- **Top bar:** logo, project name, a **milestone progress strip** (one small bar per milestone with its %, from `/api/overview`), then the user menu (name, role badge, department) containing **Connect your agent**, **Settings** (API URL, mock toggle, Reset demo) and **Log out**.
- **Left nav** as in section 3.
- **Right rail, always visible: "Live agents"**, from `/api/agents/live`. One row per person: avatar initials, name, role badge, and `agent_name`. A **pulsing green dot** means active; a grey dot means idle. Show the current task id and title (click opens the task drawer), `activity` in italic, and "last seen 12 s ago".
- **Connect your agent** dialog: shows `command` from `/api/me/agent-key` in a code block with a copy button, plus one line: "Your agent updates tasks through MCP; this page updates live."

### 5.3 Graph (PM only): the centrepiece
See section 6.

### 5.4 Board (everyone)
- Header: status count chips (from `by_status`). If `capabilities.cost` is true, add **cost tiles**: total cost, plus a mini bar list of cost by department (PM) or by person (senior).
- Filter chips: department, person, "Mine" (`mine=true`).
- **Kanban**, 4 columns: To do · In progress · Review · Done. Each card shows the id, title, milestone name, department tags, worker avatars, and cost. If `live` is set, add a pulsing border and "🤖 {agent_name}: {activity}". Subtasks appear indented under their parent with a small "↳".
- Clicking a card opens the **task drawer**.

### 5.5 Task drawer (everyone; right side sheet, about 560px wide)
1. Id, title, status pill, milestone, department tags.
2. **People:** Workers (avatars and names) and Access (smaller avatars).
3. **Live banner** when `live` is set: pulsing dot, "{agent_name} is working: {activity}".
4. Tabs:
   - **Timeline (default):** `updates` as cards. Each card shows the avatar and name, a **🤖 via agent** badge when `via=agent`, a kind label (Progress / Completed / Approved / Status), the time, the `summary` **rendered as markdown** (images inline; rewrite `/api/artifacts/...` URLs as in section 4), an `agents_used` chip list, a cost chip (`$0.42`), and `links` as buttons. **Completion** cards get a highlighted border: this is "how the agent did it".
   - **Details:** description (markdown), scope (markdown), dependencies ("Depends on", "Blocks" and "Related" lists; clicking opens that task), docs (locked icon if `readable=false`), subtasks.
   - **Files:** artifact grid. Images show a thumbnail; other files show an icon and a download link.
5. Footer actions, **only if present in `allowed_actions`**:
   - **Approve** (green; optional note)
   - **Send back** (amber; note required)
   Juniors never see these.

### 5.6 Activity (everyone)
A full-page feed from `/api/activity`, newest first, in the same card design as the timeline but with the task title as a link. Filter chips: agent only / human only / completions only. New items slide in at the top.

### 5.7 Knowledge (everyone)
A search box, then a list of docs (title, excerpt, author, date, and a role badge if `min_role` is above junior). Clicking opens a reader view (markdown body plus "Linked tasks").

### 5.8 Review (senior + PM, only if `capabilities.review`)
A list of `review_queue` tasks. Each row shows the latest **completion** summary (markdown, collapsed to 4 lines with an expand control), the cost, and the artifacts, with **Approve** and **Send back** buttons. This is the human-in-the-loop moment of the demo.

## 6. Project graph (PM only)
**Purpose:** show the PM how the project fits together and **who is working together**. Every node and edge comes from the API.

`GET /api/graph` response:
```ts
{
  nodes: {
    id: string;                 // "project:P-1", "milestone:M-1", "task:T-12", "person:john"
    type: "project" | "milestone" | "task" | "person";
    label: string;
    status?: Status;            // tasks
    department?: string;        // tasks, persons
    role?: Role;                // persons
    live?: boolean;             // task being worked on / person's agent active
    parent_id?: string | null;  // tasks: subtask of
  }[];
  edges: {
    source: string; target: string;
    type: "contains"            // project→milestone, milestone→task
        | "subtask"             // task→subtask
        | "depends_on"          // task→prerequisite task
        | "mentions"            // task↔task referenced in text or agent reports (auto)
        | "works_on";           // person→task
  }[];
}
```
**Rendering** (`react-force-graph-2d`, dark canvas, Obsidian feel):
- **Project:** one large central node (violet, about 3× size), label always shown.
- **Milestone:** medium, indigo, label always shown.
- **Task:** small circle filled by status (todo slate `#94a3b8`, in_progress blue `#3b82f6`, review amber `#f59e0b`, done green `#22c55e`). Subtasks are smaller.
- **Person:** a rounded square with initials, coloured by role.
- **Live** nodes get an animated glow ring (use `nodeCanvasObject`; redraw with `requestAnimationFrame`).
- **Edges:**
  - `contains` and `subtask`: thin grey
  - `depends_on`: orange with a directional arrow and animated particles
  - `mentions`: dashed cyan
  - `works_on`: thin role-coloured
- Labels for task and person nodes appear on hover or when zoomed in (`globalScale > 1.5`).
- **Interactions:**
  - Click a task → task drawer.
  - Click a person → highlight that person, their tasks and first-degree neighbours, and fade the rest (shows who works with whom).
  - Click a milestone → zoom to fit its subtree.
  - Double-click the background → reset.
- **Toolbar** above the canvas: department filter, status filter, edge-type toggles (Dependencies / Mentions / People), and a "Fit" button. Keep node positions stable across polls: merge new data into the existing graph objects instead of replacing them, so the layout doesn't jump.
- Legend in the bottom-left corner.

## 7. Demo data (use for `mock.ts`; the backend seeds the same)
Project **"Northwind Launch"**: launch of a new product line, run with AI agents.

| Email | Name | Role | Department |
|---|---|---|---|
| layla@northwind.test | Layla Haddad | pm | Management |
| sara@northwind.test | Sara Weber | senior | Engineering |
| tom@northwind.test | Tom Berger | senior | Marketing |
| john@northwind.test | John Carter | junior | Engineering |
| priya@northwind.test | Priya Nair | junior | Engineering |
| omar@northwind.test | Omar | junior | Engineering |
| hassan@northwind.test | Hassan | junior | Engineering |
| mia@northwind.test | Mia Hofer | junior | Marketing |

All passwords: `demo1234`.

Milestones:
- M-1 "MVP ready" (3 Oct)
- M-2 "Beta with 10 customers" (17 Oct)
- M-3 "Public launch" (31 Oct)

Mock tasks: about 12 across the milestones, including subtasks. Include:
- a `depends_on` chain (T-3 → T-5 → T-9)
- two tasks that `mention` each other, worked on by different people
- one senior-only task (Sara, "Architecture review")
- tasks in every status
- 2–3 tasks with `live` agents
- completion updates with markdown, `agents_used`, a cost and one image artifact (use a placeholder chart image in mock mode)

## 8. Visual style
Clean, modern SaaS: Linear meets Obsidian. Light theme by default with a dark mode toggle. The graph canvas is always dark. Font: Inter. Rounded-xl cards, subtle borders, generous spacing. Status colours as in section 6. Agent-related UI (🤖 badges, live dots, glow) uses **emerald**. Footer pill: "Demo data · Open source (MIT)". Must look good at 1440×900 (demo screen) and remain usable at 1280px.

## 9. Acceptance checklist (demo must pass)
- [ ] Login works with each demo account; a bad password shows an error.
- [ ] As **Layla (PM)**: the Graph shows project → milestones → tasks → people, with orange dependency arrows and cyan mention links. Clicking John highlights his tasks and collaborators; live nodes glow.
- [ ] As **Sara (senior)**: no Graph in the nav. The Board shows only Engineering tasks, cost tiles appear, and the Review page shows tasks awaiting approval. Approve moves the card to Done within 2 s.
- [ ] As **John (junior)**: sees his own and his junior coworkers' Engineering tasks, but not "Architecture review". No Approve buttons, no cost tiles.
- [ ] The task drawer timeline shows markdown explanations with agents used, cost, links and an inline image.
- [ ] The Live agents rail and Activity feed update without reloading.
- [ ] Connect your agent shows a copyable command.
- [ ] Mock mode ON: everything works offline. Mock mode OFF with the backend running: the same screens work on real data.
