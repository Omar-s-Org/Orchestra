// Demo data: "Northwind Launch" (synthetic). Matches docs/LOVABLE_PLAN.md §7.
import { type DB, TABLES } from "./db.js";
import { createUserRow, insertTask, extractMentions } from "./service.js";

export const DEMO_PASSWORD = "demo1234";

export const USERS = [
  { id: "layla", name: "Layla Haddad", role: "pm", department: "Management", title: "Project Manager" },
  { id: "sara", name: "Sara Weber", role: "senior", department: "Engineering", title: "Engineering Lead" },
  { id: "tom", name: "Tom Berger", role: "senior", department: "Marketing", title: "Marketing Lead" },
  { id: "john", name: "John Carter", role: "junior", department: "Engineering", title: "Backend Developer" },
  { id: "priya", name: "Priya Nair", role: "junior", department: "Engineering", title: "Backend Developer" },
  { id: "omar", name: "Omar", role: "junior", department: "Engineering", title: "Frontend Developer" },
  { id: "hassan", name: "Hassan", role: "junior", department: "Engineering", title: "QA / DevOps" },
  { id: "mia", name: "Mia Hofer", role: "junior", department: "Marketing", title: "Content Marketer" },
] as const;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const CHART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260">
<rect width="480" height="260" fill="#0f172a"/><text x="24" y="36" fill="#e2e8f0" font-family="Inter,Arial" font-size="18">Landing page A/B: sign-up rate</text>
<rect x="60" y="90" width="120" height="130" fill="#64748b"/><rect x="260" y="60" width="120" height="160" fill="#22c55e"/>
<text x="92" y="240" fill="#cbd5e1" font-family="Arial" font-size="14">Variant A 3.1%</text><text x="286" y="240" fill="#cbd5e1" font-family="Arial" font-size="14">Variant B 4.2%</text></svg>`;

export function reset(db: DB) {
  db.transaction(() => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    for (const u of USERS) createUserRow(db, { ...u, email: `${u.id}@northwind.test`, password: DEMO_PASSWORD, agentKey: `ak_${u.id}` });

    db.prepare("INSERT INTO projects VALUES (?,?,?)").run("P-1", "Northwind Launch", "Launch of Northwind's new smart-home product line, delivered by a team where everyone works through their own AI agent.");
    const ms = db.prepare("INSERT INTO milestones VALUES (?,?,?,?)");
    ms.run("M-1", "P-1", "MVP ready", "2026-10-03");
    ms.run("M-2", "P-1", "Beta with 10 customers", "2026-10-17");
    ms.run("M-3", "P-1", "Public launch", "2026-10-31");

    const kb = db.prepare("INSERT INTO kb_docs (id,project_id,title,body,min_role,author_id,created_at) VALUES (?,?,?,?,?,?,?)");
    kb.run("K-1", "P-1", "Northwind Launch brief", "# Northwind Launch\n\nGoal: ship the smart-home hub MVP by **3 Oct**, onboard 10 beta customers by 17 Oct, public launch 31 Oct.\n\n- Every task is owned by a person working through their AI agent.\n- Agents report progress and cost; seniors approve finished work.", "junior", "layla", minutesAgo(3000));
    kb.run("K-2", "P-1", "API design conventions", "# API conventions\n\n- REST, JSON, kebab-case paths\n- Errors: `{ error }` with proper status codes\n- Every endpoint has a test", "junior", "sara", minutesAgo(2800));
    kb.run("K-3", "P-1", "Brand voice guide", "# Brand voice\n\nWarm, confident, no jargon. Lead with the benefit, then the feature.", "junior", "tom", minutesAgo(2600));
    kb.run("K-4", "P-1", "Architecture decision records", "# ADRs\n\n1. SQLite for the pilot, Postgres at launch.\n2. Recommendations run as a nightly batch job.", "senior", "sara", minutesAgo(2400));
    kb.run("K-5", "P-1", "Launch budget FY27", "# Budget (confidential)\n\n- Engineering: €180k\n- Marketing: €120k\n- AI usage cap: €4k/month", "pm", "layla", minutesAgo(2200));

    const T = (t: Parameters<typeof insertTask>[1]) => insertTask(db, t, "layla");
    T({ id: "T-1", milestoneId: "M-1", title: "Define MVP scope & success metrics", status: "done", departments: ["Management"], workers: ["layla"], docIds: ["K-1"],
      description: "Agree what is in the MVP and how we measure success." });
    T({ id: "T-2", milestoneId: "M-1", title: "Architecture review", status: "in_progress", departments: ["Engineering"], workers: ["sara"], docIds: ["K-4"],
      description: "Review the system design before the beta. Senior-only task." });
    T({ id: "T-3", milestoneId: "M-1", title: "Set up data pipeline for product catalog", status: "done", departments: ["Engineering"], workers: ["john"], docIds: ["K-2"],
      description: "Import the product catalog nightly into the API database.", scope: "In: import + validation. Out: pricing logic." });
    T({ id: "T-4", milestoneId: "M-1", title: "Build product API", status: "in_progress", departments: ["Engineering"], workers: ["priya"], dependsOn: ["T-3"], docIds: ["K-2"],
      description: "REST API for products, search and auth, used by the onboarding UI." });
    T({ id: "T-10", milestoneId: "M-1", parentId: "T-4", title: "Auth endpoints", status: "done", departments: ["Engineering"], workers: ["priya"] });
    T({ id: "T-11", milestoneId: "M-1", parentId: "T-4", title: "Search endpoint", status: "todo", departments: ["Engineering"], workers: ["priya"] });
    T({ id: "T-5", milestoneId: "M-1", title: "Recommendation model v1", status: "in_progress", departments: ["Engineering"], workers: ["john"], dependsOn: ["T-3"],
      description: "First recommendation model. Serve results through the product API (T-4)." });
    T({ id: "T-6", milestoneId: "M-1", title: "Onboarding UI", status: "todo", departments: ["Engineering"], workers: ["omar"], dependsOn: ["T-4"],
      description: "Sign-up and device pairing screens." });
    T({ id: "T-7", milestoneId: "M-1", title: "Integration tests & CI", status: "todo", departments: ["Engineering"], workers: ["hassan"], dependsOn: ["T-4"],
      description: "End-to-end tests for the product API and a CI pipeline." });
    T({ id: "T-8", milestoneId: "M-2", title: "Beta landing page copy", status: "review", departments: ["Marketing"], workers: ["mia"], docIds: ["K-3"],
      description: "Landing page for beta sign-ups, in the brand voice." });
    T({ id: "T-9", milestoneId: "M-2", title: "Beta customer onboarding kit", status: "todo", departments: ["Marketing", "Engineering"], workers: ["mia", "john"], access: ["tom"], dependsOn: ["T-5"],
      description: "Guide + email sequence for beta customers, including how recommendations work." });
    T({ id: "T-12", milestoneId: "M-2", title: "Pricing research", status: "in_progress", departments: ["Marketing"], workers: ["tom"], access: ["layla"],
      description: "Competitor pricing and willingness-to-pay. Senior-only task." });
    T({ id: "T-13", milestoneId: "M-3", title: "Launch announcement & press kit", status: "todo", departments: ["Marketing"], workers: ["mia"], dependsOn: ["T-8", "T-9"] });
    T({ id: "T-14", milestoneId: "M-3", title: "Load testing", status: "todo", departments: ["Engineering"], workers: ["hassan"], dependsOn: ["T-7"] });

    const up = db.prepare("INSERT INTO task_updates (task_id,user_id,via,agent_name,kind,status_from,status_to,summary,agents_used,cost_usd,links,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const U = (task: string, user: string, via: string, kind: string, from: string | null, to: string | null, summary: string, agents: string[], cost: number, ago: number, links: object[] = []) =>
      up.run(task, user, via, via === "agent" ? `${USERS.find(u => u.id === user)!.name.split(" ")[0]}'s Claude` : null, kind, from, to, summary, JSON.stringify(agents), cost, JSON.stringify(links), minutesAgo(ago));
    U("T-1", "layla", "agent", "completion", "in_progress", "review", "Drafted MVP scope with a **research agent** (competitor features) and a **writer agent** (scope doc). Success metrics: 10 beta customers, <2 s search.", ["research agent", "writer agent"], 0.84, 2900);
    U("T-1", "layla", "ui", "approval", "review", "done", "Approved.", [], 0, 2880);
    U("T-3", "john", "agent", "progress", null, null, "Generated the import script with a **coding agent**; a **test agent** wrote 14 validation tests.", ["coding agent", "test agent"], 1.12, 1500);
    U("T-3", "john", "agent", "completion", "in_progress", "review", "Pipeline runs nightly; 12,480 products imported, 0 validation errors. Used 2 agents (coding, test). Ready for T-4 and T-5.", ["coding agent", "test agent"], 0.63, 1300);
    U("T-3", "sara", "ui", "approval", "review", "done", "Looks good. Approved.", [], 0, 1250);
    U("T-10", "priya", "agent", "completion", "in_progress", "review", "JWT auth endpoints with refresh tokens; 9 tests green.", ["coding agent"], 0.41, 900);
    U("T-10", "sara", "ui", "approval", "review", "done", "Approved.", [], 0, 880);
    U("T-4", "priya", "agent", "progress", null, null, "Product endpoints done (`GET /products`, `GET /products/:id`). Search (T-11) next; T-5 will consume the recommendations endpoint.", ["coding agent", "review agent"], 0.95, 240);
    U("T-5", "john", "agent", "progress", null, null, "Trained a baseline collaborative-filtering model with a **data agent**; offline precision@10 = 0.31. Will expose it through T-4.", ["data agent", "coding agent"], 2.35, 120);
    U("T-2", "sara", "agent", "progress", null, null, "Reviewed service boundaries against the ADRs; flagged the recommendation batch job as the main scaling risk.", ["review agent"], 0.52, 200);
    U("T-12", "tom", "agent", "progress", null, null, "Collected pricing for 6 competitors with a **web research agent**.", ["web research agent"], 0.77, 300);
    U("T-8", "mia", "agent", "progress", null, null, "Wrote 2 headline variants with a **copywriting agent**, ran a quick A/B on the waitlist page.", ["copywriting agent"], 0.38, 180);

    db.prepare("INSERT INTO artifacts (id,task_id,user_id,name,mime,data,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("a1b2c3d4e5f60718", "T-8", "mia", "ab-test-results.svg", "image/svg+xml", Buffer.from(CHART_SVG), minutesAgo(60));
    U("T-8", "mia", "agent", "completion", "in_progress", "review",
      "Final copy ready. Variant **B** won the A/B test (4.2% vs 3.1% sign-up).\n\n![A/B test results](/api/artifacts/a1b2c3d4e5f60718)\n\nUsed a **copywriting agent** for drafts and an **analytics agent** for the test readout.",
      ["copywriting agent", "analytics agent"], 0.56, 55, [{ label: "Landing page draft", url: "https://example.com/northwind-beta" }]);

    for (const u of db.prepare("SELECT id, task_id, summary FROM task_updates").all() as { id: number; task_id: string; summary: string }[])
      extractMentions(db, u.task_id, u.summary, `update:${u.id}`);

    // Agents currently online (the simulator keeps them fresh; they go idle after 60 s without calls).
    const s = db.prepare("INSERT INTO agent_sessions (user_id, agent_name, task_id, activity, started_at, last_seen) VALUES (?,?,?,?,?,?)");
    s.run("john", "John's Claude", "T-5", "Tuning recommendation model hyper-parameters", minutesAgo(20), minutesAgo(0));
    s.run("priya", "Priya's Claude", "T-4", "Implementing search endpoint (T-11)", minutesAgo(35), minutesAgo(0));
    s.run("tom", "Tom's Claude", "T-12", "Comparing competitor price tiers", minutesAgo(10), minutesAgo(0));
  })();
}
