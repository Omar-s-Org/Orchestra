# Development guide

Everything you need to run, test and demo Orchestra on your own machine. For the product overview, see the [README](../README.md).

- [Run locally](#run-locally)
- [Frontend (`web/`)](#frontend-web)
- [Demo accounts and projects](#demo-accounts-and-projects)
- [Simulated agents](#simulated-agents)
- [Run demo (Lumen startup)](#run-demo-lumen-startup)
- [Testing](#testing)

## Run locally
Requires **Node.js 22+**.

```bash
npm install
npm run dev     # API http://localhost:8787/api · MCP http://localhost:8787/mcp · status page http://localhost:8787
npm start       # production-style (what Railway runs)
```

> On Windows, if the `better-sqlite3` build fails during install, use `npm install --ignore-scripts`.

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

## Demo accounts and projects
Password for all: `demo1234`. Agent key (for MCP): `ak_<id>`, e.g. `ak_hassan`.

| Email | Role | Department |
|---|---|---|
| layla@northwind.test | PM | Management |
| sara@northwind.test / tom@northwind.test | Senior | Engineering / Marketing |
| john@ · priya@ · omar@ · hassan@northwind.test | Junior | Engineering |
| mia@northwind.test | Junior | Marketing |

The Lumen project uses the same people with `@lumen.test` addresses (Tom's department is Growth there).

| Command | Effect |
|---|---|
| `npm run seed` (or **Reset demo** as the PM / `POST /api/demo/reset`) | reload the current project |
| `npm run load -- my-project.json` | load another project ([format](PROJECT_FORMAT.md)) |

Projects live in `server/projects/`: `northwind.json` (the static demo) and `lumen.json` (the live demo).

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

**Demo in one command:**
```bash
npm run demo          # Railway: reset the demo data (as the PM) + John, Priya and Mia work live, forever (Ctrl+C to stop)
npm run demo:backup   # same against the Render backup (wait ~1 min if it was asleep)
npm run demo:local    # same against http://localhost:8787 (run `npm run dev` first)
```
⚠️ `npm run demo` **resets the shared Railway data**. Tell the team before a rehearsal or video take.

Demo beat: Priya's agent submits **T-4** → **T-6/T-7 unlock** → the agents (or a real Claude Code agent) pick them up → when the milestone is done, Sara approves it in Review.

## Run demo (Lumen startup)
The PM can start a full demo **from the UI** (or `POST /api/demo/run` with `{"project":"lumen"}`). The server resets the data to **Lumen: AI Support Assistant** (`server/projects/lumen.json`, accounts `@lumen.test`, password `demo1234`). The agents of **Priya, John, Omar and Hassan** then finish milestone M-2 (T-5 … T-14) on their own; then the PM or Sara approves the milestone in Review. It takes about 2 minutes.

- `GET /api/demo/status` shows progress and the milestones waiting for approval; `POST /api/demo/stop` stops it.
- The PM's login survives the reset.
- Tick a person under **Real agents** to leave their tasks to their own Claude Code. Runbook: [LIVE_DEMO.md](LIVE_DEMO.md).
- Stories: `server/sim/stories/lumen.json`. Spec for the UI: [LOVABLE_PLAN.md](LOVABLE_PLAN.md) section 12.

## Testing
| Command | What it checks |
|---|---|
| `npm test` | Unit and integration tests (vitest): permissions, locking, MCP tools, simulator, demo runner |
| `npm run check -- --url <backend>` | Contract check: every API response against [LOVABLE_PLAN.md](LOVABLE_PLAN.md) §4, per role. Read-only (GETs and logins), safe on the hosted demo |
| `npm run smoke -- --url <backend>` | The status page's **Self-test**: the whole demo end to end. **Resets the data** |
| `npm run mcp:budget` | Token cost of the MCP tools for one task, no model needed |

Testing with a real agent (Claude Code): [AGENT_TESTING.md](AGENT_TESTING.md).
