// Contract checker: logs in as the PM, a senior and a junior, calls every endpoint the frontend uses,
// validates each response against src/contract.ts, and checks role rules. Only GETs plus logins (no writes),
// so it is safe to run against the hosted demo.
import type { ZodType } from "zod";
import * as C from "./contract.js";

export type CheckResult = { name: string; ok: boolean; detail?: string };
type Accounts = { pm: string; senior: string; junior: string; password: string };
const DEFAULT_ACCOUNTS: Accounts = { pm: "layla@northwind.test", senior: "sara@northwind.test", junior: "john@northwind.test", password: "demo1234" };

/** The PM, first senior and first junior of whichever project the server has loaded (Northwind, Lumen…). */
export async function accountsFor(baseUrl: string, password = "demo1234"): Promise<Accounts> {
  try {
    const list = await (await fetch(`${baseUrl.replace(/\/+$/, "")}/api/demo/accounts`)).json() as { email: string; role: string }[];
    const by = (role: string) => list.find(a => a.role === role)?.email;
    const pm = by("pm"), senior = by("senior"), junior = by("junior");
    if (pm && senior && junior) return { pm, senior, junior, password };
  } catch { /* older server: fall back to the Northwind accounts */ }
  return DEFAULT_ACCOUNTS;
}

export async function runChecks(baseUrl: string, given?: Accounts): Promise<CheckResult[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const accounts = given ?? await accountsFor(base);
  const results: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail });

  async function call(path: string, token?: string, init: RequestInit = {}) {
    const r = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body, type: r.headers.get("content-type") ?? "" };
  }
  /** Status + schema check; returns the parsed body (or undefined) so later checks can build on it. */
  async function expect<T>(name: string, path: string, schema: ZodType<T>, token?: string, init?: RequestInit): Promise<T | undefined> {
    try {
      const r = await call(path, token, init);
      if (r.status !== 200) { record(name, false, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); return undefined; }
      const p = schema.safeParse(r.body);
      if (!p.success) { record(name, false, p.error.issues.slice(0, 3).map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")); return undefined; }
      record(name, true);
      return p.data;
    } catch (e) { record(name, false, (e as Error).message); return undefined; }
  }
  async function expectStatus(name: string, path: string, status: number, token?: string, init?: RequestInit) {
    try {
      const r = await call(path, token, init);
      const errShape = status >= 400 ? C.ApiError.safeParse(r.body).success : true;
      record(name, r.status === status && errShape, r.status === status ? (errShape ? undefined : "error body is not { error }") : `expected ${status}, got ${r.status}`);
    } catch (e) { record(name, false, (e as Error).message); }
  }
  const login = (email: string) => expect(`login ${email}`, "/api/auth/login", C.Login, undefined, { method: "POST", body: JSON.stringify({ email, password: accounts.password }) });

  await expect("health", "/api/health", C.Ok);
  await expectStatus("login with a wrong password → 401", "/api/auth/login", 401, undefined, { method: "POST", body: JSON.stringify({ email: accounts.pm, password: "wrong-password" }) });
  await expectStatus("no token → 401", "/api/me", 401);

  const pm = (await login(accounts.pm))?.token, senior = (await login(accounts.senior))?.token, junior = (await login(accounts.junior))?.token;
  if (!pm || !senior || !junior) return results;

  // me + capabilities per role
  const caps = async (who: string, t: string, want: { graph: boolean; review: boolean; cost: boolean }) => {
    const me = await expect(`me (${who})`, "/api/me", C.Me, t);
    if (me) record(`capabilities (${who})`, JSON.stringify(me.capabilities) === JSON.stringify(want), JSON.stringify(me.capabilities));
  };
  await caps("pm", pm, { graph: true, review: true, cost: true });
  await caps("senior", senior, { graph: false, review: true, cost: true });
  await caps("junior", junior, { graph: false, review: false, cost: false });
  await expect("me/agent-key", "/api/me/agent-key", C.AgentKey, junior);

  // tasks: list, filters, detail
  const all = await expect("tasks (pm)", "/api/tasks", C.TaskSummary.array(), pm);
  const mine = await expect("tasks?mine=true (junior)", "/api/tasks?mine=true", C.TaskSummary.array(), junior);
  await expect("tasks?status=todo", "/api/tasks?status=todo", C.TaskSummary.array(), pm);
  await expect("tasks?department=Engineering", "/api/tasks?department=Engineering", C.TaskSummary.array(), pm);

  const jrAll = await expect("tasks (junior)", "/api/tasks", C.TaskSummary.array(), junior);
  if (all) {
    const seq = all.map(t => t.sequence ?? Infinity);
    record("tasks come back in suggested order", seq.every((s, i) => i === 0 || seq[i - 1] <= s));
    record("locked tasks list their blockers", all.every(t => t.locked === t.blocked_by.length > 0 || t.status === "done"));
    const first = all[0];
    if (first) await expect(`task detail ${first.id}`, `/api/tasks/${first.id}`, C.TaskDetail, pm);
    // Only meaningful if the junior's own list loaded; otherwise every task would look hidden.
    const hidden = jrAll ? all.find(t => !jrAll.some(j => j.id === t.id)) : undefined;
    if (hidden) await expectStatus(`task hidden from junior → 404 (${hidden.id})`, `/api/tasks/${hidden.id}`, 404, junior);
  }
  // Company view (LOVABLE_PLAN §11): one person's in-progress work, using someone who has some.
  const busy = all?.find(t => t.status === "in_progress" && t.workers.length)?.workers[0];
  if (busy) {
    const q = `/api/tasks?person=${encodeURIComponent(busy.id)}&status=in_progress`;
    const byPerson = await expect(`tasks?person=${busy.id}&status=in_progress (company view)`, q, C.TaskSummary.array(), pm);
    if (byPerson) record("person filter returns only that person's in-progress tasks",
      byPerson.length > 0 && byPerson.every(t => t.status === "in_progress" && [...t.workers, ...t.access].some(u => u.id === busy.id)));
  }
  if (mine && jrAll) record("junior: mine ⊆ visible", mine.every(m => jrAll.some(j => j.id === m.id)));
  if (jrAll) record("junior: no approve/reopen buttons", jrAll.every(t => t.allowed_actions.length === 0));

  // feeds, live, overview, kb
  await expect("activity", "/api/activity?limit=20", C.Update.array(), pm);
  await expect("activity?via=agent&kind=completion", "/api/activity?via=agent&kind=completion", C.Update.array(), pm);
  await expect("agents/live", "/api/agents/live", C.LiveAgent.array(), pm);
  const ov = await expect("overview (pm)", "/api/overview", C.Overview, pm);
  const ovJr = await expect("overview (junior)", "/api/overview", C.Overview, junior);
  if (ovJr) record("junior: no cost, no review queue", ovJr.cost === null && ovJr.review_queue.length === 0);
  const art = ov?.review_queue.flatMap(r => r.artifacts)[0];
  if (art) {
    try {
      const r = await call(`${art.url}?token=${encodeURIComponent(pm)}`);
      record("artifact loads via ?token=", r.status === 200 && r.type.startsWith(art.mime.split(";")[0]), `HTTP ${r.status} ${r.type}`);
    } catch (e) { record("artifact loads via ?token=", false, (e as Error).message); }
  }
  await expect("graph (pm)", "/api/graph", C.Graph, pm);
  await expectStatus("graph (senior) → 403", "/api/graph", 403, senior);
  await expectStatus("graph (junior) → 403", "/api/graph", 403, junior);
  const kb = await expect("kb (junior)", "/api/kb", C.KbListItem.array(), junior);
  if (kb?.[0]) await expect(`kb detail ${kb[0].id}`, `/api/kb/${kb[0].id}`, C.KbDoc, junior);
  const kbPm = await expect("kb (pm)", "/api/kb", C.KbListItem.array(), pm);
  const pmOnly = kbPm?.find(d => d.min_role === "pm");
  if (pmOnly) await expectStatus(`kb PM-only doc (junior) → 403 (${pmOnly.id})`, `/api/kb/${pmOnly.id}`, 403, junior);
  await expect("demo/accounts (public)", "/api/demo/accounts", C.DemoAccount.array());
  await expect("demo/status", "/api/demo/status", C.DemoStatus, junior);
  // Deliberately no POST /api/demo/run, /stop or /reset probes (they change data).
  // Deliberately no POST /api/demo/reset probe: if its PM check ever regressed, this read-only checker
  // would wipe the hosted demo. test/api.test.ts covers reset permissions instead.
  return results;
}

export function formatResults(results: CheckResult[]) {
  const lines = results.map(r => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  →  ${r.detail}` : ""}`);
  const failed = results.filter(r => !r.ok).length;
  lines.push("", failed ? `${failed} of ${results.length} checks FAILED` : `All ${results.length} checks passed`);
  return lines.join("\n");
}
