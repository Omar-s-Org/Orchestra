# Company view update

## What will change
- Add a PM-only **Company view · for startups** switch to the top bar, with the exact privacy explanation from section 11.
- Keep the switch off by default in `localStorage.companyView`; turning it on adds **Company** to navigation and opens `/company`, while turning it off returns to the normal landing page.
- Add the guarded `/company` screen using only the existing tasks and overview calls, polling every five seconds.

## Company screen
- Show six compact KPIs: tasks, percent done, in progress, in review, overdue, and agent spend.
- Add Milestone, Department, and Person grouping modes.
- Render dense square task tiles with the revised red/orange/yellow/green status palette, plus locked, overdue, live, and subtask treatments.
- Keep a visible status legend and title tooltips for compact tiles.
- Add a privacy-safe task panel showing only status, dates, departments, dependencies, subtasks, workers, and viewers.
- Add a person panel showing role, department, spend, completed count, status counts, and in-progress work.
- Never show agent summaries, descriptions, updates, files, prompts, or reports in Company view.

## Access and consistency
- Show the switch and Company navigation only when the API provides `capabilities.graph`.
- Redirect anyone without that capability, or with the switch off, to `/board`.
- Derive mock Company data from the existing mock tasks, people, and overview; add no endpoint or fixture.
- Preserve existing Graph, Board, drawer, and role-based visibility behavior.

## Validation
- Check PM switch on/off navigation, all grouping modes, task-to-person panel flow, privacy exclusions, and compact desktop/mobile layouts.
- Confirm non-PM users never see the switch or Company navigation and cannot remain on `/company`.
