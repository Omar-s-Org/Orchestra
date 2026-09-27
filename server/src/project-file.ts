// Load a whole project (people, milestones, docs, tasks, optional history) from a JSON file.
// This is how example/demo projects are defined; see docs/PROJECT_FORMAT.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { type DB, TABLES, now } from "./db.js";
import { createUserRow, insertTask, extractMentions } from "./service.js";
import { findCycle } from "./ordering.js";

const id = z.string().min(1);
const role = z.enum(["pm", "senior", "junior"]);
const status = z.enum(["todo", "in_progress", "review", "done"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

export const ProjectFile = z.object({
  project: z.object({ id, name: z.string().min(1), description: z.string().default("") }),
  people: z.array(z.object({
    id, name: z.string().min(1), role, department: z.string().min(1),
    email: z.string().email().optional(), title: z.string().default(""),
    password: z.string().min(4).optional(), agent_key: z.string().min(8).optional(),
  })).min(1),
  milestones: z.array(z.object({ id, name: z.string().min(1), due: date.optional(), signed_off: z.boolean().default(false) })).min(1),
  docs: z.array(z.object({ id, title: z.string().min(1), body: z.string().min(1), min_role: role.default("junior"), author: id })).default([]),
  tasks: z.array(z.object({
    id, title: z.string().min(1), milestone: id, parent: id.optional(), due: date.optional(), status: z.enum(["todo", "in_progress", "done"]).default("todo"),
    departments: z.array(z.string()).default([]), workers: z.array(id).default([]), access: z.array(id).default([]),
    depends_on: z.array(id).default([]), docs: z.array(id).default([]),
    description: z.string().default(""), scope: z.string().default(""),
  })).min(1),
  history: z.array(z.object({
    task: id, user: id, kind: z.enum(["progress", "completion", "approval", "status"]), summary: z.string().min(1),
    via: z.enum(["agent", "ui"]).default("agent"), agent_name: z.string().optional(),
    agents_used: z.array(z.string()).default([]), cost_usd: z.number().min(0).default(0),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    status_from: status.optional(), status_to: status.optional(), minutes_ago: z.number().min(0).default(0),
  })).default([]),
  artifacts: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]{6,32}$/).optional(), task: id, user: id, name: z.string().min(1), mime: z.string().min(1),
    text: z.string().optional(), base64: z.string().optional(), minutes_ago: z.number().min(0).default(0),
  })).default([]),
  live_agents: z.array(z.object({ user: id, task: id.optional(), activity: z.string().default(""), agent_name: z.string().optional() })).default([]),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

export class ProjectFileError extends Error {
  constructor(public problems: string[]) { super(`Invalid project file:\n- ${problems.join("\n- ")}`); }
}

