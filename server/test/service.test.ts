import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import * as S from "../src/service.js";
import type { User } from "../src/permissions.js";

let db: DB;
const user = (id: string) => db.prepare("SELECT id,name,role,department,email,title FROM users WHERE id=?").get(id) as User;
const ui = (id: string): S.Ctx => ({ db, user: user(id), via: "ui" });
const agent = (id: string): S.Ctx => ({ db, user: user(id), via: "agent", agentName: `${id}-bot` });
const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort();

beforeEach(() => { db = openDb(":memory:"); reset(db); });

describe("login", () => {
  it("accepts the demo password and rejects a wrong one", () => {
    const r = S.login(db, "sara@northwind.test", "demo1234");
    expect(r.user.id).toBe("sara");
    expect(S.userBySession(db, r.token)?.id).toBe("sara");
    expect(() => S.login(db, "sara@northwind.test", "nope")).toThrow(/Invalid/);
  });
  it("session tokens and agent keys are separate credentials", () => {
    const { token } = S.login(db, "john@northwind.test", "demo1234");
    expect(S.userByAgentKey(db, token)).toBeUndefined();
    expect(S.userBySession(db, "ak_john")).toBeUndefined();
    expect(S.userByAgentKey(db, "ak_john")?.id).toBe("john");
  });
});

describe("unified visibility rule", () => {
  it("PM sees everything", () => {
    expect(S.listTasks(ui("layla")).length).toBe(14);
  });
  it("junior sees own + junior coworkers' tasks in their department, not senior tasks", () => {
    const seen = ids(S.listTasks(ui("john")));
    expect(seen).toContain("T-4");          // Priya's task (coworker)
    expect(seen).toContain("T-9");          // cross-department, john is a worker
    expect(seen).not.toContain("T-2");      // Sara's (senior) task
    expect(seen).not.toContain("T-8");      // Marketing
    expect(seen).not.toContain("T-1");      // Management
  });
  it("senior sees their whole department including senior tasks, not other departments", () => {
    const seen = ids(S.listTasks(ui("sara")));
    expect(seen).toContain("T-2");
    expect(seen).toContain("T-9");
    expect(seen).not.toContain("T-8");
    expect(seen).not.toContain("T-12");
  });
  it("junior in Marketing cannot see the senior pricing task", () => {
    expect(ids(S.listTasks(ui("mia")))).toEqual(["T-13", "T-8", "T-9"].sort());
  });
  it("hidden task is a 404, not a 403", () => {
    expect(() => S.getTask(ui("john"), "T-2")).toThrow(/not found/);
  });
  it("filters: person, department, status, mine", () => {
    expect(ids(S.listTasks(ui("layla"), { person: "priya" }))).toEqual(["T-10", "T-11", "T-4"]);
    expect(ids(S.listTasks(ui("layla"), { department: "Marketing" }))).toEqual(["T-12", "T-13", "T-8", "T-9"]);
    expect(S.listTasks(ui("layla"), { status: "review" }).map(t => t.id)).toEqual(["T-8"]);
    expect(ids(S.listTasks(ui("hassan"), { mine: true }))).toEqual(["T-14", "T-7"]);
  });
});

/** Priya submits T-4 and Sara approves it, which unlocks T-6 (Omar) and T-7 (Hassan). */
function finishT4() {
  S.submitTask(agent("priya"), "T-4", { summary: "Product API complete with search and recommendations." });
  S.approveTask(ui("sara"), "T-4");
}

