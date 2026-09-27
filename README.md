<p align="center">
  <img src="docs/assets/logo.svg" alt="Orchestra logo" width="72" height="72">
</p>

<h1 align="center">Orchestra</h1>

<p align="center">
  <strong>Your team's AI agents, working in the open.</strong><br/>
  Project management where every person works through their own AI agent, and humans check the work.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f6fed?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/status-hackathon%20prototype-f59f00?style=flat-square" alt="status">
  <img src="https://img.shields.io/badge/agents-MCP-7048e8?style=flat-square" alt="MCP">
  <img src="https://img.shields.io/badge/node-22%2B-2b8a3e?style=flat-square" alt="Node 22+">
  <a href="https://orchestra-web-production.up.railway.app"><img src="https://img.shields.io/badge/live%20demo-open%20the%20app-2f6fed?style=flat-square" alt="live demo"></a>
</p>

<p align="center">
  <img src="docs/assets/graph.png" alt="Orchestra: the PM's live project graph with milestones, tasks, dependencies and agents at work" width="880">
</p>
<p align="center"><sub>The PM's live project graph: milestones, tasks, dependencies and people. Green rings are agents working right now.</sub></p>

> **🧑‍💻 Humans stay in charge.** Agents do the work, but a person checks it twice: the developer approves each
> agent update in Claude Code before it reaches the board, and the PM or senior approves each finished milestone
> in the app. Agents and juniors can never approve.

---

## What it is

Teams already hand real work to AI agents: code, research, copy, charts. But project tools still expect a person to open a ticket and type a status update. What the agent did, how it did it and what it cost stays in a chat window nobody else sees. Managers can't see who is working on what, and there's no clear point where a human signs off on the agent's work.

**Orchestra** is a shared workspace for that. Every person connects their own agent (Claude Code or any MCP client) with a personal key. The agent picks up its next unlocked task, reports progress as it goes, attaches its results and submits the task. The board updates live, and nobody types a status update.

- 🤖 **Agents report their own work.** What they did, how, which sub-agents they used, what it cost, and the files they produced.
- 🧑‍💻 **The developer checks every update.** Claude Code shows the agent's summary before each Orchestra update; the developer approves it or sends it back.
- ✅ **Humans sign off milestones.** When every task in a milestone is done, the PM and the department's senior are notified and approve it in the app.
- 🔒 **Order is enforced.** A task stays locked until everything it depends on is done, so finishing one piece of work visibly unlocks the next.
- 👀 **One app, three views.** The PM sees the whole project as a live graph; a senior sees their department, costs and approvals; a junior sees their own and their coworkers' tasks. One server rule decides who sees what.
- 💸 **Cost without a budgeting tool.** Agents report what each step cost, so spend adds up per person and per department.
- 🔌 **Open.** MIT licensed, with an MCP server, a REST API and outbound webhooks. Works with whatever agent or tool a team already uses.

---

## How it works

### The architecture

Read it top to bottom: who uses Orchestra, how they get in, what the server decides, and what comes out. On GitHub, use the diagram's controls to zoom, pan or open it full screen.

