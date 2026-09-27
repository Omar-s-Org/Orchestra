# Orchestra MVP pivot — plan

> **Design rationale (why/what).** Current API shapes: `docs/LOVABLE_PLAN.md`. Data format: `docs/PROJECT_FORMAT.md`. Hosting: `docs/DEPLOY.md`.

## Context
The team (Omar, Hassan, Saad + Hazem) agreed a simpler MVP for HACK_002 (submit 08:00 Sun). Core idea: **project management where every person works through an AI agent (MCP), and the UI zooms in by credential.** Saad builds the UI in Lovable against our API; we own backend + MCP. Current backend (branch `claude/brave-archimedes-lbi3ef`, 23 tests) has the right skeleton (Express + SQLite + MCP + audited service layer) but the wrong domain model (4 roles, per-task "scope grants", messages). We reshape it to the agreed model.

Agreed model:
- **3 layers:** PM (sees everything) › Senior (sees their department's tasks) › Junior (sees own tasks + coworkers' junior tasks in the same department; **not** senior/PM tasks).
- **Task = one row that carries everything**, set by the PM at setup (no editing flows for now): title, description, milestone, status (`todo | in_progress | review | done`), **departments**, **workers** (who can work it), **access** (who can view it), scope text + linked KB docs.
- **Shared KB**: documents everyone in the project can read; optional `min_role` (e.g. budget = PM only).
- **Agent reports via MCP**: every progress update carries a human-readable explanation of *how* the person did it (e.g. "used agents 3, 4, 5 to …"), **agents used**, **cost**, and **links**. On completion a final explanation. No multi-agent visualisation — per person.
- **Artifacts**: an agent can attach a file (e.g. generated image) via MCP → stored in DB → linkable in the explanation and viewable in the UI.
- **Live**: UI shows which person's agent is currently on which task and what it's doing (poll 2 s).
- **Demo**: simulated agents (John, Priya, …) are *real* MCP clients driven by a script, alongside real Claude Code agents (Omar/Hassan).
- Out of scope: budget data model, editing task attributes, messaging, multi-agent graphs.

## UI review of Saad's layout (keep / change / cut)
| Level | Saad's item | Verdict |
|---|---|---|
| Junior | My Agents (working on X) | **Keep, rename "My agent"**: one live card per person (current task, current activity, last update, cost so far). Multi-agent is described in text, not visualised. |
| Junior | Work items assigned to me | **Keep** |
| Junior | Shared KB (read) | **Keep** |
| Junior | Agent activity feed | **Keep**: this is the heartbeat of the demo |
| Senior | Junior activity drill-down | **Keep**: it is the same graph/board zoomed to the department (no separate page) |
| Senior | Task assignment | **Cut**: the PM sets tasks at setup; no editing in MVP. **Replace with "Review"**: approve a finished milestone (the senior for milestones fully in their department, the PM for any). Tasks aren't approved one by one; the developer checks each agent update in Claude Code before it is sent |
| Senior | Budget/cost for team | **Keep, as a cost roll-up** of costs agents report via MCP (no budget data model) |
| Senior | Agent orchestration | **Cut** (vague, multi-agent out of scope). Covered by "Live agents" |
| PM | See all work | **Keep**: same graph/board, unzoomed |
| PM | Budget overview | **Keep**: same cost roll-up, grouped by department → person |
| PM | KB contributions from all | **Merge** into the KB page (author + date on each doc) |
| PM | Agent health/capacity | **Simplify to "Live agents"**: active/idle, current task, last seen |
| All | *(missing)* **Task detail drawer** | **Add, essential**: status, departments, workers, access, scope, KB links, and the **timeline of agent explanations** (how it was done, agents used, cost, links, artifacts/images) |
| All | *(missing)* **Project progress header** | **Add**: milestones with % done (filtered to what you can see) |

The final nav is 4 items for everyone: **Graph · Board · Activity · Knowledge**, plus a right-side **Live agents** strip, **Review queue** (senior/PM only) and **Cost** tiles (senior/PM only).

