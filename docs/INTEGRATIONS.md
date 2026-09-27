# Integrations

Orchestra is open source (MIT) with an **open plug**: nothing is tied to one vendor, and there are three ways in.

| Way in | Who uses it | What it gives you |
|---|---|---|
| [**MCP**](#mcp-for-ai-agents) (`/mcp`) | AI agents: Claude Code, or any MCP-capable client | Work tasks, report progress, attach files, submit |
| [**REST**](#rest-api) (`/api`) | Web UIs, scripts, dashboards | Everything the UI uses: tasks, graph, activity, live agents, cost, KB |
| [**Webhooks**](#webhooks) | Chat bots, CRMs, CI, analytics | The server POSTs JSON to your URL when something happens |

## MCP (for AI agents)
Each person connects their own agent with their personal key. The agent acts with exactly that person's permissions.

```bash
claude mcp add --transport http orchestra https://orchestra-api-production-f275.up.railway.app/mcp \
  --header "Authorization: Bearer ak_<your id>" --header "X-Agent-Name: <Your name>'s Claude Code"
```
`X-Agent-Name` (optional) sets the name shown in the live view. For a local server use `http://localhost:8787/mcp`.

**Human check in the terminal.** Claude Code asks before every Orchestra tool call and shows what the agent is about to send (its plan, progress note or completion report). The developer reads it and approves or rejects it. Keep these prompts on: don't choose "don't ask again" for `start_task`, `report_progress`, `attach_artifact` or `submit_task`.

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

Errors start with their type: `Locked (409)` (prerequisites not done yet), `Forbidden (403)`, `NotFound (404)`, `BadRequest (400)`.

**Rules the server enforces:**
- A task is **locked** until all its prerequisites (`depends_on`) are **done**, so it can't be started, reported on or submitted before then.
- Tasks come in a suggested order (`sequence`: prerequisites first, then due date), but any unlocked task may be done first.
- Only a task's workers can start, report on or submit it.
- Approval is per milestone, never per task: the PM approves any milestone, a senior only one whose tasks are all in their department, juniors and agents never.
- KB clearance is a hard floor.
- Every call counts as a heartbeat: an agent shows "active" for 60 s after a call, or for up to 15 min while it has a started task, so agents never need to call just to look alive.

Testing with real agents: [AGENT_TESTING.md](AGENT_TESTING.md).

## REST API
Everything the web app uses, under `/api`, with a session token from `POST /api/auth/login`. The exact request and response shapes are in [LOVABLE_PLAN.md](LOVABLE_PLAN.md) §4, and `npm run check` verifies a running server against them.

## Webhooks
Register one as the PM:
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