```mermaid
flowchart TB
    subgraph WHO["① Who"]
        direction LR
        DEV["👩‍💻 Developer<br/>+ Claude Code or any MCP client"]
        HUM["🧑‍💼 PM · Senior · Junior<br/>in the web app"]
        SIM["🎭 Simulated agents<br/>scripted MCP clients"]
    end

    subgraph IN["② Ways in"]
        direction LR
        MCP["MCP · /mcp<br/>9 agent tools<br/>personal key ak_…"]
        REST["REST · /api<br/>email + password login"]
    end

    subgraph CORE["③ Orchestra server · every rule lives here"]
        direction TB
        PERM["🔐 Permission engine<br/>who can see and change what"]
        LOCK["🔒 Ordering<br/>a task is locked until its prerequisites are done"]
        SVC["⚙️ Task service<br/>start · progress · artifacts · submit · approve"]
        AUD["📝 Audit log<br/>refused attempts are recorded"]
        DB[("🗄️ SQLite")]
        PERM --> LOCK --> SVC --> DB
        PERM -. "403 / 409" .-> AUD
    end

    subgraph OUT["④ What comes out"]
        direction LR
        LIVE["📋 Live board · project graph<br/>activity · cost per person"]
        HOOK["📡 Webhooks<br/>Slack · CRM · CI · finance"]
    end

    DEV --> MCP
    SIM --> MCP
    HUM --> REST
    MCP --> PERM
    REST --> PERM
    SVC --> LIVE
    SVC --> HOOK
    LIVE -. "polls every 2–5 s" .-> HUM

    style CORE fill:#eef3ff,stroke:#2f6fed,color:#1a1a1a
    style PERM fill:#2f6fed,stroke:#1c4fbf,color:#ffffff
    style LOCK fill:#2f6fed,stroke:#1c4fbf,color:#ffffff
    style SVC fill:#2f6fed,stroke:#1c4fbf,color:#ffffff
    style AUD fill:#fff4e6,stroke:#f59f00,color:#1a1a1a
```

### The life of one task

Every call an agent makes, in order. The developer sees each write before it's sent, and the server checks every call against the same rules.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 👩‍💻 Developer
    participant Agent as 🤖 Claude Code
    participant Srv as ⚙️ Orchestra server
    participant App as 📋 Web app + webhooks
    actor Lead as 🧑‍💼 PM / Senior

    Dev->>Agent: "Work your next Orchestra task"
    Agent->>Srv: next_task
    Srv-->>Agent: brief, scope and docs of the first unlocked task
    Note over Agent,Srv: A locked task is refused with Locked (409)

    Agent->>Dev: Allow start_task?
    Dev-->>Agent: Yes
    Agent->>Srv: start_task (one-line plan)
    Srv->>App: task.status_changed · agent shows as working

    loop While working
        Agent->>Dev: Allow report_progress?
        Dev-->>Agent: Yes, or No with a note
        Agent->>Srv: report_progress (what, how, cost)
        Srv->>App: task.progress · cost adds up
    end

    Agent->>Srv: attach_artifact (charts, files)
    Agent->>Dev: Allow submit_task?
    Dev-->>Agent: Yes
    Agent->>Srv: submit_task (completion report)
    Srv->>App: task.submitted · task is done
    Srv-->>Agent: dependent tasks unlock · here is your next one

    opt Last open task in the milestone
        Srv->>App: milestone.ready
        App->>Lead: Milestone waiting in Review
        Lead->>Srv: approve milestone
        Srv->>App: milestone.approved ✅
    end
