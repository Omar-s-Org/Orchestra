# Orchestra — build plan (HACK_002, submit by Sun 27 Sep 08:00 CEST)

**One line:** A shared project workspace where every person's AI agent works through MCP, with scope-based access: collaborative at the bottom, a management view at the top.

## 1. Permission model (implemented in `server/src/permissions.ts`, 23 tests passing)

| Layer | Rule |
|---|---|
| **Role** (admin 4 › manager 3 › lead 2 › contributor 1) | Sets the *ceiling* of what you can do and your document clearance. |
| **Task assignment** | You see tasks you are assigned to or lead, plus all subtasks under them. |
| **Task scope** (programmable) | When a lead assigns a task, they attach scope: `document`, `person`, `task`. The assignee (and their agent) can then read those docs, message those people and see those tasks, across departments. Revocable at any time. |
| **Management view** | Managers see every task in projects they belong to, plus the roll-up (`/projects/:id/overview`). Admin sees everything. |
| **Document clearance** (hard floor) | `internal` ≥ contributor · `restricted` ≥ lead · `confidential` ≥ manager. **No scope grant can bypass it.** You also can't grant something you can't read yourself. |
| **Need-to-know docs** | `visibility: scoped` = only the owner, admin, or an explicit task grant can read it. Rank alone isn't enough (e.g. an HR file). |
| **Agent = its human** | An agent authenticates with its human's token and has exactly that person's rights. Every call is audited as `via: agent`, including refused ones. |
| **Human closes work** | Workers (and agents) move tasks `todo → in_progress → review` (or `blocked`). Only the task's lead or a manager marks it `done`. |

Action matrix (what the UI shows as buttons; the server returns `allowed_actions` on every task):

| Role | Creates | Assigns | Closes | Manages people / permissions |
|---|---|---|---|---|
| Admin | everything | anyone | any | yes |
| Manager | top-level tasks in own projects | within own projects | within own projects | adds project members |
| Lead | top-level tasks + subtasks | tasks they lead | tasks they lead | edits scope of tasks they lead |
| Contributor | subtasks on own tasks (for self) | no | → `review` only | no |

## 2. Architecture
```
Lovable web UI ──REST /api (Bearer token)──┐
                                           ├─ Express + permission engine + SQLite (server/)
Claude agents ──MCP /mcp (Bearer token)────┘        every call → audit table
```
- Stack: Node 22, TypeScript, Express 5, better-sqlite3, zod, `@modelcontextprotocol/sdk` 1.30.1 (Streamable HTTP, stateless), vitest.
- Run: `npm install && npm run dev` → API `http://localhost:8787/api`, MCP `http://localhost:8787/mcp`.
- Demo users (tokens): `tok_layla` admin · `tok_karim` manager · `tok_sara` lead · `tok_tom` lead · `tok_omar` / `tok_lukas` / `tok_nadia` / `tok_mia` contributors.

### Connect an agent (Omar's agent)
```bash
claude mcp add --transport http orchestra http://localhost:8787/mcp --header "Authorization: Bearer tok_omar"
```
Then: *"Work on T-57. Read the task and its docs, message Legal about using call transcripts, create a subtask for the Legal interview, and move T-58 to review with a summary."*

MCP tools: `whoami`, `list_my_tasks`, `get_task`, `update_task_status`, `add_comment`, `create_subtask`, `search_documents`, `read_document`, `list_contacts`, `send_message`, `project_overview`.