/** Parse + check every cross-reference, reporting all problems at once. */
export function validateProject(raw: unknown): ProjectFile {
  const parsed = ProjectFile.safeParse(raw);
  if (!parsed.success) throw new ProjectFileError(parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`));
  const p = parsed.data;
  const problems: string[] = [];
  const dupes = (label: string, ids: string[]) => ids.filter((x, i) => ids.indexOf(x) !== i).forEach(x => problems.push(`duplicate ${label} id "${x}"`));
  const people = new Set(p.people.map(x => x.id)), ms = new Set(p.milestones.map(x => x.id));
  const docs = new Set(p.docs.map(x => x.id)), tasks = new Set(p.tasks.map(x => x.id));
  dupes("person", p.people.map(x => x.id)); dupes("milestone", [...ms]); dupes("doc", p.docs.map(x => x.id)); dupes("task", p.tasks.map(x => x.id));
  if (!p.people.some(x => x.role === "pm")) problems.push("people: at least one person must have role \"pm\"");
  const ref = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
  p.docs.forEach(d => ref(people.has(d.author), `docs.${d.id}.author: unknown person "${d.author}"`));
  for (const t of p.tasks) {
    ref(/^T-\d+$/.test(t.id), `tasks.${t.id}: task ids must look like T-1, T-2 … (used for mention links)`);
    ref(ms.has(t.milestone), `tasks.${t.id}.milestone: unknown milestone "${t.milestone}"`);
    if (t.parent) ref(tasks.has(t.parent) && t.parent !== t.id, `tasks.${t.id}.parent: unknown task "${t.parent}"`);
    [...t.workers, ...t.access].forEach(u => ref(people.has(u), `tasks.${t.id}: unknown person "${u}"`));
    t.depends_on.forEach(d => ref(tasks.has(d) && d !== t.id, `tasks.${t.id}.depends_on: unknown task "${d}"`));
    t.docs.forEach(d => ref(docs.has(d), `tasks.${t.id}.docs: unknown doc "${d}"`));
  }
  p.milestones.filter(m => m.signed_off).forEach(m => {
    const open = p.tasks.filter(t => t.milestone === m.id && t.status !== "done").map(t => t.id);
    ref(open.length === 0, `milestones.${m.id}.signed_off: tasks not done yet (${open.join(", ")})`);
  });
  const cycle = findCycle(new Map(p.tasks.map(t => [t.id, t.depends_on])));
  if (cycle) problems.push(`tasks: circular prerequisites ${cycle.join(" → ")} (nothing in this loop could ever start)`);
  p.history.forEach((h, i) => { ref(tasks.has(h.task), `history[${i}].task: unknown task "${h.task}"`); ref(people.has(h.user), `history[${i}].user: unknown person "${h.user}"`); });
  p.artifacts.forEach((a, i) => {
    ref(tasks.has(a.task), `artifacts[${i}].task: unknown task "${a.task}"`); ref(people.has(a.user), `artifacts[${i}].user: unknown person "${a.user}"`);
    ref(!!(a.text ?? a.base64), `artifacts[${i}]: provide text or base64`);
  });
  p.live_agents.forEach((l, i) => { ref(people.has(l.user), `live_agents[${i}].user: unknown person "${l.user}"`); if (l.task) ref(tasks.has(l.task), `live_agents[${i}].task: unknown task "${l.task}"`); });
  if (problems.length) throw new ProjectFileError(problems);
  return p;
}

/** Predictable ak_<id> keys keep local dev and simulators simple; AGENT_KEYS=random issues unguessable keys instead. */
const defaultAgentKey = (id: string) => (process.env.AGENT_KEYS === "random" ? undefined : `ak_${id}`);

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Replace everything in the database with the given project. */
export function loadProject(db: DB, raw: unknown, sourcePath?: string) {
  const p = validateProject(raw);
  const firstName = (uid: string) => p.people.find(x => x.id === uid)!.name.split(" ")[0];
  db.transaction(() => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    for (const u of p.people) createUserRow(db, { id: u.id, name: u.name, email: u.email ?? `${u.id}@example.test`, password: u.password ?? "demo1234",
      title: u.title, department: u.department, role: u.role, agentKey: u.agent_key ?? defaultAgentKey(u.id) });
    db.prepare("INSERT INTO projects VALUES (?,?,?)").run(p.project.id, p.project.name, p.project.description);
    const pm = p.people.find(x => x.role === "pm")!.id;
    for (const m of p.milestones) db.prepare("INSERT INTO milestones (id, project_id, name, due, approved_at, approved_by) VALUES (?,?,?,?,?,?)")
      .run(m.id, p.project.id, m.name, m.due ?? null, m.signed_off ? ago(60 * 24) : null, m.signed_off ? pm : null);
    for (const d of p.docs) db.prepare("INSERT INTO kb_docs (id,project_id,title,body,min_role,author_id,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(d.id, p.project.id, d.title, d.body, d.min_role, d.author, now());
    // Parents first so subtasks can reference them.
    const ordered = [...p.tasks.filter(t => !t.parent), ...p.tasks.filter(t => t.parent)];
    for (const t of ordered) insertTask(db, { id: t.id, milestoneId: t.milestone, parentId: t.parent, title: t.title, description: t.description, scope: t.scope,
      status: t.status, due: t.due, departments: t.departments, workers: t.workers, access: t.access, dependsOn: t.depends_on, docIds: t.docs }, pm);
    for (const t of p.tasks) extractMentions(db, t.id, `${t.description} ${t.scope}`, "description"); // second pass: forward references
    for (const a of p.artifacts) db.prepare("INSERT INTO artifacts (id,task_id,user_id,name,mime,data,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(a.id ?? randomBytes(8).toString("hex"), a.task, a.user, a.name, a.mime, a.base64 != null ? Buffer.from(a.base64, "base64") : Buffer.from(a.text ?? ""), ago(a.minutes_ago));
    const up = db.prepare("INSERT INTO task_updates (task_id,user_id,via,agent_name,kind,status_from,status_to,summary,agents_used,cost_usd,links,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const h of [...p.history].sort((a, b) => b.minutes_ago - a.minutes_ago)) {
      const r = up.run(h.task, h.user, h.via, h.via === "agent" ? h.agent_name ?? `${firstName(h.user)}'s Claude` : null, h.kind, h.status_from ?? null, h.status_to ?? null,
        h.summary, JSON.stringify(h.agents_used), h.cost_usd, JSON.stringify(h.links), ago(h.minutes_ago));
      extractMentions(db, h.task, h.summary, `update:${r.lastInsertRowid}`);
    }
    for (const l of p.live_agents) db.prepare("INSERT INTO agent_sessions (user_id, agent_name, task_id, activity, started_at, last_seen) VALUES (?,?,?,?,?,?)")
      .run(l.user, l.agent_name ?? `${firstName(l.user)}'s Claude`, l.task ?? null, l.activity, ago(15), now());
    if (sourcePath) db.prepare("INSERT INTO meta (key, value) VALUES ('project_file', ?)").run(sourcePath);
  })();
  return { project: p.project.name, people: p.people.length, milestones: p.milestones.length, tasks: p.tasks.length, docs: p.docs.length };
}

export const DEFAULT_PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../projects/northwind.json");

export function loadProjectFile(db: DB, file: string) {
  const abs = path.resolve(file);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(abs, "utf8")); }
  catch (e) { throw new ProjectFileError([`${abs}: ${(e as Error).message}`]); }
  return loadProject(db, raw, abs);
}
