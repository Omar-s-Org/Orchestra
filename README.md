# Orchestra

Project management where every team member works through their own AI agent. Agents report progress over **MCP**; the web app shows the project live, filtered by role: **PM** (whole project + relational graph) › **Senior** (their department, reviews, cost) › **Junior** (own + coworkers' tasks). Open source (MIT); anything that speaks REST, MCP or webhooks can plug in.

## Docs (source of truth)
- [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md): the plan for everyone: model, permissions, backend, MCP tools, split of work
- [`docs/LOVABLE_PLAN.md`](docs/LOVABLE_PLAN.md): frontend spec + **API contract** (the backend must match it exactly)
- [`docs/Orchestra_Tracker.xlsx`](docs/Orchestra_Tracker.xlsx): who does what, and status

## Run
```bash
npm install
npm run dev     # API http://localhost:8787/api · MCP http://localhost:8787/mcp
npm test
```

## Status
`server/` still implements the earlier 4-role model. It is being rewritten to `MVP_PLAN.md` / `LOVABLE_PLAN.md` (3 layers, login, agent reports, graph). Until then the frontend runs on its built-in mock mode.

## Layout
```
server/src   Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/test  vitest
docs/        plans + tracker
```
