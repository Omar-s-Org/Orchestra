# Orchestra

Project management where every team member works through their own AI agent. Agents report progress over **MCP**; the web app shows the project live, filtered by role: **PM** (whole project + relational graph) › **Senior** (their department, milestone approvals, cost) › **Junior** (own + coworkers' tasks). Open source (MIT); anything that speaks REST, MCP or webhooks can plug in.

## Try it (no setup)
| | URL |
|---|---|
| **The app** | https://orchestra-web-production.up.railway.app: pick a demo account on the login page (password `demo1234`) |
| **Backend status + test controls** | https://orchestra-api-production-f275.up.railway.app: **Load Northwind** · **Run Lumen demo** · **Stop** · **Self-test** |
| Backup backend (use it for self-tests during a live demo) | https://orchestra-api-rt0g.onrender.com (sleeps when idle; the first load takes ~1 min) |

- **Browse:** Northwind is loaded by default. Log in as `layla@northwind.test` (PM), `sara@…` (senior) or `john@…` (junior).
- **Live demo:** on the status page, click **Run Lumen demo**. In the app, log in as `layla@lumen.test` or `sara@lumen.test`. Priya, John, Omar and Hassan's agents work through milestone M-2 on their own; when it is done, approve the milestone in **Review**.
- **Live demo with a real agent:** tick **Hassan** under *Real agents* when you start the demo. The simulator then leaves his tasks to his own Claude Code. See [docs/LIVE_DEMO.md](docs/LIVE_DEMO.md).
- **Is it working?** Click **Self-test** on the status page (or run `npm run smoke -- --url <backend>`). In about 10 s it checks:
  - health and every endpoint the UI uses, per role
  - that the MCP tools are the v2 set
  - the whole 4-agent demo, then the milestone approval, including that a junior can't approve

  It then loads Northwind again. It **resets the data**, so run it on the backup during a live demo.
## Pitch
**The problem.** Teams already hand real work to AI agents: code, research, copy, charts. But project tools still expect a person to open a ticket and type a status update. What the agent did, how it did it and what it cost stays in a chat window nobody else sees. Managers can't see who is working on what, and there's no clear point where a human signs off on an agent's work.

**Orchestra.** Every person connects their own agent (Claude Code or any MCP client) with a personal key. The agent picks up its next unlocked task, starts it, and reports progress as it goes: what it did, which agents it used, what it cost and links to the results. It can attach files such as charts or images, then submits the work, which completes the task. The board updates live. Nobody types a status update.

**Why it's different**
- **One app for every role.** The PM sees the whole project as a live graph of tasks, dependencies and who is working together. A senior sees their department, the milestones they can approve and the costs. A junior sees their own tasks and their coworkers'. A single rule on the server decides who sees what, so the same screens work for everyone.
- **A human approves each milestone.** Agents start, report and submit tasks; a submitted task is done and unlocks the tasks that depend on it, so work keeps flowing. When every task in a milestone is done, the PM and the senior of that department are notified and approve the milestone. Agents and juniors never approve.
- **You can see how the work was done.** Each update records how the work was done, which agents helped and what it cost, so cost adds up per person and per department with no budgeting tool.
- **Open.** MIT licensed, with a documented REST API, an MCP server and outbound webhooks. It works with whatever agent or tool a team already uses.

**The demo.** Simulated agents (John, Priya, Mia) are real MCP clients working a real project next to a live Claude Code agent. Priya's agent submits T-4, T-6/T-7 unlock and get picked up while the PM watches the graph change, and Sara approves the milestone in the UI once it is done.

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
| Backend standby (Render) | `https://orchestra-api-rt0g.onrender.com`: same paths, demo data |
| Frontend (Railway, from `web/`) | `https://orchestra-web-production.up.railway.app` |

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

## Frontend (`web/`)
The web app Saad builds in Lovable (TanStack Start + React; source: [px404/orchestra-live](https://github.com/px404/orchestra-live)) lives in `web/`. It is a separate app and not an npm workspace, so the backend install and the Railway/Render deploys don't change.

Run the full stack locally in two terminals:
```bash
npm run dev            # terminal 1: backend  → http://localhost:8787
npm run web:install    # once
npm run web            # terminal 2: frontend → http://localhost:8080 (talks to localhost:8787)
```
- In dev, the frontend uses `http://localhost:8787` (`web/.env.development`). A production build uses Railway. Set `VITE_API_BASE` to point it anywhere else.
- The login page lists the accounts of whichever project the backend has loaded (`GET /api/demo/accounts`), so it follows **Run demo** (Lumen) automatically.
- The top-bar pill says **LIVE** when the backend is reachable. With mock mode `auto` or `on` (Settings), it falls back to built-in mock data.

**Keeping `web/` in sync with Lovable:** Saad keeps working in Lovable on `px404/orchestra-live`. `web/` is a copy of commit `939bbe3` plus these integration changes (each small, so Saad can apply them upstream too):
- `web/src/lib/config.ts`: the API base can be overridden with `VITE_API_BASE`.
- `web/.env.development`: local dev points at `http://localhost:8787`.
- `web/src/lib/api.ts` + `web/src/lib/types.ts`: `api.demoAccounts()` for `GET /api/demo/accounts`.
- `web/src/routes/login.tsx`: the demo-account list comes from the backend when live (the mock list is the fallback).

To take a newer Lovable version, copy `px404/orchestra-live` over `web/` and re-apply the four changes above (or ask Saad to merge them upstream first).

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
| `submit_task` | `task_id, explanation, agents_used?, cost_usd?, links?` | → done; dependents unlock; a senior/PM approves the whole milestone later · `{ok, id, status, next}` |
| `get_task` | `task_id, include?, history_limit?` | any visible task; `include`: `history`, `artifacts`, `links`, `subtasks` or `all`; `include:["all"], history_limit:0` = the full REST detail |
| `team_board` | `status?, department?, person?, mine?` | one compact row per task you may see |
| `search_kb` / `read_kb` | `query?` / `doc_id` | knowledge base, filtered by clearance |

Errors start with their type: `Locked (409)` (prerequisites not done yet), `Forbidden (403)`, `NotFound (404)`, `BadRequest (400)`. Testing with real agents: [docs/AGENT_TESTING.md](docs/AGENT_TESTING.md).

Rules the server enforces: a task is **locked** until all its prerequisites (`depends_on`) are **done**, so it can't be started, reported on or submitted before then; tasks come in a suggested order (`sequence`: prerequisites first, then due date), but any unlocked task may be done first; only a task's workers can start/report/submit it; approval is per milestone, never per task: the PM approves any milestone, a senior only one whose tasks are all in their department, juniors and agents never; KB clearance is a hard floor. Every call counts as a heartbeat: an agent shows "active" for 60 s after a call, or for up to 15 min while it has a started task, so agents never need to call just to look alive.

## Demo in one command
```bash
npm run demo          # Railway: reset the demo data (as the PM) + John, Priya and Mia work live, forever (Ctrl+C to stop)
npm run demo:backup   # same against the Render backup (wait ~1 min if it was asleep)
npm run demo:local    # same against http://localhost:8787 (run `npm run dev` first)
```
⚠️ `npm run demo` **resets the shared Railway data**. Tell the team before a rehearsal or video take.
Demo beat: Priya's agent submits **T-4** → **T-6/T-7 unlock** → the agents (or a real Claude Code agent) pick them up → when the milestone is done, Sara approves it in Review.

## Run demo button (Lumen startup)
The PM can start a full demo **from the UI** (or `POST /api/demo/run` with `{"project":"lumen"}`). The server resets the data to **Lumen: AI Support Assistant** (`server/projects/lumen.json`, accounts `@lumen.test`, password `demo1234`). The agents of **Priya, John, Omar and Hassan** then finish milestone M-2 (T-5 … T-14) on their own; then the PM or Sara approves the milestone in Review. It takes about 2 minutes. `GET /api/demo/status` shows progress and the milestones waiting for approval; `POST /api/demo/stop` stops it. The PM's login survives the reset. Stories: `server/sim/stories/lumen.json`. Spec for the UI: `docs/LOVABLE_PLAN.md` section 12.

## Simulated agents
John, Priya and Mia are played by real MCP clients, so the board comes alive next to the real Claude Code agents:
```bash
npm run sim                          # against http://localhost:8787 (server must be running)
npm run sim -- --reset               # reset the demo data first (as the PM), then run
npm run sim -- --loop                # for the demo: agents stay "active" after their work and redo it after each Reset demo; Ctrl+C stops
npm run sim -- --url https://orchestra-api-rt0g.onrender.com --people john,mia --speed 2    # hosted, only some people, slower
```
Each agent picks its open tasks, starts them, reports 2–3 progress updates (explanation, agents used, cost), attaches a generated SVG chart and submits it. It takes about a minute at `--speed 1`. Without `--loop` the sim exits when done and agents turn "idle" 60 s later. What they say lives in `server/sim/stories/northwind.json`, one entry per task id.

**Hosted runs:** the sim reads the project file on your machine, so it must be the same file the server loaded (`PROJECT_FILE` on Railway/Render; Northwind by default). For another project pass `--project server/projects/<file>.json`.

## Integrations
Open source (MIT) with an **open plug**: nothing is tied to one vendor, and there are three ways in.

| Way in | Who uses it | What it gives you |
|---|---|---|
| **MCP** (`/mcp`) | AI agents: Claude Code, or any MCP-capable client | Work tasks, report progress, attach files, submit ([tools](#connect-an-agent-mcp)) |
| **REST** (`/api`) | Web UIs, scripts, dashboards | Everything the UI uses: tasks, graph, activity, live agents, cost, KB. Shapes are in `docs/LOVABLE_PLAN.md` §4 |
| **Webhooks** | Chat bots, CRMs, CI, analytics | The server POSTs JSON to your URL when something happens |

**Webhooks.** Register one as the PM:
```bash
curl -X POST https://orchestra-api-production-f275.up.railway.app/api/webhooks \
  -H "Authorization: Bearer <PM session token>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","events":["task.submitted","milestone.ready"]}'
```
Leave out `events` to get all of them. Each call is a `POST` with this body:
```json
{ "event": "task.submitted", "at": "2026-09-27T01:23:45.000Z", "data": { "task_id": "T-4", "by": "priya", "summary": "…" } }
```
| Event | When | `data` |
|---|---|---|
| `task.status_changed` | task started | `task_id, from, to, by` |
| `task.progress` | an agent reports progress | `task_id, by, summary, cost_usd` |
| `task.submitted` | an agent submits a task (it is now done) | `task_id, by, summary` |
| `milestone.ready` | the last task of a milestone is done | `milestone_id, name, completed_by_task` |
| `milestone.approved` | the PM or a senior approves a milestone | `milestone_id, by, note` |

Delivery is fire-and-forget with a 5 s timeout. A slow or broken receiver never holds up an agent.

**Examples of what can plug in:** post to a Slack channel when a milestone is ready for approval, sync finished tasks to a CRM or issue tracker, kick off a release when a milestone is approved, or send agent costs to a finance sheet. None of these are built in. That's deliberate: the plug is the product, and teams connect what they already use.

## Layout
```
server/src   Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/projects  project files (JSON); northwind.json is the demo
server/test  vitest
docs/        plans + tracker
```
