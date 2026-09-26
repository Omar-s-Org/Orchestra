// Demo data: "Northwind" adopting AI. All data is synthetic.
import type { DB } from "./db.js";

const T0 = "2026-09-26T09:00:00.000Z";

export function reset(db: DB) {
  db.exec("DELETE FROM audit; DELETE FROM messages; DELETE FROM comments; DELETE FROM task_scope; DELETE FROM documents; DELETE FROM tasks; DELETE FROM milestones; DELETE FROM workstreams; DELETE FROM project_members; DELETE FROM projects; DELETE FROM users;");

  const users: [string, string, string, string, string][] = [
    // id, name, title, department, role
    ["layla", "Layla Haddad", "Chief Operating Officer", "Executive", "admin"],
    ["karim", "Karim Nassar", "AI Program Manager", "PMO", "manager"],
    ["sara", "Sara Weber", "Tech Lead", "Engineering", "lead"],
    ["tom", "Tom Berger", "Sales Lead", "Sales", "lead"],
    ["omar", "Omar", "AI Intern", "Engineering", "contributor"],
    ["lukas", "Lukas Maier", "Junior Developer", "Engineering", "contributor"],
    ["nadia", "Nadia Aziz", "Legal Counsel", "Legal", "contributor"],
    ["mia", "Mia Hofer", "After-sales Specialist", "After-sales", "contributor"],
  ];
  const u = db.prepare("INSERT INTO users (id,name,email,title,department,role,token) VALUES (?,?,?,?,?,?,?)");
  for (const [id, name, title, dept, role] of users) u.run(id, name, `${id}@northwind.example`, title, dept, role, `tok_${id}`);

  db.prepare("INSERT INTO projects VALUES (?,?,?)").run("P-AI", "Northwind AI Adoption", "Company-wide initiative to identify, pilot and roll out AI use cases.");
  for (const id of ["karim", "sara", "tom", "omar", "lukas"]) db.prepare("INSERT INTO project_members VALUES (?,?)").run("P-AI", id);
  // nadia and mia are NOT project members: they are reachable only through task scope.

  const ws = db.prepare("INSERT INTO workstreams VALUES (?,?,?,?)");
  ws.run("W-DISC", "P-AI", "Use-case discovery", "sara");
  ws.run("W-PLAT", "P-AI", "Data & platform", "sara");
  ws.run("W-GOV", "P-AI", "Governance & legal", "karim");

  const ms = db.prepare("INSERT INTO milestones VALUES (?,?,?,?)");
  ms.run("M-1", "W-DISC", "Use-case shortlist approved", "2026-10-09");
  ms.run("M-2", "W-PLAT", "Pilot environment live", "2026-10-23");
  ms.run("M-3", "W-GOV", "AI usage policy signed off", "2026-10-16");

  const t = db.prepare("INSERT INTO tasks (id,project_id,milestone_id,parent_id,title,description,status,assignee_id,lead_id,created_by,due,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const task = (id: string, m: string, parent: string | null, title: string, desc: string, status: string, assignee: string, lead: string, due: string) =>
    t.run(id, "P-AI", m, parent, title, desc, status, assignee, lead, lead, due, T0, T0);
  task("T-57", "M-1", null, "Identify top 10 AI use cases across departments", "Interview Sales, Legal and After-sales. Score each use case on value, feasibility and risk.", "in_progress", "omar", "sara", "2026-10-02");
  task("T-58", "M-1", "T-57", "Interview Sales on pipeline pain points", "", "todo", "omar", "sara", "2026-09-29");
  task("T-59", "M-1", "T-57", "Interview After-sales on ticket triage", "", "todo", "omar", "sara", "2026-09-30");
  task("T-60", "M-1", null, "Collect sales call transcripts sample", "Anonymised sample of 20 calls for the discovery team.", "review", "tom", "karim", "2026-09-30");
  task("T-61", "M-2", null, "Provision pilot sandbox (vector DB + LLM gateway)", "", "in_progress", "lukas", "sara", "2026-10-10");
  task("T-62", "M-2", "T-61", "Write data-access policy for sandbox", "", "blocked", "lukas", "sara", "2026-10-07");
  task("T-63", "M-3", null, "Draft AI acceptable-use policy", "", "todo", "karim", "karim", "2026-10-12");
  task("T-64", "M-3", null, "Budget case for FY27 AI rollout", "Confidential.", "todo", "karim", "karim", "2026-10-14");

  const d = db.prepare("INSERT INTO documents (id,project_id,title,body,classification,visibility,owner_id,tags) VALUES (?,?,?,?,?,?,?,?)");
  d.run("D-1", "P-AI", "AI Initiative Charter", "Goal: 3 AI pilots live by Q1. Principles: human approval before consequential actions; synthetic data in pilots.", "internal", "project", "karim", "charter,goals");
  d.run("D-2", "P-AI", "Sales process notes", "Reps spend ~6h/week on CRM updates. Lead qualification is manual. Quote approvals take 2 days.", "internal", "scoped", "tom", "sales,process");
  d.run("D-3", "P-AI", "Legal: draft AI usage policy", "No customer PII in external models. Human review required for customer-facing output.", "internal", "scoped", "nadia", "legal,policy");
  d.run("D-4", "P-AI", "Data inventory", "CRM (Salesforce), ticketing (Zendesk), ERP. PII columns flagged.", "restricted", "project", "sara", "data,platform");
  d.run("D-5", "P-AI", "FY27 AI budget", "Pilot budget EUR 180k; rollout EUR 1.2m subject to board approval.", "confidential", "project", "karim", "budget,finance");
  d.run("D-6", "P-AI", "HR: roles affected by automation", "Draft impact assessment per role. Do not circulate.", "confidential", "scoped", "layla", "hr");

  const s = db.prepare("INSERT INTO task_scope (task_id,kind,ref_id,granted_by) VALUES (?,?,?,?)");
  // Omar's discovery task lets him talk to Sales, Legal and After-sales and read their notes.
  for (const p of ["tom", "nadia", "mia"]) s.run("T-57", "person", p, "sara");
  for (const doc of ["D-2", "D-3"]) s.run("T-57", "document", doc, "sara");
  s.run("T-57", "task", "T-60", "sara");

  db.prepare("INSERT INTO comments (task_id,author_id,via,body,at) VALUES (?,?,?,?,?)").run("T-57", "sara", "ui", "Start with Sales and After-sales; Legal review before we shortlist.", T0);
}