describe("agent workflow", () => {
  it("start → report → attach → submit → senior approves", () => {
    finishT4();
    const a = agent("hassan");
    expect(S.startTask(a, "T-7", "Write e2e tests").status).toBe("in_progress");
    S.reportProgress(a, "T-7", { summary: "Used a **test agent** to write 12 tests against T-4.", agentsUsed: ["test agent"], costUsd: 0.4 });
    const art = S.attachArtifact(a, "T-7", { name: "report.md", mime: "text/markdown", text: "# ok" });
    expect(art.url).toBe(`/api/artifacts/${art.id}`);
    const sub = S.submitTask(a, "T-7", { summary: `All green. Details: [report](${art.url})`, agentsUsed: ["test agent"], costUsd: 0.2 });
    expect(sub.status).toBe("review");
    expect(sub.cost_usd).toBe(0.6);
    expect(sub.updates[0]).toMatchObject({ kind: "completion", via: "agent", agent_name: "hassan-bot" });
    expect(S.getTask(ui("sara"), "T-7").allowed_actions).toEqual(["approve", "reopen"]);
    expect(S.approveTask(ui("sara"), "T-7").status).toBe("done");
  });
  it("juniors and their agents can never approve", () => {
    expect(S.getTask(ui("john"), "T-4").allowed_actions).toEqual([]);
    finishT4();
    S.submitTask(agent("hassan"), "T-7", { summary: "Finished all the integration tests." });
    expect(() => S.approveTask(ui("john"), "T-7")).toThrow(/can't approve/);
    const denied = db.prepare("SELECT * FROM audit WHERE allowed=0").get() as { actor_id: string };
    expect(denied.actor_id).toBe("john");
  });
  it("only workers can report on a task", () => {
    expect(() => S.reportProgress(agent("john"), "T-4", { summary: "hi" })).toThrow(/not a worker/);
  });
  it("submit requires a real explanation", () => {
    expect(() => S.submitTask(agent("hassan"), "T-7", { summary: "done" })).toThrow(/explanation/);
  });
  it("reopen needs a note and returns to in_progress", () => {
    expect(() => S.reopenTask(ui("tom"), "T-8", "")).toThrow(/note/);
    expect(S.reopenTask(ui("tom"), "T-8", "Shorter headline please").status).toBe("in_progress");
  });
  it("mentioning a task id in a report creates a graph edge", () => {
    S.reportProgress(agent("priya"), "T-11", { summary: "Search ranking reuses the T-5 feature store" });
    expect(S.getTask(ui("layla"), "T-11").mentions.map(m => m.id)).toContain("T-5");
  });
  it("reporting marks the agent live on the task", () => {
    finishT4();
    S.startTask(agent("omar"), "T-6", "Build sign-up screen");
    expect(S.getTask(ui("layla"), "T-6").live).toMatchObject({ agent_name: "omar-bot", activity: "Build sign-up screen" });
    expect(S.liveAgents(ui("sara")).map(a => a.user.id)).toContain("omar");
  });
});

describe("prerequisites and suggested order", () => {
  it("a task is locked until every prerequisite is done (approved), then unlocks", () => {
    const t6 = S.getTask(ui("omar"), "T-6");
    expect(t6).toMatchObject({ locked: true, blocked_by: [{ id: "T-4", status: "in_progress" }] });
    expect(() => S.startTask(agent("omar"), "T-6", "go")).toThrow(/locked until its prerequisites are done: T-4 \(in_progress\)/);
    expect(() => S.reportProgress(agent("omar"), "T-6", { summary: "x" })).toThrow(/locked/);
    const refused = db.prepare("SELECT * FROM audit WHERE action='start_task' AND allowed=0").get();
    expect(refused).toBeTruthy();
    S.submitTask(agent("priya"), "T-4", { summary: "Product API complete with search and recommendations." });
    expect(S.getTask(ui("omar"), "T-6").locked).toBe(true);   // review isn't enough
    S.approveTask(ui("sara"), "T-4");
    expect(S.getTask(ui("omar"), "T-6")).toMatchObject({ locked: false, blocked_by: [] });
    expect(S.startTask(agent("omar"), "T-6", "Build sign-up").status).toBe("in_progress");
  });
  it("suggested order puts prerequisites first", () => {
    const seq = new Map(S.listTasks(ui("layla")).map(t => [t.id, t.sequence!]));
    expect(seq.get("T-3")!).toBeLessThan(seq.get("T-5")!);
    expect(seq.get("T-5")!).toBeLessThan(seq.get("T-9")!);
    expect(seq.get("T-9")!).toBeLessThan(seq.get("T-13")!);
    const list = S.listTasks(ui("layla")).map(t => t.sequence);
    expect(list).toEqual([...list].sort((a, b) => a! - b!)); // lists come back in suggested order
  });
  it("next_task picks the first unlocked task and explains what's waiting", () => {
    expect(S.nextTask(agent("john")).next?.id).toBe("T-5");
    const omar = S.nextTask(agent("omar"));
    expect(omar.next).toBeNull();
    expect(omar.waiting).toEqual([{ id: "T-6", title: "Onboarding UI", blocked_by: [{ id: "T-4", title: "Build product API", status: "in_progress" }] }]);
  });
});

describe("overview, review queue, cost", () => {
  it("review queue items carry the latest completion and artifacts", () => {
    const o = S.overview(ui("tom"));
    expect(o.review_queue.map(t => t.id)).toEqual(["T-8"]);
    expect(o.review_queue[0].latest_completion?.summary).toMatch(/Variant \*\*B\*\*/);
    expect(o.review_queue[0].artifacts[0].mime).toBe("image/svg+xml");
  });
  it("juniors get no cost and no review queue", () => {
    const o = S.overview(ui("john"));
    expect(o.cost).toBeNull();
    expect(o.review_queue).toEqual([]);
  });
  it("senior cost covers their department only", () => {
    const o = S.overview(ui("sara"));
    expect(o.cost!.by_department.map(d => d.department)).toEqual(["Engineering"]);
  });
});

describe("knowledge base", () => {
  it("min_role is a hard floor", () => {
    expect(ids(S.listKb(ui("john")))).toEqual(["K-1", "K-2", "K-3"]);
    expect(ids(S.listKb(ui("sara")))).toEqual(["K-1", "K-2", "K-3", "K-4"]);
    expect(() => S.readKb(ui("sara"), "K-5")).toThrow(/restricted/);
    expect(S.readKb(ui("layla"), "K-5").title).toMatch(/budget/i);
  });
});

describe("graph", () => {
  it("is PM only and has the relational structure", () => {
    expect(() => S.graph(ui("sara"))).toThrow(/PM only/);
    const g = S.graph(ui("layla"));
    const has = (type: string, s: string, t: string) => g.edges.some(e => e.type === type && e.source === s && e.target === t);
    expect(g.nodes.filter(n => n.type === "project")).toHaveLength(1);
    expect(has("contains", "project:P-1", "milestone:M-1")).toBe(true);
    expect(has("subtask", "task:T-4", "task:T-10")).toBe(true);
    expect(has("depends_on", "task:T-5", "task:T-3")).toBe(true);
    expect(has("works_on", "person:john", "task:T-5")).toBe(true);
    expect(g.edges.some(e => e.type === "mentions")).toBe(true);
  });
});

describe("PM setup", () => {
  it("creates a task with departments, workers and access; others can't", () => {
    const t = S.createTask(ui("layla"), { milestoneId: "M-2", title: "Beta feedback survey", departments: ["Marketing"], workers: ["mia"], access: ["tom"], dependsOn: ["T-8"] });
    expect(t.id).toBe("T-15");
    expect(t.depends_on.map(d => d.id)).toEqual(["T-8"]);
    expect(() => S.createTask(ui("sara"), { milestoneId: "M-1", title: "x" })).toThrow(/Only the PM/);
  });

  it("rejects a task that points at people, tasks or docs that don't exist", () => {
    expect(() => S.createTask(ui("layla"), { milestoneId: "M-2", title: "x", workers: ["ghost"], dependsOn: ["T-999"], docIds: ["K-99"] }))
      .toThrow(/unknown person "ghost"; unknown task "T-999"; unknown doc "K-99"/);
  });

  it("new milestone and doc ids never collide with gaps in existing ids", () => {
    db.prepare("UPDATE milestones SET id='M-7' WHERE id='M-1'").run();   // ids M-7, M-2, M-3 → a count-based id would be M-4, max-based M-8
    db.prepare("UPDATE kb_docs SET id='K-9' WHERE id='K-1'").run();
    expect(S.createMilestone(ui("layla"), { name: "Later" }).id).toBe("M-8");
    expect(S.createDoc(ui("layla"), { title: "Note", body: "Body" }).id).toBe("K-10");
  });
});
