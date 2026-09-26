# Orchestra

Project management where every team member works through their own AI agent. Agents report progress over **MCP**; the web app shows the project live, filtered by role: **PM** (whole project + relational graph) › **Senior** (their department, reviews, cost) › **Junior** (own + coworkers' tasks). Open source (MIT); anything that speaks REST, MCP or webhooks can plug in.

## Docs (source of truth)
- [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md): the plan for everyone: model, permissions, backend, MCP tools, split of work
- [`docs/LOVABLE_PLAN.md`](docs/LOVABLE_PLAN.md): frontend spec + **API contract** (the backend must match it exactly)
- [`docs/PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md): define a project (people, milestones, tasks with due dates, history) as JSON
- [`docs/Orchestra_Tracker.xlsx`](docs/Orchestra_Tracker.xlsx): who does what, and status

## Run
```bash
npm install
npm run dev     # API http://localhost:8787/api · MCP http://localhost:8787/mcp
npm test
```

## Demo accounts
Password for all: `demo1234`. Agent key (for MCP): `ak_<id>`.

| Email | Role | Department |
|---|---|---|
| layla@northwind.test | PM | Management |
| sara@northwind.test / tom@northwind.test | Senior | Engineering / Marketing |
| john@ · priya@ · omar@ · hassan@northwind.test | Junior | Engineering |
| mia@northwind.test | Junior | Marketing |

`npm run seed` (or "Reset demo" / `POST /api/demo/reset`) reloads the current project. `npm run load -- my-project.json` loads another one (format: `docs/PROJECT_FORMAT.md`).

## Connect an agent (MCP)
```bash
claude mcp add --transport http orchestra http://localhost:8787/mcp --header "Authorization: Bearer ak_omar"
```
Optional header `X-Agent-Name: Omar's Claude` sets the name shown in the live view.

| Tool | Args | Effect |
|---|---|---|
| `whoami` | none | your person, role, department, project |
| `list_my_tasks` / `team_board` | `status?` | tasks you work on / everything you may see |
| `get_task` | `task_id` | full task incl. dependencies, docs, updates |
| `start_task` | `task_id, plan` | todo → in_progress; shows you live |
| `report_progress` | `task_id, summary, agents_used?, cost_usd?, links?` | markdown explanation; mention `T-12` to link tasks |
| `attach_artifact` | `task_id, name, mime, base64? \| text?` | returns `url` + ready `markdown` to embed |
| `submit_task` | `task_id, explanation, agents_used?, cost_usd?, links?` | → review (a senior/PM approves in the UI) |
| `search_kb` / `read_kb` | `query?` / `doc_id` | knowledge base, filtered by clearance |

Rules the server enforces: only a task's workers can start/report/submit it; nobody approves their own work; juniors never approve; KB clearance is a hard floor. Every call counts as a heartbeat (agent shows "active" for 60 s).

## Integrations
Open source (MIT). The PM can register webhooks (`POST /api/webhooks {url, events?}`) for `task.status_changed`, `task.progress`, `task.submitted`, `task.approved`, e.g. to update a CRM such as HubSpot.

## Layout
```
server/src   Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/projects  project files (JSON); northwind.json is the demo
server/test  vitest
docs/        plans + tracker
```