```

### Step by step

Click a step to open it.

<details>
<summary><b>1 · Pick up work:</b> <code>next_task</code></summary>

<br/>

The agent asks for its next task and gets everything it needs to start in one call: the description, the scope and the knowledge-base docs inline. Tasks come in dependency order. If all of the person's open tasks are waiting on others, the server says which tasks they're waiting on instead of handing out work that can't start yet.

</details>

<details>
<summary><b>2 · Start:</b> <code>start_task</code></summary>

<br/>

The agent sends a one-line plan. The server checks two things first: that this person is one of the task's workers (otherwise `Forbidden (403)`), and that every prerequisite is done (otherwise `Locked (409)`). Refusals are written to the audit log. On success the task moves to **In progress**, the agent appears live on the board and graph, and `task.status_changed` fires.

</details>

<details>
<summary><b>3 · Report progress:</b> <code>report_progress</code></summary>

<br/>

One or two short updates while the agent works: what it did, which sub-agents or tools it used, and what it cost. Each update goes to the activity feed and adds to the cost for that person and department. Mentioning another task, like `T-12`, links the two tasks. `task.progress` fires.

</details>

<details>
<summary><b>4 · Attach results:</b> <code>attach_artifact</code></summary>

<br/>

Charts, documents or code, up to 5 MB each. The server returns a markdown link, and the agent puts it in its report so the file shows up in the activity feed.

</details>

<details>
<summary><b>5 · Submit:</b> <code>submit_task</code></summary>

<br/>

The agent explains what it did, how, and what it cost. The server requires a real explanation, not just "done". Submitting completes the task, so **tasks that depend on it unlock right away**, and the response tells the agent what to work on next. `task.submitted` fires.

</details>

<details>
<summary><b>6 · Sign off the milestone:</b> the <b>Review</b> page</summary>

<br/>

When the last task in a milestone is done, `milestone.ready` fires and the milestone appears in **Review**. The PM can approve any milestone. A senior can approve one if all its tasks are in their department and none of them are their own. Agents and juniors never approve. Approving fires `milestone.approved`.

</details>

<details>
<summary><b>Why it's built this way</b></summary>

<br/>

- **The server decides everything.** Who can see a task, who can change it, what's locked and who can approve are all decided in one place. The web app, the agents and the webhooks can't disagree, and a misbehaving client can't skip a rule.
- **The developer reviews each update; managers approve milestones.** Checking every single task would slow the team down. Claude Code's permission prompt already puts a human in front of each update, so the PM and seniors sign off whole milestones instead.
- **Submitting unlocks the next task right away.** Work keeps moving without waiting for anyone, and the milestone sign-off stays the point where humans check the result.
- **The agent tools are kept small.** Writes return a short acknowledgement, and `next_task` returns the whole brief at once. One task costs an agent about 1,350 tokens of context instead of about 5,840.
- **It's open by default.** MCP for agents, REST for apps, and webhooks for everything else, so a team can keep the tools it already uses.

</details>

---

## See it

<p align="center">
  <img src="docs/assets/board.png" alt="Board: tasks by status, locked tasks waiting on prerequisites, and agent cost per person" width="880">
</p>
<p align="center"><sub><b>Board.</b> Every task by status, locked tasks showing what they wait on ("Waiting on T-5"), and what each person's agent has cost so far.</sub></p>

<table>
  <tr>
    <td width="52%" valign="top"><img src="docs/assets/activity.png" alt="Activity feed: agents' completion reports with charts, sub-agents used and cost"><br/><sub><b>Activity.</b> Each agent explains what it did and how: the sub-agents it used, what it cost, and the charts or files it produced.</sub></td>
    <td width="48%" valign="top">

**Developer check, in the terminal.** Before any update reaches the board, Claude Code shows the developer what the agent is about to send:

```text
Tool use
  orchestra - submit_task (MCP)
  task_id: "T-8"
  explanation: "CI and staging are live.
    Every push: lint, typecheck, tests.
    Staging auto-deploys from main…"

Do you want to proceed?
❯ 1. Yes
  2. Yes, and don't ask again
  3. No, and tell Claude what to do differently
```

**Yes** sends it; **No** sends the agent back with a note. When a whole milestone is done, the PM or senior approves it in **Review**.

</td>
  </tr>
</table>

---

## Try it (no setup)

| | Link |
|---|---|
| **The app** | **https://orchestra-web-production.up.railway.app**: pick a demo account on the login page, password `demo1234` |
| **Status page + demo controls** | https://orchestra-api-production-f275.up.railway.app: **Load Northwind** · **Run Lumen demo** · **Stop** · **Self-test** |
| Backup backend | https://orchestra-api-rt0g.onrender.com (sleeps when idle; the first load takes about a minute) |

- **Browse a project:** Northwind is loaded by default. Log in as `layla@northwind.test` (PM), `sara@northwind.test` (senior) or `john@northwind.test` (junior) and compare what each one sees.
- **Watch agents work:** on the status page, click **Run Lumen demo**, then log in as `layla@lumen.test`. Four agents finish milestone M-2 in about 2 minutes; then approve the milestone in **Review**.
- **Bring your own agent:** tick a person under **Real agents** when you start the demo, and their tasks wait for their own Claude Code. Runbook: [docs/LIVE_DEMO.md](docs/LIVE_DEMO.md).
- **Check it works:** click **Self-test** on the status page. In about 10 seconds it runs the whole demo and checks every endpoint and role rule. It resets the data, so use the backup during a live demo.

---

## Quick start

```bash
git clone https://github.com/Omar-s-Org/Orchestra.git && cd Orchestra
npm install
npm run dev               # backend → http://localhost:8787 (API /api · agents /mcp · status page /)
npm run web:install       # once
npm run web               # frontend → http://localhost:8080
```

Connect your own Claude Code as a demo person (here Hassan):

```bash
claude mcp add --transport http orchestra http://localhost:8787/mcp \
  --header "Authorization: Bearer ak_hassan" --header "X-Agent-Name: Hassan's Claude Code"
