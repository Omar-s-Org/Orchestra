// GET / on the backend: what's deployed, what's loaded, and one-click test controls.
// The buttons sign in as the loaded project's PM with the public demo password and call the
// existing PM-only demo endpoints, so the page adds no new permissions.
import type { DB } from "./db.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function statusPage(db: DB, baseUrl: string, cast: { id: string; name: string }[] = []) {
  const project = db.prepare("SELECT name, description FROM projects LIMIT 1").get() as { name: string; description: string } | undefined;
  const counts = Object.fromEntries((db.prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all() as { status: string; n: number }[]).map(r => [r.status, r.n]));
  const commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7);
  const host = process.env.RAILWAY_PUBLIC_DOMAIN ? "Railway" : process.env.RENDER ? "Render" : "local";
  const app = process.env.FRONTEND_URL;
  const tasks = ["todo", "in_progress", "done"].map(s => `${counts[s] ?? 0} ${s.replace("_", " ")}`).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orchestra API</title><style>
:root{--bg:#f8fafc;--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--ok:#16a34a;--bad:#dc2626;--acc:#059669}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--ink:#e5e7eb;--mute:#94a3b8;--line:#1f2937}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:760px;margin:0 auto;padding:32px 16px}h1{margin:0 0 4px;font-size:24px}h2{font-size:15px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
.mute{color:var(--mute)}.ok{color:var(--ok)}.bad{color:var(--bad)}code{background:var(--line);padding:1px 5px;border-radius:5px;font-size:13px}
dl{display:grid;grid-template-columns:140px 1fr;gap:4px 12px;margin:0}dt{color:var(--mute)}dd{margin:0;overflow-wrap:anywhere}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:8px 12px;cursor:pointer;margin:0 6px 6px 0}
button.primary{background:var(--acc);border-color:var(--acc);color:#fff}button:disabled{opacity:.5;cursor:wait}
a{color:var(--acc)}#out{white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace;margin:10px 0 0}.big{font-size:17px}
</style></head><body><main>
<h1>Orchestra API <span class="ok">● up</span></h1>
<p class="mute">This is the backend. ${app ? `The app is at <a class="big" href="${esc(app)}">${esc(app)}</a>.` : "The web app runs separately (see README → Frontend)."}</p>
<div class="card"><h2>Deployed</h2><dl>
<dt>Host · commit</dt><dd>${host} · <code>${esc(commit)}</code></dd>
<dt>Project loaded</dt><dd><b>${esc(project?.name ?? "none")}</b> · ${tasks}</dd>
<dt>REST API</dt><dd><code>${esc(baseUrl)}/api</code> (<a href="/api/health">health</a>, <a href="/api/demo/accounts">accounts</a>)</dd>
<dt>Agents (MCP)</dt><dd><code>${esc(baseUrl)}/mcp</code> · <span id="tools" class="mute">checking tools…</span></dd>
<dt>Demo</dt><dd id="demo" class="mute">…</dd></dl></div>
<div class="card"><h2>Test controls</h2>
<button class="primary" data-act="load" data-project="northwind">Load Northwind</button>
<button class="primary" data-act="run">Run Lumen demo (4 agents)</button>
<button data-act="stop">Stop demo</button>
<div style="margin:4px 0 8px" class="mute">Real agents (the simulator leaves their tasks alone, so their own Claude Code works them over MCP):
${cast.map(c => `<label style="margin-right:12px;white-space:nowrap"><input type="checkbox" name="real" value="${esc(c.id)}"> ${esc(c.name)}</label>`).join("")}</div>
<button data-act="selftest">Self-test (≈10 s)</button>
<p class="mute" style="margin:6px 0 0">Load and Run replace the shared demo data. Self-test runs the whole demo at full speed and checks every step, then loads Northwind again. Run it on the backup server during a live demo.</p>
<div id="out"></div></div>
<div class="card"><h2>Sign in to the app</h2><p class="mute" style="margin:0">Every demo account uses the password <code>demo1234</code>. The app's login page lists them.</p></div>
</main><script>
const out = document.getElementById("out"), say = t => out.textContent = t;
const api = async (path, token, body) => { const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || "HTTP " + r.status); return d; };
// Sign in once and reuse the session (a new login per refresh would pile up sessions and cost CPU).
let token = null;
const pmToken = async (fresh) => {
  if (token && !fresh) return token;
  const pm = (await api("/api/demo/accounts")).find(a => a.role === "pm");
  return token = (await api("/api/auth/login", null, { email: pm.email, password: "demo1234" })).token;
};
const withPm = async fn => { try { return await fn(await pmToken()); } catch (e) { if (!/401|session/i.test(e.message)) throw e; return fn(await pmToken(true)); } };
let toolsShown = false;
async function refresh() {
  try {
    const s = await withPm(t => api("/api/demo/status", t));
    document.getElementById("demo").innerHTML = s.running ? '<b class="ok">running</b> · ' + s.progress.done + "/" + s.progress.total + " done" + (s.waiting_for_approval.length ? " · waiting for approval: " + s.waiting_for_approval.map(w => w.id).join(", ") : "")
      : s.end_reason ? "last run: " + s.end_reason : "not running";
    if (toolsShown) return;
    const key = (await withPm(t => api("/api/me/agent-key", t))).agent_key;
    const r = await fetch("/mcp", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const tools = (await r.json()).result.tools.map(x => x.name);
    document.getElementById("tools").textContent = tools.length + " tools: " + tools.join(", ");
    toolsShown = true;
  } catch (e) { document.getElementById("demo").textContent = "status unavailable: " + e.message; }
}
document.querySelectorAll("button").forEach(b => b.onclick = async () => {
  const act = b.dataset.act;
  if (act !== "stop" && !confirm(act === "selftest" ? "Self-test resets the demo data and takes about 10 seconds. Continue?" : "This replaces the demo data for everyone. Continue?")) return;
  document.querySelectorAll("button").forEach(x => x.disabled = true);
  say(act === "selftest" ? "Running self-test…" : "Working…");
  try {
    const t = await withPm(async t => { await api("/api/demo/status", t); return t; });
    if (act === "load") { const r = await api("/api/demo/load", t, { project: b.dataset.project }); say("Loaded " + r.loaded.project + ": " + r.loaded.tasks + " tasks, " + r.loaded.people + " people."); }
    if (act === "run") {
      const real = [...document.querySelectorAll('input[name="real"]:checked')].map(x => x.value);
      await api("/api/demo/run", t, { project: "lumen", real });
      say("Lumen demo started" + (real.length ? " with real agents for: " + real.join(", ") + ". Their tasks wait for their own Claude Code." : ".") + " The team works through the milestone by itself; when it is done, sign in to the app as the PM (layla@lumen.test) or Sara and approve the milestone in Review.");
    }
    if (act === "stop") { await api("/api/demo/stop", t, {}); say("Demo stopped."); }
    if (act === "selftest") { const r = await api("/api/demo/selftest", t, {}); say(r.steps.map(s => (s.ok ? "✓ " : "✗ ") + s.name + " (" + (s.ms / 1000).toFixed(1) + " s)" + (s.detail ? "\\n    " + s.detail : "")).join("\\n") + "\\n\\n" + (r.ok ? "Everything works." : "Self-test FAILED.")); }
  } catch (e) { say("Error: " + e.message); }
  document.querySelectorAll("button").forEach(x => x.disabled = false);
  refresh();
});
refresh(); setInterval(refresh, 5000);
</script></body></html>`;
}

export const MCP_BROWSER_NOTE = `<!doctype html><meta charset="utf-8"><title>Orchestra MCP</title>
<body style="font:15px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px">
<h1>Orchestra MCP endpoint</h1><p>This URL is for AI agents (Claude Code or any MCP client), not browsers. Connect with:</p>
<pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px">claude mcp add --transport http orchestra &lt;this URL&gt; --header "Authorization: Bearer &lt;your agent key&gt;"</pre>
<p>Your agent key is in the app's user menu → Connect your agent. <a href="/">Back to the status page</a>.</p></body>`;
