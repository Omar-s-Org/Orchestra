# Testing with real agents (Claude Code over MCP)

For Hassan (and anyone checking that a *real* agent works our tools the way the simulator does).

## 0. Test the hosted app (no setup)
1. Open the **status page**: https://orchestra-api-production-f275.up.railway.app. Click **Self-test** first; every line should be ✓.
   - If one isn't, send Omar a screenshot of the page.
   - It resets the data and loads Northwind again at the end.
2. Open **the app**: https://orchestra-web-production.up.railway.app. The pill in the top bar should say **LIVE**. Pick an account on the login page (password `demo1234`).
   - **PM (`layla@…`):** Board, Activity, Knowledge, Review, Graph, and Company view (the toggle in the top bar).
   - **Senior (`sara@…` Engineering, `tom@…` Marketing/Growth):** Review lists the milestones they can approve (all tasks done, all in their department). Approving takes two clicks: *Approve milestone*, then *Confirm approval*.
   - **Junior (`john@…`, `priya@…`):** only your own and junior coworkers' tasks. Review and Graph aren't in the menu.
3. **The live demo:** on the status page, click **Run Lumen demo**.
   - In the app, log in as `sara@lumen.test`.
   - The 4 simulated agents (Priya, John, Omar, you) submit wave 1, and it shows up in **Review**. Approve it, and the next wave unlocks. After 3 waves the status page says "complete".
   - **Stop** ends it; **Load Northwind** brings back the static demo.
4. Send Omar feedback on anything broken, confusing or slow: a screenshot, the URL, and the account you used.

**Run it on your machine instead** (same checks, against local servers):
```bash
npm install && npm run dev          # terminal 1 (repo root): backend  http://localhost:8787 (status page at /)
npm run web:install && npm run web  # terminal 2 (repo root): frontend http://localhost:8080
npm run smoke                       # optional: the self-test against localhost
```

## 1. Start a server with the Lumen project
Test locally: Run demo would start the simulated Hassan too, and he'd take your tasks.
```bash
cd server
npm install
npm run load -- projects/lumen.json   # Lumen: AI Support Assistant, accounts @lumen.test / demo1234
npm run dev                           # http://localhost:8787
```
Open the UI against `http://localhost:8787` and log in as `sara@lumen.test` (senior, Engineering) to approve the milestone once all its tasks are done.

## 2. Connect Claude Code as Hassan's agent
```bash
claude mcp add --transport http orchestra http://localhost:8787/mcp \
  --header "Authorization: Bearer ak_hassan" --header "X-Agent-Name: Hassan's Claude"
```
Hassan's first unlocked task is **T-8 (CI pipeline)**. T-12 unlocks when T-8 is submitted (done), and T-13 when T-9–T-12 are.

## 3. The tools (v2, token-efficient)
The agent receives the workflow on connect (MCP server instructions), so a plain prompt is enough:
> Work your next Orchestra task.

The expected calls for one task:

| # | Call | What comes back |
|---|---|---|
| 1 | `next_task` | Brief: task, scope, prerequisites, docs inline, who you are |
| 2 | `start_task` | `{ok, id, status}` |
| 3 | `report_progress` ×1–2 | `{ok, id, status}` |
| 4 | `attach_artifact` (optional) | `url` + `markdown` |
| 5 | `submit_task` | `{ok, id, status:"done", next}` |

Extra detail is opt-in:
- `get_task` with `include` (history, artifacts, links, subtasks, all) and `history_limit`.
- `team_board` with filters.
- `read_kb` only for a doc marked `truncated`.

**What to check in the UI (as Sara):**
- Hassan's agent shows live on T-8, and its progress updates appear in the activity feed.
- T-8 lands in Done with the completion report, `agents_used`, cost and any artifact, and T-12 unlocks. Ask the agent to "continue"; it should pick up T-12 without extra calls.
- When every M-2 task is done, Sara (or the PM) gets a toast and approves the milestone in Review.
- Refusals are typed. Try "start T-13": the agent gets `Locked (409): …` and should stop, not retry.

## 4. Measure tokens: old vs new tools (A/B)
The token budget of our layer (no model needed):
```bash
npm run mcp:budget   # per-call tokens, definitions, calls for one task
```
To compare real agents, run the same prompt in headless mode against both versions and read the token usage and cost in the JSON output:
```bash
# new tools (this branch), server on :8787
claude -p "Work your next Orchestra task." --output-format json --allowedTools "mcp__orchestra__*" > new.json

# old tools: in another checkout at commit bfa57ff, load Lumen and run it with PORT=8788;
# re-add the MCP server pointing at :8788, then run the same prompt
claude -p "Work your next Orchestra task." --output-format json --allowedTools "mcp__orchestra__*" > old.json
```
Reset the data (`npm run load -- projects/lumen.json`) before each run so both start from the same state.

Record the results in the table below:
- Did the task reach Review with an explanation, `agents_used` and cost?
- The number of tool calls (from the activity feed, or `GET /api/audit` as the PM).
- The token and cost totals from the JSON output.

| Run | Task reached done | Required fields filled | Tool calls | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|---|
| old (bfa57ff) | | | | | | |
| new | | | | | | |

**Reference numbers from `npm run mcp:budget`** (one task; tokens ≈ chars/4):

| | Old tools | New tools |
|---|---|---|
| Tool definitions + instructions in context | ~1,390 | ~1,090 |
| Tool results for one task | ~4,450 in 9 calls | ~255 in 6 calls |
| Total MCP context after one task | ~5,840 | ~1,345 (−77%) |
