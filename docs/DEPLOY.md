# Deploy: Railway (primary) + Render (standby)

The backend (REST + MCP + SQLite) runs as a single Node service. We run **two independent copies**:

| Role | Host | URL | Data |
|---|---|---|---|
| **Primary** | Railway + volume at `/data` | `https://orchestra-api-production-f275.up.railway.app` | persistent |
| **Standby** | Render (free) | `https://orchestra-api-am50.onrender.com` | demo data, re-seeded on every restart; sleeps after ~15 min idle (~1 min to wake) |

The two databases are **not synced**. The standby is for failover during the demo: it serves the same seeded Northwind project.

## Primary: Railway
1. New Project → Deploy from GitHub repo → `omarjku/Orchestra` (`main`). `railway.json` sets `npm start` and the `/api/health` health check.
2. Variables: `DATABASE_PATH=/data/orchestra.sqlite` (optional `PROJECT_FILE=server/projects/<file>.json`). Don't set `PORT`.
3. Volumes → New Volume → mount path `/data`.
4. Networking → Generate Domain. Check with `curl https://<domain>/api/health`, which returns `{"ok":true}`.

## Standby: Render
New → **Blueprint** → repo `omarjku/Orchestra` → it reads `render.yaml` (web service `orchestra-api`, free plan, build `npm ci`, start `npm start`, health `/api/health`). To make it persistent/always-on instead: plan `starter` + a disk mounted at e.g. `/var/data` with `DATABASE_PATH=/var/data/orchestra.sqlite`.

## Failover
- **Frontend:** `apiBases = [primary, standby]`. In auto mode the app health-checks every 10 s and switches to the next healthy base. Sessions are per server, so after a switch the user logs in again.
- **Agents** (Claude Code / Hassan's simulator): re-point to the standby:
  ```bash
  claude mcp remove orchestra
  claude mcp add --transport http orchestra https://orchestra-api-am50.onrender.com/mcp --header "Authorization: Bearer ak_omar"
  ```

## Verify a deploy
`npm run check -- --url https://orchestra-api-production-f275.up.railway.app` (or the Render URL) runs about 40 read-only checks (all endpoints, every role, the permission rules) against the frontend contract and exits non-zero on any mismatch.

## Operating
- Every push to `main` redeploys both.
- **Reset demo:** log in as the PM → "Reset demo" (`POST /api/demo/reset`).
- **Other project:** commit JSON to `server/projects/`, set `PROJECT_FILE`, then reset.

## Last resort: the laptop
`npm run dev` plus any tunnel (e.g. `npx cloudflared tunnel --url http://localhost:8787`) prints a public URL to use as the API base.

## Security (demo level)
Passwords (`demo1234`) and agent keys (`ak_<id>`) are predictable. That's acceptable for synthetic data shared only with the team and judges. `AGENT_KEYS=random` makes the keys unguessable; people then copy theirs from "Connect your agent". Reset is PM-only.