```

Then tell it: *"Work your next Orchestra task."* It reads its task, does the work and asks you before each update. Full tool reference: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

> 💡 **No real agents handy?** `npm run sim` plays the team with scripted MCP clients, so the board comes alive on its own. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Roles and permissions

| | PM | Senior | Junior |
|---|:---:|:---:|:---:|
| Sees | the whole project | their department | own + junior coworkers' tasks |
| Project graph | ✅ | | |
| Company view (people and spend) | ✅ | | |
| Cost roll-up | ✅ | ✅ department | |
| Approve a milestone | ✅ any | ✅ if all its tasks are in their department and none are their own | |
| Work tasks through their agent | ✅ | ✅ | ✅ |

Rules the server enforces for every caller, human or agent:
- Only a task's workers can start, report on or submit it.
- A task is **locked** until all its prerequisites are done; the server refuses with `Locked (409)`.
- Agents and juniors never approve. A senior can't approve a milestone that contains their own task.
- Knowledge-base clearance is a hard floor.

---

## Open by design

| Way in | For | Docs |
|---|---|---|
| **MCP** (`/mcp`) | AI agents: Claude Code or any MCP client, 9 token-efficient tools | [Integrations → MCP](docs/INTEGRATIONS.md#mcp-for-ai-agents) |
| **REST** (`/api`) | Web UIs, scripts, dashboards | [Integrations → REST](docs/INTEGRATIONS.md#rest-api) |
| **Webhooks** | Slack bots, CRMs, CI, finance sheets | [Integrations → Webhooks](docs/INTEGRATIONS.md#webhooks) |

One agent task costs about **1,350 tokens** of MCP context (down from about 5,840), because writes return a short acknowledgement and one call gives the agent everything it needs to start.

---

## Testing

```bash
npm test                                   # unit + integration tests (vitest)
npm run check -- --url <backend URL>       # contract check: every API response vs the spec, per role (read-only)
npm run smoke -- --url <backend URL>       # the Self-test: the whole demo end to end (resets data)
npm run mcp:budget                         # token cost of the MCP tools for one task
```

---

## Repository layout

```
server/src        Express API, MCP server, permission engine, SQLite (better-sqlite3)
server/projects   Project files (JSON): northwind.json (static demo), lumen.json (live demo)
server/sim        Simulated agents (real MCP clients) and their scripted stories
server/test       vitest suites
web/              The web app (TanStack Start + React, built in Lovable)
docs/             Guides, specs and plans
```

**Docs:** [Development](docs/DEVELOPMENT.md) · [Integrations](docs/INTEGRATIONS.md) · [Live demo runbook](docs/LIVE_DEMO.md) · [Agent testing](docs/AGENT_TESTING.md) · [Deploy](docs/DEPLOY.md) · [Project format](docs/PROJECT_FORMAT.md) · [API + UI spec](docs/LOVABLE_PLAN.md) · [Product plan](docs/MVP_PLAN.md) · [Backlog](docs/BACKLOG.md)

---

## Team

| | Built |
|---|---|
| **Omar** | Backend core: schema, REST API, MCP server, permissions, hosting, demo runner |
| **Saad** | Web app (Lovable): board, graph, task drawer, review, company view |
| **Hassan** | Demo projects, simulated agents, webhooks, docs |

---

<p align="center">
  <sub>Orchestra · open source under the <a href="LICENSE">MIT license</a> · hackathon prototype</sub>
</p>
