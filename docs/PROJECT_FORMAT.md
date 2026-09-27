# Project file format

A project (people, milestones, knowledge base, tasks, optional history) is one JSON file.
The bundled demo is [`server/projects/northwind.json`](../server/projects/northwind.json): copy it as a starting point.

```bash
npm run load -- path/to/my-project.json   # validate + replace all data with this project
npm run seed                              # reload the last loaded project (also: "Reset demo" in the UI)
```
The loader checks every reference and prints **all** problems at once (unknown person, missing milestone, bad date…). Nothing is written if the file is invalid.

## Shape
```jsonc
{
  "project":    { "id": "P-1", "name": "Northwind Launch", "description": "…" },

  "people": [   // at least one "pm"
    { "id": "john", "name": "John Carter", "role": "junior",          // pm | senior | junior
      "department": "Engineering", "title": "Backend Developer",
      "email": "john@northwind.test",   // optional, default <id>@example.test
      "password": "demo1234",           // optional, default demo1234
      "agent_key": "ak_john" }          // optional, default ak_<id>  (MCP: Authorization: Bearer ak_john)
  ],

  "milestones": [ { "id": "M-1", "name": "MVP ready", "due": "2026-10-03",
                    "signed_off": false } ],   // optional: true = already signed off by the PM (every task in it must be done)

  "docs": [     // knowledge base; min_role = who may read it (junior = everyone)
    { "id": "K-1", "title": "Launch brief", "body": "# markdown…", "min_role": "junior", "author": "layla" }
  ],

  "tasks": [
    { "id": "T-5",                      // must look like T-<number> (used for automatic mention links)
      "title": "Recommendation model v1",
      "milestone": "M-1",
      "due": "2026-10-02",              // optional, YYYY-MM-DD; overdue = past due and not done
      "status": "todo",                 // todo | in_progress | review | done (default todo)
      "departments": ["Engineering"],
      "workers": ["john"],              // who works on it (their agents can start/report/submit)
      "access": ["tom"],                // extra people who can view it
      "depends_on": ["T-3"],            // prerequisites: the task is LOCKED until these are done (approved); also sets the suggested order and the graph arrows. No loops.
      "docs": ["K-2"],                  // linked knowledge-base docs
      "parent": "T-4",                  // optional: makes it a subtask
      "description": "Serve results through the product API (T-4).",   // mentioning T-4 links the tasks
      "scope": "In: … Out: …" }
  ],

  // ---- optional: pre-filled history so the demo doesn't start empty ----
  "history": [
    { "task": "T-5", "user": "john", "kind": "progress",        // progress | completion | approval | status
      "summary": "Trained a baseline model with a **data agent**…",   // markdown
      "agents_used": ["data agent"], "cost_usd": 2.35,
      "links": [{ "label": "Notebook", "url": "https://…" }],
      "status_from": "in_progress", "status_to": "review",       // optional
      "via": "agent",                                             // agent | ui (default agent)
      "minutes_ago": 120 }
  ],
  "artifacts": [  // files attached to tasks; embed in a summary as ![name](/api/artifacts/<id>)
    { "id": "a1b2c3d4e5f60718", "task": "T-8", "user": "mia", "name": "chart.svg", "mime": "image/svg+xml", "text": "<svg…>" }
  ],
  "live_agents": [  // agents shown as working at load time (they go idle after 60 s unless an agent calls MCP)
    { "user": "john", "task": "T-5", "activity": "Tuning hyper-parameters" }
  ]
}
```

## Visibility reminder
- **PM** sees everything.
- **Senior** sees every task in their department.
- **Junior** sees their own tasks and those of junior coworkers in their department. They don't see tasks with a senior or PM worker.
- Anyone listed in `workers` or `access` always sees the task.
