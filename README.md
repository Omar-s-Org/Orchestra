# Orchestra

Project management where every team member works through their own AI agent. Agents report progress over **MCP**; the web app shows the project live, filtered by role: **PM** (whole project + relational graph) › **Senior** (their department, reviews, cost) › **Junior** (own + coworkers' tasks). Open source (MIT); anything that speaks REST, MCP or webhooks can plug in.

## Pitch
**The problem.** Teams already hand real work to AI agents: code, research, copy, charts. But project tools still expect a person to open a ticket and type a status update. What the agent did, how it did it and what it cost stays in a chat window nobody else sees. Managers can't see who is working on what, and there's no clear point where a human signs off on an agent's work.

**Orchestra.** Every person connects their own agent (Claude Code or any MCP client) with a personal key. The agent picks up its next unlocked task, starts it, and reports progress as it goes: what it did, which agents it used, what it cost and links to the results. It can attach files such as charts or images, then submits the work for review. The board updates live. Nobody types a status update.

**Why it's different**
- **One app for every role.** The PM sees the whole project as a live graph of tasks, dependencies and who is working together. A senior sees their department, the review queue and the costs. A junior sees their own tasks and their coworkers'. A single rule on the server decides who sees what, so the same screens work for everyone.
- **A human approves the work.** Agents can start, report and submit, but only a senior or the PM can approve, and nobody approves their own work. A task stays locked until everything it depends on has been approved, so approving one piece of work visibly unlocks the next.
- **You can see how the work was done.** Each update records how the work was done, which agents helped and what it cost, so cost adds up per person and per department with no budgeting tool.
- **Open.** MIT licensed, with a documented REST API, an MCP server and outbound webhooks. It works with whatever agent or tool a team already uses.

**The demo.** Simulated agents (John, Priya, Mia) are real MCP clients working a real project next to a live Claude Code agent. Priya's agent submits T-4, Sara approves it in the UI, and T-6/T-7 unlock and get picked up while the PM watches the graph change.

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

Tools are shaped to save the agent tokens: writes return a short acknowledgement, one call gives everything needed to start a task, and full detail is opt-in. One task costs about **1,350 tokens** of MCP context, where it used to cost about 5,840 (`npm run mcp:budget`). Results are compact JSON; empty fields are left out.

| Tool | Args | Returns |
|---|---|---|
| `next_task` | `task_id?` | **start here**: brief of your next unlocked task (or `task_id`): description, scope, prerequisites, docs inline, latest update; who you are; what's locked |
| `start_task` | `task_id, plan` | todo → in_progress, shows you live · `{ok, id, status}` |
| `report_progress` | `task_id, summary, agents_used?, cost_usd?, links?` | markdown, at most ~80 words; mention `T-12` to link tasks · `{ok, id, status}` |
| `attach_artifact` | `task_id, name, mime, base64? \| text?` | `url` + ready `markdown` to embed |
| `submit_task` | `task_id, explanation, agents_used?, cost_usd?, links?` | → review (a senior/PM approves in the UI) · `{ok, id, status, next}` |
| `get_task` | `task_id, include?, history_limit?` | any visible task; `include`: `history`, `artifacts`, `links`, `subtasks` or `all`; `include:["all"], history_limit:0` = the full REST detail |
| `team_board` | `status?, department?, person?, mine?` | one compact row per task you may see |
| `search_kb` / `read_kb` | `query?` / `doc_id` | knowledge base, filtered by clearance |

Errors start with their type: `Locked (409)` (prerequisites not approved yet), `Forbidden (403)`, `NotFound (404)`, `BadRequest (400)`. Testing with real agents: [docs/AGENT_TESTING.md](docs/AGENT_TESTING.md).

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
Open source (MIT) with an **open plug**: nothing is tied to one vendor, and there are three ways in.

| Way in | Who uses it | What it gives you |
|---|---|---|
| **MCP** (`/mcp`) | AI agents: Claude Code, or any MCP-capable client | Work tasks, report progress, attach files, submit for review ([tools](#connect-an-agent-mcp)) |
| **REST** (`/api`) | Web UIs, scripts, dashboards | Everything the UI uses: tasks, graph, activity, live agents, cost, KB. Shapes are in `docs/LOVABLE_PLAN.md` §4 |
| **Webhooks** | Chat bots, CRMs, CI, analytics | The server POSTs JSON to your URL when something happens |

**Webhooks.** Register one as the PM:
```bash
curl -X POST https://orchestra-api-production-f275.up.railway.app/api/webhooks \
  -H "Authorization: Bearer <PM session token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","events":["task.submitted","task.approved"]}'
```
Leave out `events` to get all of them. Each call is a `POST` with this body:
```json
{ "event": "task.submitted", "at": "2026-09-27T01:23:45.000Z", "data": { "task_id": "T-4", "by": "priya", "summary": "…" } }
```
| Event | When | `data` |
|---|---|---|
| `task.status_changed` | task started, or reopened by a reviewer | `task_id, from, to, by` |
| `task.progress` | an agent reports progress | `task_id, by, summary, cost_usd` |
| `task.submitted` | an agent submits for review | `task_id, by, summary` |
| `task.approved` | a senior/PM approves | `task_id, by` |

Delivery is fire-and-forget with a 5 s timeout. A slow or broken receiver never holds up an agent.

**Examples of what can plug in:** post to a Slack channel when work is ready for review, sync approved tasks to a CRM or issue tracker, kick off a CI deploy when a task is approved, or send agent costs to a finance sheet. None of these are built in. That's deliberate: the plug is the product, and teams connect what they already use.

## Layout
```
server/src   Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/projects  project files (JSON); northwind.json is the demo
server/test  vitest
docs/        plans + tracker
```