## Unified zoom model (one app, no per-role pages)
One rule on the server decides what each person sees. The UI is the same for every role and just renders what the API returns.
- **Visibility rule:** `canSee(user, task) = user.role == 'pm' OR user is worker/access on task OR (task shares a department with user AND highest role among task.workers ≤ user.role)`
  - Junior → own + coworkers' junior tasks in their department (not senior/PM tasks) ✔ matches the team's answer
  - Senior → every junior + senior task in their department
  - PM → everything
  - Adding a new layer later = add a level number; no new UI.
- Every list, graph, feed, cost roll-up and live-agent list is computed from that same visible-task set. Role only affects: (a) the set; (b) `allowed_actions` on each task (buttons); (c) `me.capabilities` (show Review queue / Cost tiles).
- **Zoom** = choosing a focus node in the graph (project → department → person/task). It's a client-side filter over the graph the server already scoped, so a PM can zoom down to one junior while a junior can never zoom out beyond their department.

## Project graph: PM only, relational (Obsidian-style)
**Why it exists:** so the PM can see which tasks depend on each other and **who is working together**. It isn't decoration: every edge comes from real data in the database.
- **Structure:** one central **Project** node → **Milestones** → **Tasks** → **Subtasks** (`parent_id`).
- **Relational edges between tasks:**
  - `depends_on`: prerequisites, set by the PM in the task row (`task_links`).
  - `mentions`: created **automatically** when a task description or an agent's progress/completion explanation mentions another task (`T-12`) or a person (`@priya`). Same idea as Obsidian backlinks: if Omar's work and Hassan's work reference each other, their tasks connect.
- **People:** person nodes linked to the tasks they work on. Two people on linked tasks show up visibly as collaborators. Nodes pulse when that person's agent is live.
- `GET /api/graph` (PM only; 403 for others) → `{nodes:[{id,type:'project'|'milestone'|'task'|'person',label,status?,live?,department?}], edges:[{source,target,type:'contains'|'subtask'|'depends_on'|'mentions'|'works_on'}]}`. Rebuilt on every request, so it stays current as agents report. The UI polls every 5 s.
- Frontend: `react-force-graph-2d` (force layout, zoom/pan like Obsidian). Colours by node type and task status. Click a task → task drawer. Filter chips: department, status, edge type.
- Seniors and juniors get the **Board** (the same data as cards, scoped by the unified rule), not the graph.

## Prerequisites, locking and suggested order
- Each task can list prerequisites (`depends_on`, set by the PM in the project file).
- **Locked:** while any prerequisite is not **done**, the task is locked. A task is done when its agent submits it. Its workers and their agents can't start, report on or submit a locked task; the server refuses with 409 and the refusal is logged.
- **Suggested order (`sequence`):** prerequisites first (topological order), then earlier due date, then task number. It's a hint: any unlocked task may be done in any order.
- API: every task carries `sequence`, `locked` and `blocked_by`; lists come back in suggested order; MCP `next_task` returns the caller's next unlocked task and what their locked tasks wait on.
- Demo beat: Omar's T-6 is locked behind T-4. Priya's agent submits T-4 and T-6 unlocks live. When the whole milestone is done, Sara approves it in Review.
- Project files with circular prerequisites are rejected at load time.

## Login & agents
- **Humans** log in with **email + password** (company-issued accounts). `POST /api/auth/login` → session token; passwords stored hashed with scrypt (`node:crypto`). Demo accounts are seeded, password `demo1234`.
- **Agents** never use the password. Each user gets a personal **agent API key** (`GET /api/me/agent-key`, shown in a "Connect your agent" dialog with the ready-made `claude mcp add …` command). The agent writes to the database through MCP, and the UI simply shows those updates. There is no direct link between the UI and the agent.

## Open source & integrations (in the pitch + minimal code)
- Open source (MIT `LICENSE`). **An open plug, not specific integrations.** The documented REST API, the MCP server (any MCP-capable agent) and outbound webhooks let anything connect later. **No CRM or HubSpot demo is built for the MVP.**
- Webhooks: `webhooks(url, events)` table; on `task.status_changed`, `task.progress`, `task.submitted` and `task.approved` the server POSTs JSON to registered URLs (fire-and-forget, logged). Registration via `POST /api/webhooks` (PM).

