# Live demo runbook: Hassan's real Claude Code agent → Omar's PM view

**What the audience sees:**
1. Hassan's own Claude Code agent works his task over MCP. He approves each tool call on camera, in the Loom recording.
2. The update lands on the central server.
3. Omar's PM view shows it live. Omar opens the finished task and reads the agent's explanation.
4. The simulated team finishes the rest of the milestone, and Omar approves the milestone.

## Once, before the day (Hassan)
Connect Claude Code to the hosted server as yourself:
```bash
claude mcp add --transport http orchestra https://orchestra-api-production-f275.up.railway.app/mcp \
  --header "Authorization: Bearer ak_hassan" --header "X-Agent-Name: Hassan's Claude Code"
```
Then check it: in Claude Code, run `/mcp`. `orchestra` should be connected with 9 tools (`next_task`, `start_task`, `report_progress`, …).

Leave Claude Code's permission prompts **on** for the take. Approving the MCP calls on camera is part of the story.

## Every take
1. **Omar:** open the status page (https://orchestra-api-production-f275.up.railway.app) and press **Self-test**. Every line should be ✓.
2. **Omar:** in the app (https://orchestra-web-production.up.railway.app), log in as `layla@lumen.test` (password `demo1234`).
   - The data must already be Lumen. If the login page lists `@northwind.test` accounts, press **Run demo** once first, or use **Load Northwind** / **Run Lumen demo** on the status page.
   - Click **Run demo**, tick **Hassan** under *Real agents*, and confirm. On the status page, tick Hassan and press Run Lumen demo.
   - The simulated Priya, John and Omar start working. **Hassan's tasks wait for his real agent.**
3. **Hassan (recording in Loom):** in Claude Code, type:
   > Work your next Orchestra task. Report your progress, then submit it with a clear explanation of what you did and how.

   The agent calls `next_task`, and gets **T-8 "CI pipeline & staging environment"** with its brief. It then calls `start_task`, `report_progress` and `submit_task`. **Approve each MCP call** when Claude Code asks.
4. **Omar (PM view):**
   - Hassan's agent shows as live in the *Live agents* rail, and T-8 moves In progress → Done.
   - Click the task: the drawer shows the agent's explanation, the sub-agents it used and its cost. There is no Approve button on a task: approval is per milestone.
   - The simulator now takes over Hassan's later tasks (T-12, T-13) and the team finishes M-2, about 2 minutes.
   - A toast says *"Beta: Lumen Assist v1 is ready for your approval"*. Open **Review**, click **Approve milestone**, then **Confirm approval**. The ✓ appears on M-2 in the top bar.
5. **Retake:** press **Stop**, then **Run demo** again, with Hassan ticked.

## If something goes wrong
| Symptom | Fix |
|---|---|
| `next_task` says no open task or everything is locked | The demo isn't running with Hassan ticked, or T-8 is already done. Stop, then Run demo again with Hassan ticked. |
| `401 Missing or invalid agent key` | Re-run the `claude mcp add` command above (key `ak_hassan`). |
| Hassan's T-8 was done by the simulator | Hassan wasn't ticked. Stop and run again with Hassan ticked. |
| PM view shows Northwind | Log out, then log in as `layla@lumen.test` after starting the run. |
| Railway is down | Use the backup: replace the host with `orchestra-api-rt0g.onrender.com`, both in `claude mcp add` and in the app's Settings → API URL. Wake it about a minute early. |

Note: agents never approve their own work, by design. Hassan approves the **MCP calls** in Claude Code; the PM approves the **milestone** in the app.