## 3. REST API contract (for Saad / Lovable)
All routes except `/api/health` and `/api/demo/*` need `Authorization: Bearer <token>`. Errors: `{ "error": "..." }` with 400/401/403/404.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/demo/users` | — | users incl. `token` (**demo login switcher**) |
| POST | `/api/demo/reset` | — | reseeds demo |
| GET | `/api/me` | — | `{ user, level, view: "collaborate"\|"manage", projects[] }` |
| GET | `/api/tasks` | `?projectId&mine=true&status` | tasks visible to me, each with `assignee`, `lead`, `allowed_actions[]` |
| GET | `/api/tasks/:id` | — | task + `subtasks[]`, `scope{documents[], people[], tasks[]}`, `comments[]` |
| POST | `/api/tasks` | `{ projectId? , parentId?, milestoneId?, title, description?, assigneeId?, due? }` | task |
| POST | `/api/tasks/:id/status` | `{ status, note? }` | task |
| POST | `/api/tasks/:id/comments` | `{ body }` | task |
| POST | `/api/tasks/:id/assign` | `{ assigneeId }` | task |
| POST | `/api/tasks/:id/scope` | `{ kind: "document"\|"person"\|"task", refId }` | task |
| DELETE | `/api/tasks/:id/scope/:kind/:refId` | — | task |
| GET | `/api/documents` | `?q=` | docs I can read |
| GET | `/api/documents/:id` | — | doc with body (403 if not cleared) |
| GET | `/api/contacts` | — | people I may message |
| GET / POST | `/api/messages` | `{ toId, body, taskId? }` | inbox / sent message |
| GET | `/api/projects/:id/overview` | — | manager/admin: progress, workstreams → milestones, blocked, awaiting_review, people load, metrics |
| GET | `/api/audit` | `?projectId` | manager/admin: audit trail (`via`, `allowed`, `detail`) |
| GET | `/api/users` | — | directory |
| POST | `/api/admin/users` · `/api/admin/users/:id/role` | `{ name, role, ... }` · `{ role }` | admin only |

Task fields: `id, project_id, milestone_id, parent_id, title, description, status (todo|in_progress|blocked|review|done), assignee{id,name}, lead{id,name}, due, allowed_actions[]`.

## 4. UI per role (one app, the view follows `me.view` and `allowed_actions`)
- **Top bar:** "Log in as" switcher (from `/api/demo/users`) labelled DEMO, and a "Reset demo" button.
- **Contributor / Lead: "My Work" (collaborate):** my tasks as cards grouped by status; task detail with description, subtasks, comments (agent comments marked with a 🤖 "via agent" badge), **Scope panel** (people I can talk to + docs I can read), and a Messages drawer. Buttons come only from `allowed_actions`.
- **Lead extra:** "Review queue" (tasks in `review` I lead → Mark done), and a scope editor on tasks I lead (add/remove person or document; show the server's refusal message inline).
- **Manager: "Project overview" (manage):** KPI row (total, % done, blocked, awaiting review, agent actions, denied actions), workstream → milestone progress bars, blocked list, people-load table, audit feed.
- **Admin:** everything above + Users & roles table + full audit log with denied actions highlighted.
- Poll every 2 s so agent changes appear live.

**Lovable can't reach localhost.** For live data in the Lovable preview, the backend owner runs `npx cloudflared tunnel --url http://localhost:8787` and gives Saad the URL as `VITE_API_URL`. CORS is already open. Lovable must NOT add Supabase or auth; this API is the only backend.

## 5. Demo script (2 min)
1. **Omar (intern)**: My Work → T-57 "Identify top 10 AI use cases". Scope shows Sales, Legal and After-sales people plus two docs. Cross-department access, granted per task.
2. **Omar's agent in Claude Code (MCP)** works T-57 live: reads Sales notes, messages Legal, creates a subtask, moves T-58 to review with findings. It tries to mark it done → **refused**. The UI updates live with 🤖 badges.
3. **Sara (lead)**: Review queue → marks T-58 done. Adds Legal to Lukas's blocked task scope → Lukas can now message Nadia.
4. **Karim (manager)**: Project overview. Milestone progress, the blocked task, agent actions vs denied actions.
5. **Layla (admin)** tries to grant the confidential FY27 budget to Omar's task → **refused: clearance is a hard floor**. Audit log shows everything, including refusals.
6. Closing line: "Collaborative at the bottom, management at the top, and every agent stays inside its human's permissions."

## 6. Timeline (CEST)
| Until | Milestone |
|---|---|
| 18:45 ✅ | M0 Backend core: permission engine, REST, MCP, seed, 23 tests |
| 21:30 | M1 UI screens in Lovable on the live API (via tunnel); agent connected from Claude Code |
| 00:00 | M2 Demo path end to end: agent → UI live → lead review → manager overview |
| 02:00 | M3 Admin screens, scope editor, audit, metrics. **Feature freeze 02:00** |
| 05:00 | M4 Bug fixes only, rehearsal ×3, README |
| 07:30 | M5 2-min video, ZIP repo, submit form (deadline 08:00) |