## Data model (replace `server/src/db.ts` SCHEMA)
```
users(id, name, email UNIQUE, password_hash, title, department, role CHECK pm|senior|junior, agent_key UNIQUE)
auth_sessions(token PK, user_id, created_at)
projects(id, name, description)
milestones(id, project_id, name, due)
tasks(id, project_id, milestone_id, parent_id, title, description, scope, status CHECK todo|in_progress|review|done,
      created_by, created_at, updated_at)
task_links(from_task, to_task, type CHECK depends_on|mentions, source)   -- mentions auto-extracted
webhooks(id, url, events JSON, created_by)
task_departments(task_id, department)
task_people(task_id, user_id, relation CHECK worker|access)
kb_docs(id, project_id, title, body, min_role DEFAULT 'junior', author_id, created_at)
task_docs(task_id, doc_id)
task_updates(id, task_id, user_id, via ui|agent, kind progress|completion|approval|status,
             status_from, status_to, summary, agents_used JSON, cost_usd REAL, links JSON, created_at)
artifacts(id random 16-hex, task_id, user_id, name, mime, data BLOB, created_at)
agent_sessions(user_id PK, agent_name, task_id, activity, last_seen)      -- live presence
audit(... unchanged, keeps allowed=0 refusals)
```

## Permissions (rewrite `server/src/permissions.ts`, keep its error classes + style)
- `LEVEL = { junior:1, senior:2, pm:3 }`.
- `canSeeTask(u,t)`: the single unified rule above (one function, used by every endpoint).
- `allowedActions(u,t)` returned on every task: worker → `start`, `report`, `submit` (→ review), `attach`; senior (same dept) or pm → also `approve` (review→done), `reopen`; pm → `create_task` etc. Juniors/agents can never set `done`.
- `canReadDoc(u,d)`: `LEVEL[u.role] >= LEVEL[d.min_role]` (hard floor, also for docs linked to a task).
- Reuse the `guarded()` audit wrapper and 404-not-403 pattern from `server/src/service.ts`.

## Service (rewrite `server/src/service.ts`, same shape)
`me`, `listTasks(filters)`, `getTask` (task + departments + workers + access + docs + updates + artifacts + live agent + allowed_actions), `startTask` (sets in_progress + agent_sessions), `reportProgress({taskId, summary, agentsUsed, costUsd, links, status?})`, `submitTask` (completion explanation → review), `approveTask` / `reopenTask` (senior/pm), `attachArtifact` (base64 ≤5 MB), `getArtifact`, `listKb/readKb`, `activityFeed` (task_updates visible to user, newest first), `liveAgents` (sessions seen <60 s, visible tasks only), `overview` (PM: all depts; senior: own dept — counts by status, per-person progress, total agent cost), PM setup: `createMilestone`, `createTask` (with departments/workers/access/docIds/scope), `createDoc`.

## REST for Lovable (`server/src/http.ts`, keep auth/handler pattern)
`POST /api/auth/login {email,password}`, `POST /api/auth/logout`, `GET /api/me` (incl. `capabilities: {graph, review, cost}`), `GET /api/me/agent-key`, `POST /api/demo/reset`, `GET /api/graph` (PM), `POST /api/webhooks` (PM), `GET /api/tasks?status&department&person&mine`, `GET /api/tasks/:id`, `POST /api/tasks/:id/approve|reopen`, `GET /api/activity?limit&task&via&kind`, `GET /api/agents/live`, `GET /api/overview` (`review_queue` items include `latest_completion` + `artifacts`), `GET /api/kb`, `GET /api/kb/:id`, `GET /api/artifacts/:id?token=` (query token so `<img src>` works), PM: `POST /api/milestones`, `POST /api/tasks`, `POST /api/kb`. Keep Private-Network-Access + CORS middleware.

## MCP tools (`server/src/mcp.ts`, keep stateless Streamable HTTP + bearer auth)
`next_task(task_id?)` (brief with docs inline), `start_task(task_id, plan)`, `report_progress(task_id, summary, agents_used[], cost_usd, links[])`, `attach_artifact(task_id, name, mime, base64) → {url, markdown}`, `submit_task(task_id, explanation, agents_used[], cost_usd, links[]) → {status, next}`, `get_task(task_id, include?, history_limit?)`, `team_board(status?, department?, person?, mine?)`, `search_kb(query)`, `read_kb(doc_id)`. Writes return short acknowledgements (token budget: `npm run mcp:budget`, README). Optional header `X-Agent-Name` labels the agent in the live view. Every call updates `agent_sessions.last_seen`.

