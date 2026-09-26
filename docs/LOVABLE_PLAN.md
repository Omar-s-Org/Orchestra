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
2. **API base URLs (with failover):** `src/lib/config.ts` exports `API_BASES = [PRIMARY, BACKUP]`: the Railway URL, then the Render URL (the team sends both). A setting in the user menu can override them with one custom URL (`localStorage.apiBase`, e.g. `http://localhost:8787` for local dev). `apiBase` in this document means **the currently active base**.
3. **All API calls go through one file, `src/lib/api.ts`,** using plain `fetch`. After login, send `Authorization: Bearer <token>` on every request. Store the token in `localStorage.token`. On any 401, clear the token and go to the login page.
4. **Never compute permissions in the UI.** The server already filters everything. Show action buttons **only** when the task's `allowed_actions` includes them, and show nav items **only** from `me.capabilities`.
5. **Live updates by polling:** the current page's data every **2 s**, the graph every **5 s**. Keep previous data on screen while refetching (no flicker, no spinners after the first load).
6. **Mock mode:** `api.ts` can serve every endpoint from `src/lib/mock.ts`, using the exact shapes in section 4. See **section 10** for when it switches on. The mock data must be rich and consistent (Northwind project, section 7) and change slightly on each poll (a live agent's activity text, a new activity item), so the live UI can be demoed without the backend. Mock must implement the same query filters as the real API.
7. Errors come back as `{ "error": "message" }` with status 400/401/403/404. Show them in a toast; show 403 messages in amber (they explain permission refusals).
8. Libraries: React + TypeScript + Tailwind + shadcn/ui (Lovable default), `react-force-graph-2d` for the graph, `react-markdown` + `remark-gfm` for explanations, `lucide-react` for icons, TanStack Query for data and polling, **TanStack Router** (the stack's router) for routes, `sonner` (shadcn) for toasts, `date-fns` for times. Routing, state and UI defaults are fixed in **section 10**; don't improvise them.
9. **Browser-only authenticated data (critical).** The session token lives in `localStorage`, which only exists in the browser. So every authenticated API call runs **in the browser**: TanStack Query hooks inside components. Never make these calls in a route `loader`, a server function (`createServerFn`), or during server-side rendering. If the stack renders on the server, show a skeleton until the component is mounted. All `localStorage` access goes through one helper guarded by `typeof window !== "undefined"`.

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
  due: string | null;            // "2026-10-02" (YYYY-MM-DD) or null
  overdue: boolean;              // past due and not done → show a red "Overdue" badge
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
// url is relative ("/api/artifacts/ab12cd"); display it with `${apiBase}${url}?token=${token}` (so <img src> works).
// DEMO-ONLY: a token in a URL can leak via logs/history. Production would use short-lived signed URLs.

type ReviewItem = TaskSummary & {          // used by the Review page; no per-task fetch needed
  latest_completion: Update | null;         // the most recent kind="completion" update
  artifacts: Artifact[];
};

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
| GET | `/api/tasks` | `?status=&department=&person=<userId>&mine=true` (all optional, combinable) | `TaskSummary[]` |
| GET | `/api/tasks/:id` | none | `TaskDetail` |
| POST | `/api/tasks/:id/approve` | `{ note? }` | `TaskDetail` (review → done) |
| POST | `/api/tasks/:id/reopen` | `{ note }` | `TaskDetail` (review → in_progress) |
| GET | `/api/activity` | `?limit=50&task=&via=agent\|ui&kind=progress\|completion\|approval\|status` (all optional) | `Update[]` newest first |
| GET | `/api/agents/live` | none | `{ user: UserRef, agent_name: string, status: "active" \| "idle", task: {id,title} \| null, activity: string, last_seen: string }[]` |
| GET | `/api/overview` | none | see below |
| GET | `/api/graph` | none | see section 6 (PM only; others get 403) |
| GET | `/api/kb` | `?q=` | `{ id, title, excerpt, min_role: Role, author: UserRef, created_at }[]` |
| GET | `/api/kb/:id` | none | `{ id, title, body /* markdown */, min_role, author, created_at, linked_tasks: {id,title}[] }` |
| POST | `/api/demo/reset` | none | `{ ok: true }`. **PM only** (403 otherwise). Show the "Reset demo" button only when `me.user.role === "pm"` |

`GET /api/overview`:
```ts
{
  milestones: { id: string; name: string; due: string; total: number; done: number; pct: number }[];
  by_status: { todo: number; in_progress: number; review: number; done: number };
  overdue: number;                                   // visible tasks past due and not done
  review_queue: ReviewItem[];                        // tasks in review I can approve (empty for juniors)
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
- Header: status count chips (from `by_status`), plus a red **Overdue** chip when `overview.overdue > 0`. If `capabilities.cost` is true, add **cost tiles**: total cost, plus a mini bar list of cost by department (PM) or by person (senior).
- Filter chips: department, person, "Mine". These are **server-side** filters: pass them as `department`, `person` and `mine` query params, and sync them to the URL (section 10).
- **Kanban**, 4 columns: To do · In progress · Review · Done. Each card shows the id, title, milestone name, department tags, worker avatars, cost, and the **due date** ("Due 2 Oct"; red with an "Overdue" badge when `overdue`). If `live` is set, add a pulsing border and "🤖 {agent_name}: {activity}". Subtasks appear indented under their parent with a small "↳".
- Clicking a card opens the **task drawer**.

### 5.5 Task drawer (everyone; right side sheet, about 560px wide)
1. Id, title, status pill, milestone, due date (red if overdue), department tags.
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
A full-page feed from `/api/activity`, newest first, in the same card design as the timeline but with the task title as a link. Filter chips: Agent only (`via=agent`), Human only (`via=ui`), Completions (`kind=completion`). These are **server-side** query params synced to the URL. New items slide in at the top.

### 5.7 Knowledge (everyone)
A search box, then a list of docs (title, excerpt, author, date, and a role badge if `min_role` is above junior). Clicking opens a reader view (markdown body plus "Linked tasks").

### 5.8 Review (senior + PM, only if `capabilities.review`)
A list of `review_queue` items (`ReviewItem`, section 4; no extra fetches). Each row shows the latest **completion** summary (markdown, collapsed to 4 lines with an expand control), the cost, and the artifacts, with **Approve** and **Send back** buttons. This is the human-in-the-loop moment of the demo.

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
    due?: string | null;        // tasks
    overdue?: boolean;          // tasks: draw a red outline
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
- **Mock graph:** in mock mode, `mock.ts` exposes `buildGraph()` that **derives** nodes and edges from the same mock project, milestones, tasks and people. Never hand-write a separate graph. The rules are:
  - one `project` node
  - `contains`: project→each milestone, and milestone→each top-level task
  - `subtask`: parent→child
  - `depends_on`: from each task's `depends_on` list
  - `mentions`: from each task's `mentions` list, de-duplicated so A↔B is one edge
  - `works_on`: each worker→task
  - `live`: true if the task's `live` is set or the person has an active agent

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
- [ ] In auto mode, if the primary is unreachable, the app switches to the backup within about 10 s (toast, re-login). If both are down it switches to MOCK, and when the primary returns it switches back to LIVE · primary.
- [ ] Board/Activity filters and the open task drawer survive a page refresh (URL query params).
- [ ] A 401 logs out once and returns to the same page after logging in again.
- [ ] A hard refresh of `/board?task=T-4` (logged in, LIVE) reopens the drawer with live data, and the browser's network tab shows the request going to the hosted API.
- [ ] Only the PM sees "Reset demo".

## 10. App architecture and UI defaults (fixed decisions; don't guess)

### Routes (TanStack Router)
| Path | Page | Guard |
|---|---|---|
| `/login` | Login | public; if already logged in, go to landing |
| `/graph` | Graph | auth + `capabilities.graph`, else redirect `/board` |
| `/board` | Board | auth |
| `/activity` | Activity | auth |
| `/knowledge`, `/knowledge/:id` | Knowledge list / reader | auth |
| `/review` | Review | auth + `capabilities.review`, else redirect `/board` |
| `/` | redirect to landing (section 3) | auth |

- Implementation with TanStack Router:
  - Declare each route's query params with `validateSearch` (zod): Board `{ department?, person?, mine?, task? }`, Activity `{ via?, kind?, task? }`, Knowledge/Graph/Review `{ task? }`, Login `{ next? }`.
  - Do guards in `beforeLoad` only when running in the browser (`typeof window !== "undefined"`), or in the authenticated layout component. Redirect with `redirect({ to: "/login", search: { next: location.href } })`.
- **Task drawer** = the query param `?task=T-12` on any page. It is deep-linkable, and closing it removes the param.
- **Filters** live in query params too (e.g. `/board?department=Engineering&person=john`), so a refresh keeps them.
- **Auth guard:** with no token, redirect to `/login?next=<current path>`, and return there after login.

### Data layer
- `api.ts` has one `request()` function. It adds the bearer token, parses `{error}`, and throws `ApiError(status, message)`. **On 401**, it clears the token, clears the query cache and navigates to `/login`, one time only (guard against a redirect loop).
- **Polling** with TanStack Query: `useQuery({ refetchInterval: 2000, placeholderData: keepPreviousData, refetchIntervalInBackground: false })`. The graph uses 5000. `/api/me` loads once after login and whenever the user changes.
- Mutations (approve / send back) invalidate the `tasks`, `overview`, `activity` and `task:<id>` queries.
- **Errors:** one `ErrorBoundary` per page with a "Retry" button. Query errors show inline (not a toast storm): one toast per distinct message.

### Mock mode logic
- `localStorage.mockMode` is `"auto" | "on" | "off"`, default **`"auto"`**, and can be changed in the settings popover.
- **auto:** on start, and then every **10 s**, call `GET /api/health` on the active base with a 2 s timeout. If it fails, try the next base in `API_BASES`; if one is healthy, switch to it (one toast: "Switched to backup server"). Sessions are per server, so after a switch the user must log in again: clear the token and go to `/login?next=…`.
  - Reachable → use the real API.
  - Unreachable → use mock data.
  - When the mode flips, show one toast ("Backend offline, showing mock data" / "Connected to live backend") and clear the query cache.
- **on / off:** force mock or real mode, with no health checks.
- A top-bar pill always shows the current source: **LIVE · primary** (emerald), **LIVE · backup** (teal) or **MOCK** (amber). Hovering it shows the active URL.
- **Login in mock mode:** the demo accounts with password `demo1234` succeed, and the token is `mock:<userId>`. Mock data must respect the same role visibility (section 3 and the checklist), so role switching can be demoed offline.

### UI defaults
- **Dark mode:** a sun/moon toggle in the top bar, stored in `localStorage.theme`. The graph canvas is always dark.
- **Toasts:** `sonner`, bottom-right. 403 messages use the amber/warning style.
- **Right rail (Live agents):** at 1440px and wider, a fixed 320px column. Below 1440px, it collapses to an icon button in the top bar with a badge counting active agents, which opens the rail as a sheet.
- **Relative times:** `formatDistanceToNowStrict(date, { addSuffix: true })` ("12 seconds ago"), with the absolute time in the `title` tooltip.
- **Money:** `$0.42`, or `$12.30` when the total is $10 or more.
- **Markdown security:** use `react-markdown` + `remark-gfm` **without `rehype-raw`**, so raw HTML is never rendered. Links open in a new tab with `rel="noopener noreferrer"`. Images render only when their URL starts with `apiBase` (artifacts) or, in mock mode, a bundled placeholder; any other image shows as a link.
- **Empty states** (icon + one line + optional hint):
  - Board: "No tasks match these filters."
  - Activity: "No activity yet. Updates appear here when agents report progress."
  - Review: "Nothing waiting for review."
  - Live agents: "No agents active right now."
  - Knowledge: "No documents found."
- **Loading:** skeletons on first load only; after that, keep the previous data while polling.
