# Deploy (Railway)

The backend (REST + MCP) and its SQLite database run as **one Railway service** with a **volume** so data survives restarts. The frontend stays on Lovable.

## One-time setup (about 5 minutes)
1. [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo** → `omarjku/Orchestra`, branch `main`.
   Start command and health check come from `railway.json` (`npm start`, `/api/health`).
2. Service → **Variables**:
   - `DATABASE_PATH=/data/orchestra.sqlite`
   - `PROJECT_FILE=server/projects/northwind.json` (optional; which project an empty database starts with)
   - leave `PORT` unset (Railway sets it)
3. Service → **Volumes → New Volume**, mount path **`/data`**.
4. Service → **Settings → Networking → Generate Domain**, which gives e.g. `https://orchestra-production.up.railway.app`.
5. Check it:
   ```bash
   curl https://<domain>/api/health          # {"ok":true}
   ```
6. Share the URL. Frontend `apiBase` = `https://<domain>`. Agents use `https://<domain>/mcp`:
   ```bash
   claude mcp add --transport http orchestra https://<domain>/mcp --header "Authorization: Bearer ak_omar"
   ```

Every push to `main` redeploys automatically. The data on the volume is kept.

## Operating it
- **Reset demo data:** log in as the PM and use "Reset demo", or `POST /api/demo/reset` with the PM's session token.
- **Switch project:** commit the JSON to `server/projects/`, set `PROJECT_FILE` to it, then reset as the PM. It reloads the last loaded project or `PROJECT_FILE`.
- **Logs:** Railway → service → Deployments → View logs.

## Security (demo level)
- Demo passwords (`demo1234`) and agent keys (`ak_<id>`) are predictable. That's fine for synthetic data and a URL shared only with the team and judges.
- Set `AGENT_KEYS=random` for unguessable agent keys; people then copy theirs from **Connect your agent** in the UI. Hassan's simulator would then need to log in and call `GET /api/me/agent-key` for each persona.
- Reset is PM-only.