## Seed: now `server/projects/northwind.json` (format in `docs/PROJECT_FORMAT.md`)
Tasks include `depends_on` chains and cross-mentions so the graph shows real structure on first load. Project "Northwind Launch" (fictional). PM: Layla. Seniors: Sara (Engineering), Tom (Marketing). Juniors: John, Priya (Eng); Omar, Hassan (Eng, real Claude Code); Mia (Marketing). 3 milestones, ~10 tasks spread across depts incl. one senior task hidden from juniors, 5 KB docs incl. PM-only budget. Password `demo1234`; agent keys `ak_<id>`.

## Simulated agents (Hassan; `server/sim/`, `npm run sim`)
Uses `@modelcontextprotocol/sdk` client against `/mcp` with John/Priya/Mia agent keys + `X-Agent-Name` ("John's Claude"). People come from the project file; what each agent says comes from `server/sim/stories/<project>.json` (data, keyed by task id; tasks without a story get a generic one). Loop per persona: pick its `todo`/`in_progress` tasks (subtasks first) → `start_task` → 2–3 `report_progress` (explanation, agents used, cost) with 3–6 s delays → `attach_artifact` (generated SVG chart) → `submit_task` (embeds the chart). A task with several workers is driven by the first simulated one. Keys: `ak_<id>`, or with `AGENT_KEYS=random` the sim logs in and fetches each key from `/api/me/agent-key`. Options: `--url`, `--people`, `--speed`, `--reset` (as PM), `--project` (must match the server's `PROJECT_FILE`), `--loop` (heartbeat every 30 s so agents stay active in the live rail; re-works tasks after a demo reset).
**Decided:** the demo does not stage a refusal; agents only do allowed work. The server still enforces every rule.

## Split of work (from ~19:30)
| Who | Work |
|---|---|
| **Claude (this session)** | Schema, permissions, service, REST, MCP rewrite + tests; `docs/API.md` contract for Saad; push. Target ≈21:00 |
| **Hassan** | `npm run sim` simulated agents (start from MCP contract in this plan), seed story content (tasks/KB text that reads well on screen), generated artifact (SVG/PNG) |
| **Omar** | Connect Claude Code as a junior agent; wire Saad's Lovable to the API (base URL, auth header, polling); run demo path |
| **Saad** | Lovable UI: 3 zoom levels (PM / Senior / Junior), task board, task drawer (explanations, agents used, cost, artifacts), live agent strip, activity feed, KB |

## Tests (vitest, replace `server/test/*`)
Login (good/bad password; agent key ≠ session token); graph PM-only + mention extraction creates edge; webhook fires on submit; visibility per layer (junior can't see senior task, sees coworker's; senior sees dept only; PM all); junior/agent cannot approve; submit requires explanation; artifact round-trip + permission; KB min_role floor; MCP e2e: start → report → attach → submit → senior approves via REST; live agents list updates.

## Frontend contract
`docs/LOVABLE_PLAN.md` is the source of truth for response shapes. The backend must match it exactly.

## After approval: Lovable plan for Saad
Once this plan is approved, write `docs/LOVABLE_PLAN.md`: in-scope only, copy-paste ready for Lovable. It covers the stack and constraints (no Supabase/auth, API base URL, bearer token, 2 s polling), the exact API contract and JSON shapes, the unified zoom rule (UI renders what the API returns), the graph view spec, each screen and component, visual style, and demo acceptance checks.

## Verification
1. `npm test` green; `npx tsc --noEmit -p server`.
2. `npm run dev`, then `npm run sim` → `/api/agents/live` (as Layla) shows active agents; `/api/activity` fills with explanations incl. cost + artifact links; artifact URL returns image.
3. `claude mcp add --transport http orchestra http://localhost:8787/mcp --header "Authorization: Bearer ak_omar"` → "work on your task" → updates appear in `/api/activity` via=agent.
4. As John: `/api/tasks` excludes the senior task; approve returns 403 and is logged.
5. Push to `claude/brave-archimedes-lbi3ef`; open PR via compare link if MCP PR creation still fails.
