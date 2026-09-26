import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { reset } from "../src/seed.js";
import * as S from "../src/service.js";

let db: DB;
const as = (id: string, via: S.Via = "ui"): S.Ctx => ({ db, user: S.userById(db, id)!, via });
const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort();

beforeEach(() => { db = openDb(":memory:"); reset(db); });

describe("task visibility (collaborative at the bottom, management at the top)", () => {
  it("admin sees everything", () => {
    expect(S.listTasks(as("layla")).length).toBe(8);
  });
  it("manager sees every task in their project", () => {
    expect(S.listTasks(as("karim")).length).toBe(8);
  });
  it("contributor sees own tasks, their subtasks and scoped tasks only", () => {
    expect(ids(S.listTasks(as("omar")))).toEqual(["T-57", "T-58", "T-59", "T-60"]);
  });
  it("lead sees the subtree of tasks they lead, plus scope of held tasks", () => {
    expect(ids(S.listTasks(as("sara")))).toEqual(["T-57", "T-58", "T-59", "T-60", "T-61", "T-62"]);
  });
  it("hidden tasks look like 404, not 403", () => {
    expect(() => S.getTask(as("omar"), "T-64")).toThrow(/not found/);
  });
});

describe("status changes", () => {
  it("contributor (via agent) can move own task to review but not done", () => {
    const c = as("omar", "agent");
    expect(S.setStatus(c, "T-58", "in_progress").status).toBe("in_progress");
    expect(S.setStatus(c, "T-58", "review", "Interviewed Tom").status).toBe("review");
    expect(() => S.setStatus(c, "T-58", "done")).toThrow(/Only the task lead or a project manager/);
  });
  it("lead closes the task after review", () => {
    S.setStatus(as("omar"), "T-58", "review");
    expect(S.setStatus(as("sara"), "T-58", "done").status).toBe("done");
  });
  it("denied agent action is audited", () => {
    try { S.setStatus(as("omar", "agent"), "T-58", "done"); } catch { /* expected */ }
    const row = db.prepare("SELECT * FROM audit WHERE allowed=0").get() as { actor_id: string; via: string };
    expect(row).toMatchObject({ actor_id: "omar", via: "agent" });
  });
  it("contributor cannot change a task they can only see through scope", () => {
    expect(() => S.setStatus(as("omar"), "T-60", "done")).toThrow();
    expect(S.getTask(as("omar"), "T-60").allowed_actions).toEqual(["comment"]);
  });
});

describe("documents: clearance is a hard floor", () => {
  it("contributor reads project docs + scoped docs, not restricted/confidential", () => {
    expect(ids(S.listDocuments(as("omar")))).toEqual(["D-1", "D-2", "D-3"]);
  });
  it("lead also reads restricted, plus docs scoped to tasks they lead", () => {
    expect(ids(S.listDocuments(as("sara")))).toEqual(["D-1", "D-2", "D-3", "D-4"]);
  });
  it("manager reads confidential project docs but not need-to-know (scoped) docs; admin reads all", () => {
    expect(ids(S.listDocuments(as("karim")))).toEqual(["D-1", "D-4", "D-5"]);
    expect(S.listDocuments(as("layla")).length).toBe(6);
  });
  it("a scope grant cannot bypass clearance", () => {
    expect(() => S.grantScope(as("karim"), "T-57", "document", "D-5")).toThrow(/lacks clearance/);
  });
  it("cannot grant a document you cannot read", () => {
    expect(() => S.grantScope(as("sara"), "T-57", "document", "D-5")).toThrow(/cannot grant a document you cannot read/);
  });
});

describe("programmable scope: who you can talk to", () => {
  it("intern on discovery task can message Legal, not HR/others outside scope", () => {
    const c = as("omar", "agent");
    expect(S.sendMessage(c, "nadia", "Can we use call transcripts for AI?", "T-57").to).toBe("nadia");
    expect(() => S.sendMessage(c, "layla", "hi")).toThrow(/not in your task scope/);
  });
  it("granting a person expands contacts immediately; revoking removes", () => {
    expect(() => S.sendMessage(as("lukas"), "nadia", "policy?")).toThrow();
    S.grantScope(as("sara"), "T-62", "person", "nadia");
    expect(S.sendMessage(as("lukas"), "nadia", "policy?").to).toBe("nadia");
    S.revokeScope(as("sara"), "T-62", "person", "nadia");
    expect(() => S.sendMessage(as("lukas"), "nadia", "again")).toThrow();
  });
  it("non-member sees only docs they own or are scoped to", () => {
    expect(ids(S.listDocuments(as("nadia")))).toEqual(["D-3"]);
    expect(ids(S.listDocuments(as("mia")))).toEqual([]);
  });
});

describe("management", () => {
  it("overview only for manager/admin", () => {
    const o = S.projectOverview(as("karim"), "P-AI");
    expect(o.progress.total).toBe(8);
    expect(o.blocked.map(t => t.id)).toEqual(["T-62"]);
    expect(() => S.projectOverview(as("sara"), "P-AI")).toThrow();
  });
  it("contributors can only create subtasks, for themselves", () => {
    expect(() => S.createTask(as("omar"), { projectId: "P-AI", title: "x" })).toThrow(/lead or above/);
    expect(S.createTask(as("omar", "agent"), { parentId: "T-57", title: "Interview Legal" }).assignee_id).toBe("omar");
    expect(() => S.createTask(as("omar"), { parentId: "T-57", title: "y", assigneeId: "lukas" })).toThrow();
  });
  it("only admin changes roles", () => {
    expect(() => S.setRole(as("karim"), "omar", "manager")).toThrow(/Admin only/);
    expect(S.setRole(as("layla"), "omar", "lead")!.role).toBe("lead");
  });
});
