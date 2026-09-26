// End-to-end self-test of a running server, over HTTP and MCP exactly like the UI and agents use it.
// Used by the "Self-test" button on the status page (POST /api/demo/selftest) and by
// `npm run smoke -- --url <server>`. It RESETS the data: loads Lumen, lets the 4 simulated agents
// work at full speed, approves each wave as the senior, then loads Northwind again.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runChecks, accountsFor } from "./check.js";

export type Step = { name: string; ok: boolean; detail?: string; ms: number };
export const MCP_TOOLS = ["next_task", "start_task", "report_progress", "attach_artifact", "submit_task", "get_task", "team_board", "search_kb", "read_kb"];

export async function runSelfTest(baseUrl: string, opts: { password?: string; timeoutMs?: number } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  const password = opts.password ?? "demo1234";
  const steps: Step[] = [];
  const step = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now();
    try { steps.push({ name, ok: true, detail: (await fn()) || undefined, ms: Date.now() - t0 }); return true; }
    catch (e) { steps.push({ name, ok: false, detail: (e as Error).message, ms: Date.now() - t0 }); return false; }
  };
  const call = async (path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => null) as any;
    return { status: r.status, data };
  };
  const login = async (email: string) => {
    const r = await call("/api/auth/login", undefined, { email, password });
    if (r.status !== 200) throw new Error(`login ${email}: HTTP ${r.status}`);
    return r.data.token as string;
  };
  const must = (r: { status: number; data: any }, what: string) => { if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.data?.error ?? ""}`); return r.data; };

  const healthy = await step("Backend is up (/api/health)", async () => { must(await call("/api/health"), "health"); });
  if (!healthy) return { ok: false, steps };

  let pm = "", senior = "", junior = "";
  const loaded = await step("Load the Lumen demo project", async () => {
    const before = await login((await accountsFor(base, password)).pm);
    must(await call("/api/demo/load", before, { project: "lumen" }), "load lumen");
    const a = await accountsFor(base, password);
    [pm, senior, junior] = [await login(a.pm), await login(a.senior), await login(a.junior)];
    return `logged in as ${a.pm}, ${a.senior}, ${a.junior}`;
  });
  if (!loaded) return { ok: false, steps };

  await step("Frontend contract: every endpoint and role rule the UI relies on", async () => {
    const res = await runChecks(base, await accountsFor(base, password));
    const failed = res.filter(r => !r.ok);
    if (failed.length) throw new Error(`${failed.length}/${res.length} failed: ${failed.slice(0, 3).map(f => `${f.name} (${f.detail ?? ""})`).join("; ")}`);
    return `${res.length} checks passed`;
  });

  await step("MCP: an agent connects and sees the v2 tools", async () => {
    const key = must(await call("/api/me/agent-key", junior), "agent key").agent_key as string;
    const client = new Client({ name: "selftest", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    try {
      const names = (await client.listTools()).tools.map(t => t.name).sort();
      const missing = MCP_TOOLS.filter(t => !names.includes(t));
      if (missing.length || names.length !== MCP_TOOLS.length) throw new Error(`tools: ${names.join(", ")}`);
      return `${names.length} tools`;
    } finally { await client.close(); }
  });

  await step("Four agents finish the beta milestone; a human approves each wave", async () => {
    must(await call("/api/demo/run", pm, { project: "lumen", speed: 0 }), "run demo");
    const end = Date.now() + (opts.timeoutMs ?? 90_000);
    let juniorChecked = false, approved = 0;
    while (Date.now() < end) {
      const s = must(await call("/api/demo/status", pm), "status");
      for (const w of s.waiting_for_approval as { id: string }[]) {
        if (!juniorChecked) {
          const r = await call(`/api/tasks/${w.id}/approve`, junior, {});
          if (r.status !== 403) throw new Error(`a junior could approve ${w.id} (HTTP ${r.status})`);
          juniorChecked = true;
        }
        const r = await call(`/api/tasks/${w.id}/approve`, senior, {});
        if (r.status !== 200) must(await call(`/api/tasks/${w.id}/approve`, pm, {}), `approve ${w.id}`);
        approved++;
      }
      if (!s.running) {
        if (!String(s.end_reason).startsWith("complete")) throw new Error(`demo ended: ${s.end_reason}`);
        return `${s.progress.done}/${s.progress.total} tasks done, ${approved} approvals, junior approval refused`;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    await call("/api/demo/stop", pm, {});
    throw new Error("timed out");
  });

  await step("Put the Northwind demo back", async () => {
    must(await call("/api/demo/load", pm, { project: "northwind" }), "load northwind");
  });

  return { ok: steps.every(s => s.ok), steps };
}

export function formatSelfTest(r: { ok: boolean; steps: Step[] }) {
  return [...r.steps.map(s => `${s.ok ? "PASS" : "FAIL"}  ${s.name}  (${(s.ms / 1000).toFixed(1)} s)${s.detail ? `  →  ${s.detail}` : ""}`),
    "", r.ok ? "Everything works." : "Self-test FAILED."].join("\n");
}
