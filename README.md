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
| Backend primary (Railway) | `https://orchestra-api-production-f275.up.railway.app`: API `/api`, agents `/mcp` |
| Backend standby (Render) | `https://orchestra-api-am50.onrender.com`: same paths, demo data |
| Frontend | Lovable |

Setup + failover: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Run
```bash
npm install
npm run dev     # local: API http://localhost:8787/api · MCP http://localhost:8787/mcp
npm start       # production-style (what Railway runs)
npm test
npm run check -- --url https://orchestra-api-production-f275.up.railway.app   # contract check: every API response vs docs/LOVABLE_PLAN.md §4, per role (GETs + logins only)
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

## Demo in one command
```bash
npm run demo          # Railway: reset the demo data (as the PM) + John, Priya and Mia work live, forever (Ctrl+C to stop)
npm run demo:backup   # same against the Render backup (wait ~1 min if it was asleep)
npm run demo:local    # same against http://localhost:8787 (run `npm run dev` first)
```
⚠️ `npm run demo` **resets the shared Railway data**. Tell the team before a rehearsal or video take.
Demo beat: Priya's agent submits **T-4** → approve it as Sara in the UI → **T-6/T-7 unlock** → the agents (or a real Claude Code agent) pick them up.

## Run demo button (Lumen startup)
The PM can start a full demo **from the UI** (or `POST /api/demo/run` with `{"project":"lumen"}`). The server resets the data to **Lumen: AI Support Assistant** (`server/projects/lumen.json`, accounts `@lumen.test`, password `demo1234`). The agents of **Priya, John, Omar and Hassan** then finish milestone M-2 (T-5 … T-14) in three waves. A human approves each wave in Review; that unlocks the next one. It takes about 2 minutes. `GET /api/demo/status` shows progress and what is waiting for approval; `POST /api/demo/stop` stops it. The PM's login survives the reset. Stories: `server/sim/stories/lumen.json`. Spec for the UI: `docs/LOVABLE_PLAN.md` section 12.

## Simulated agents
John, Priya and Mia are played by real MCP clients, so the board comes alive next to the real Claude Code agents:
```bash
npm run sim                          # against http://localhost:8787 (server must be running)
npm run sim -- --reset               # reset the demo data first (as the PM), then run
npm run sim -- --loop                # for the demo: agents stay "active" after their work and redo it after each Reset demo; Ctrl+C stops
npm run sim -- --url https://orchestra-api-am50.onrender.com --people john,mia --speed 2    # hosted, only some people, slower
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
