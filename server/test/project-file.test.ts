import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { loadProject, validateProject, ProjectFileError, DEFAULT_PROJECT } from "../src/project-file.js";
import * as S from "../src/service.js";
import type { User } from "../src/permissions.js";

const mini = () => ({
  project: { id: "P-9", name: "Tiny Co", description: "test" },
  people: [
    { id: "boss", name: "Bo Ss", role: "pm", department: "Mgmt" },
    { id: "dev", name: "De V", role: "junior", department: "Eng" },
  ],
  milestones: [{ id: "M-1", name: "Ship", due: "2030-01-01" }],
  tasks: [
    { id: "T-1", title: "Build it", milestone: "M-1", due: "2020-01-01", departments: ["Eng"], workers: ["dev"], description: "See T-2" },
    { id: "T-2", title: "Test it", milestone: "M-1", due: "2030-01-01", departments: ["Eng"], workers: ["dev"], depends_on: ["T-1"] },
  ],
});
const user = (db: ReturnType<typeof openDb>, id: string) => db.prepare("SELECT id,name,role,department FROM users WHERE id=?").get(id) as User;

describe("project files", () => {
  it("the bundled Northwind demo is valid", () => {
    expect(() => validateProject(JSON.parse(fs.readFileSync(DEFAULT_PROJECT, "utf8")))).not.toThrow();
  });

  it("loads a project with due dates, defaults and forward mentions", () => {
    const db = openDb(":memory:");
    const r = loadProject(db, mini());
    expect(r).toMatchObject({ project: "Tiny Co", people: 2, tasks: 2 });
    const c: S.Ctx = { db, user: user(db, "dev"), via: "ui" };
    const t1 = S.getTask(c, "T-1");
    expect(t1).toMatchObject({ due: "2020-01-01", overdue: true });
    expect(t1.mentions.map(m => m.id)).toEqual(["T-2"]);          // forward reference resolved
    expect(S.getTask(c, "T-2")).toMatchObject({ overdue: false });
    expect(S.overview({ ...c, user: user(db, "boss") }).overdue).toBe(1);
    expect(S.login(db, "dev@example.test", "demo1234").user.id).toBe("dev"); // default email + password
    expect(S.userByAgentKey(db, "ak_dev")?.id).toBe("dev");                  // default agent key
  });

  it("reports every broken reference at once", () => {
    const bad = mini();
    bad.tasks[0].workers = ["ghost"];
    bad.tasks[1].depends_on = ["T-99"];
    (bad.tasks[1] as { milestone: string }).milestone = "M-404";
    try { validateProject(bad); throw new Error("should fail"); }
    catch (e) {
      expect(e).toBeInstanceOf(ProjectFileError);
      const msg = (e as Error).message;
      expect(msg).toMatch(/unknown person "ghost"/);
      expect(msg).toMatch(/unknown task "T-99"/);
      expect(msg).toMatch(/unknown milestone "M-404"/);
    }
  });

  it("rejects a bad date format", () => {
    const bad = mini();
    (bad.tasks[0] as { due: string }).due = "next friday";
    expect(() => validateProject(bad)).toThrow(/tasks\.0\.due: use YYYY-MM-DD/);
  });

  it("rejects circular prerequisites", () => {
    const bad = mini();
    (bad.tasks[0] as { depends_on?: string[] }).depends_on = ["T-2"]; // T-2 already depends on T-1
    expect(() => validateProject(bad)).toThrow(/circular prerequisites T-\d → T-\d → T-\d/);
  });

  it("requires at least one PM", () => {
    const bad = mini();
    bad.people[0].role = "junior";
    expect(() => validateProject(bad)).toThrow(/role "pm"/);
  });

  it("AGENT_KEYS=random issues unguessable keys", () => {
    process.env.AGENT_KEYS = "random";
    try {
      const db = openDb(":memory:");
      loadProject(db, mini());
      expect(S.userByAgentKey(db, "ak_dev")).toBeUndefined();
      const { agent_key } = db.prepare("SELECT agent_key FROM users WHERE id='dev'").get() as { agent_key: string };
      expect(agent_key).toMatch(/^ak_[0-9a-f]{48}$/);
    } finally { delete process.env.AGENT_KEYS; }
  });

  it("reset reloads the last loaded project file", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orch-")), "tiny.json");
    fs.writeFileSync(file, JSON.stringify(mini()));
    const db = openDb(":memory:");
    reset(db, file);
    reset(db); // no argument → same file again
    expect((db.prepare("SELECT name FROM projects").get() as { name: string }).name).toBe("Tiny Co");
  });
});
