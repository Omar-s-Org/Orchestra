# Backlog: agreed for later

Decided with Omar; not built yet. Keep the "approve only" behaviour until these land.

## 1. Send a milestone back
The approver (PM, or the department's senior) can reject a ready milestone instead of approving it: pick the tasks that need rework, add a note, and those tasks reopen (`done` → `in_progress`) for their owners' agents. Needs a `milestone.sent_back` webhook and a "Send back" button next to *Approve milestone* in Review.

## 2. Change tasks and project structure after creation
Today the project comes from a JSON file (`docs/PROJECT_FORMAT.md`) and is fixed once loaded. The PM (and later seniors, in their department) should be able to add, edit, move and delete tasks, milestones and dependencies in the running project. Pitch: Orchestra is an open-source tool where you program the project structure yourself, so this should work the same through the UI, the REST API and a project file (export → edit → re-import without losing history).

## 3. Cork board over MCP
Once the cork board exists (web + REST), give agents `pin_note` / `read_board` MCP tools so they can pin findings and read what the team pinned.
