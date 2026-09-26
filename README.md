# Orchestra

Project management where every team member works through their own AI agent. Agents report progress over **MCP**; the web app shows the project live, filtered by role: **PM** (whole project + relational graph) › **Senior** (their department, reviews, cost) › **Junior** (own + coworkers' tasks). Open source (MIT); anything that speaks REST, MCP or webhooks can plug in.

## Where is the truth
| Topic | Source |
|---|---|
| API shapes + frontend behaviour | [`docs/LOVABLE_PLAN.md`](docs/LOVABLE_PLAN.md) |
| Project / demo data format | [`docs/PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md) |
| MCP tools + agent rules | [Connect an agent](#connect-an-agent-mcp) below |
| Hosting | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Why / what (product, permissions) | [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md) |
| Who does what | [`docs/Orchestra_Tracker.xlsx`](docs/Orchestra_Tracker.xlsx) |

## Hosted
| Role | URL |
|---|---|
| Backend primary (Railway) | `https://<railway-domain>`: API `/api`, agents `/mcp` |
| Backend standby (Render) | `https://<render-domain>`: same paths, demo data |
| Frontend | Lovable |

Setup + failover: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Run
```bash
npm install
npm run dev     # local: API http://localhost:8787/api · MCP http://localhost:8787/mcp
npm start       # production-style (what Railway runs)
npm test
npm run check -- --url https://<host>   # contract check: every API response vs docs/LOVABLE_PLAN.md §4, per role (GETs + logins only)
```

## Demo accounts
Password for all: `demo1234`. Agent key (for MCP): `ak_<id>`.

| Email | Role | Department |
|---|---|---|
| layla@northwind.test | PM | Management |
| sara@northwind.test / tom@northwind.test | Senior | Engineering / Marketing |
| john@ · priya@ · omar@ · hassan@northwind.test | Junior | Engineering |
| mia@northwind.test | Junior | Marketing |

`npm run seed` (or "Reset demo" as the PM / `POST /api/demo/reset`) reloads the current project. `npm run load -- my-project.json` loads another one (format: `docs/PROJECT_FORMAT.md`).

## Connect an agent (MCP)
```bash
claude mcp add --transport http orchestra http://localhost:8787/mcp --header "Authorization: Bearer ak_omar"
```
Optional header `X-Agent-Name: Omar's Claude` sets the name shown in the live view.

| Tool | Args | Effect |
|---|---|---|
| `whoami` | none | your person, role, department, project |
| `next_task` | none | **start here**: your suggested next unlocked task + your locked tasks and what they wait on |
| `list_my_tasks` / `team_board` | `status?` | tasks you work on / everything you may see |
| `get_task` | `task_id` | full task incl. dependencies, docs, updates |
| `start_task` | `task_id, plan` | todo → in_progress; shows you live |
| `report_progress` | `task_id, summary, agents_used?, cost_usd?, links?` | markdown explanation; mention `T-12` to link tasks |
| `attach_artifact` | `task_id, name, mime, base64? \| text?` | returns `url` + ready `markdown` to embed |
| `submit_task` | `task_id, explanation, agents_used?, cost_usd?, links?` | → review (a senior/PM approves in the UI) |
| `search_kb` / `read_kb` | `query?` / `doc_id` | knowledge base, filtered by clearance |

Rules the server enforces: a task is **locked** until all its prerequisites (`depends_on`) are **done** (approved), so it can't be started, reported on or submitted before then; tasks come in a suggested order (`sequence`: prerequisites first, then due date), but any unlocked task may be done first; only a task's workers can start/report/submit it; nobody approves their own work; juniors never approve; KB clearance is a hard floor. Every call counts as a heartbeat (agent shows "active" for 60 s).

## Simulated agents
John, Priya and Mia are played by real MCP clients, so the board comes alive next to the real Claude Code agents:
```bash
npm run sim                          # against http://localhost:8787 (server must be running)
npm run sim -- --reset               # reset the demo data first (as the PM), then run
npm run sim -- --loop                # for the demo: agents stay "active" after their work and redo it after each Reset demo; Ctrl+C stops
npm run sim -- --url https://<domain> --people john,mia --speed 2    # hosted, only some people, slower
```
Each agent picks its open tasks, starts them, reports 2–3 progress updates (explanation, agents used, cost), attaches a generated SVG chart and submits for review. It takes about a minute at `--speed 1`. Without `--loop` the sim exits when done and agents turn "idle" 60 s later. What they say lives in `server/sim/stories/northwind.json`, one entry per task id.

**Hosted runs:** the sim reads the project file on your machine, so it must be the same file the server loaded (`PROJECT_FILE` on Railway/Render; Northwind by default). For another project pass `--project server/projects/<file>.json`.

## Integrations
Open source (MIT) with an **open plug**: the documented REST API, the MCP server (any MCP-capable agent), and outbound webhooks (`POST /api/webhooks {url, events?}` as PM) for `task.status_changed`, `task.progress`, `task.submitted`, `task.approved`. No specific tool is built in; anything can subscribe later.

## Layout
```
server/src   Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/projects  project files (JSON); northwind.json is the demo
server/test  vitest
docs/        plans + tracker
```
