// Simulated team members. Each one is a real MCP client (same /mcp endpoint and tools as Claude Code)
// that works its tasks the way a person's agent would: start → report progress → attach a chart → submit.
// Who they are comes from the project file; what they say comes from sim/stories/<project>.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateProject, DEFAULT_PROJECT, type ProjectFile } from "../src/project-file.js";
import { chartSvg, type Chart } from "./chart.js";

type Link = { label: string; url: string };
type Step = { summary: string; agents_used?: string[]; cost_usd?: number; links?: Link[] };
export type Story = {
  plan: string;
  progress: Step[];
  artifact?: { name: string; chart: Chart };
  completion: { explanation: string; agents_used?: string[]; cost_usd?: number; links?: Link[] }; // "{{artifact}}" embeds the chart
};
type Person = ProjectFile["people"][number];
type TaskInfo = { id: string; title: string; status: string; parent?: string; locked?: boolean; blocked_by?: string[] };
type Brief = { id: string; title: string; status: string; docs?: { id: string; truncated?: boolean }[] };

export type SimOptions = {
  baseUrl: string;             // e.g. http://localhost:8787 or the Railway URL
  projectFile?: string;        // defaults to the Northwind demo
  people?: string[];           // person ids to simulate; default: everyone who has a story
  handsOff?: string[];         // task ids the simulator must never touch (a real agent does them)
  speed?: number;              // delay multiplier: 1 = 3–6 s between steps, 0 = no delays (tests)
  reset?: boolean;             // reset the demo data first (logs in as the PM)
  loop?: boolean;              // stay online after the work is done: heartbeat, and pick up tasks again after a reset
  heartbeatMs?: number;        // how often a looping agent checks in (default 30 s; the live view drops agents after 60 s)
  signal?: AbortSignal;        // stops a looping run (Ctrl+C in run.ts)
  log?: (line: string) => void;
};

/** setTimeout that ends early (without throwing) when the run is stopped. */
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
  signal?.addEventListener("abort", done);
});

const SIM_DIR = path.dirname(fileURLToPath(import.meta.url));
const firstName = (p: Person) => p.name.split(" ")[0];
const emailOf = (p: Person) => p.email ?? `${p.id}@example.test`;

export function loadStories(projectFile: string): Record<string, Story> {
  const file = path.join(SIM_DIR, "stories", path.basename(projectFile));
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

/** Used for tasks without a written story, so the simulator works with any project file. */
export function genericStory(t: { id: string; title: string }): Story {
  return {
    plan: `Picking up "${t.title}": reading the task and its linked docs, then working through it with sub-agents.`,
    progress: [
      { summary: `A **research agent** reviewed the requirements for ${t.id} and the linked knowledge-base docs; a **planning agent** split the work into 3 steps.`, agents_used: ["research agent", "planning agent"], cost_usd: 0.42 },
      { summary: `A **coding agent** completed the main work for ${t.id}; a **review agent** checked it against the task scope.`, agents_used: ["coding agent", "review agent"], cost_usd: 0.88 },
    ],
    artifact: { name: `${t.id.toLowerCase()}-progress.svg`, chart: { title: `${t.id}: work completed per step`, unit: "%", bars: [{ label: "Research", value: 30 }, { label: "Build", value: 55 }, { label: "Review", value: 15 }] } },
    completion: {
      explanation: `"${t.title}" is done.\n\n{{artifact}}\n\nResearch, planning, coding and review agents each handled one step; the result was checked against the task scope.`,
      agents_used: ["research agent", "planning agent", "coding agent", "review agent"], cost_usd: 0.31,
    },
  };
}

async function login(baseUrl: string, p: Person) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailOf(p), password: p.password ?? "demo1234" }),
  });
  if (!r.ok) throw new Error(`login as ${p.id} failed (${r.status})`);
  return ((await r.json()) as { token: string }).token;
}

/** ak_<id> by default; when the server issues random keys (AGENT_KEYS=random), log in and fetch the person's key. */
async function agentKey(baseUrl: string, p: Person) {
  const guess = p.agent_key ?? `ak_${p.id}`;
  const probe = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${guess}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
  });
  if (probe.status !== 401) return guess;
  const r = await fetch(`${baseUrl}/api/me/agent-key`, { headers: { Authorization: `Bearer ${await login(baseUrl, p)}` } });
  if (!r.ok) throw new Error(`could not fetch the agent key for ${p.id} (${r.status})`);
  return ((await r.json()) as { agent_key: string }).agent_key;
}

/** Subtasks before their parents, then work already in progress, then new work. */
const workOrder = (a: TaskInfo, b: TaskInfo) =>
  Number(!a.parent) - Number(!b.parent) || Number(a.status !== "in_progress") - Number(b.status !== "in_progress");

type AgentOptions = { baseUrl: string; speed: number; log: (line: string) => void; loop: boolean; heartbeatMs: number; signal?: AbortSignal };

async function runAgent(o: AgentOptions, p: Person, owned: Set<string>, stories: Record<string, Story>, startDelay: number) {
  const name = `${firstName(p)}'s Claude`;
  const log = (msg: string) => o.log(`[${name}] ${msg}`);
  const pause = (min = 3000, max = 6000) => sleep((min + Math.random() * (max - min)) * o.speed, o.signal);
  await sleep(startDelay * o.speed, o.signal);

  const client = new Client({ name: "orchestra-sim", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${o.baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${await agentKey(o.baseUrl, p)}`, "X-Agent-Name": name } },
  }));
  const call = async <T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> => {
    const r = await client.callTool({ name: tool, arguments: args }) as { isError?: boolean; content: { text: string }[] };
    const text = r.content[0]?.text ?? "";
    if (r.isError) throw new Error(text.replace(/^Error:\s*/, ""));
    return JSON.parse(text) as T;
  };
  // Locked tasks wait until their prerequisites are approved (the server would refuse them anyway).
  // Each wait is logged once; in --loop mode the agent picks the task up as soon as it unlocks.
  const announced = new Set<string>();
  const openTasks = async () => {
    const open = (await call<TaskInfo[]>("team_board", { mine: true }))
      .filter(t => owned.has(t.id) && (t.status === "todo" || t.status === "in_progress"));
    for (const t of open.filter(t => t.locked && !announced.has(t.id))) {
      announced.add(t.id);
      log(`${t.id} waiting: locked until ${(t.blocked_by ?? []).join(", ")} is done`);
    }
    return open.filter(t => !t.locked).sort(workOrder);
  };

  async function workOpenTasks(queue: TaskInfo[]) {
    let done = 0;
    for (const { id } of queue) {
      if (o.signal?.aborted) break;
      try {
        // One read gives the whole brief (docs inline); read_kb only for a doc too long to inline.
        const { task } = await call<{ task: Brief }>("next_task", { task_id: id });
        if (task.status !== "todo" && task.status !== "in_progress") continue;
        const story = stories[id] ?? genericStory(task);
        const long = task.docs?.find(d => d.truncated);
        if (long) await call("read_kb", { doc_id: long.id });

        await call("start_task", { task_id: id, plan: story.plan });
        log(`${id} started: ${task.title}`);
        await pause();
        for (const step of story.progress) {
          await call("report_progress", { task_id: id, ...step });
          log(`${id} progress: ${step.summary.slice(0, 80)}…`);
          await pause();
        }
        let embed = "";
        if (story.artifact) {
          const a = await call<{ url: string; markdown: string }>("attach_artifact", { task_id: id, name: story.artifact.name, mime: "image/svg+xml", text: chartSvg(story.artifact.chart) });
          embed = a.markdown;
          log(`${id} attached ${story.artifact.name} → ${a.url}`);
          await pause(1500, 3000);
        }
        const { explanation, ...rest } = story.completion;
        await call("submit_task", { task_id: id, explanation: explanation.replace("{{artifact}}", embed).replace(/\n{3,}/g, "\n\n").trim(), ...rest });
        log(`${id} completed`);
        done++;
        await pause();
      } catch (e) {
        log(`${id} skipped: ${(e as Error).message}`);
      }
    }
    return done;
  }

  const first = await openTasks();
  if (!first.length) log(o.loop ? "nothing to do yet; staying online" : "nothing to do right now (tasks are locked or done; reset the demo to start over)");
  let done = await workOpenTasks(first);

  // --loop: every call is a heartbeat, so checking for work every ~30 s keeps the agent green in the live rail.
  // New work shows up when a prerequisite gets approved (task unlocks) or after a "Reset demo".
  if (o.loop) {
    while (!o.signal?.aborted) {
      await sleep(o.heartbeatMs, o.signal);
      if (o.signal?.aborted) break;
      try {
        const queue = await openTasks();
        if (queue.length) { log(`${queue.length} task(s) ready (unlocked or demo reset); back to work`); done += await workOpenTasks(queue); }
      } catch (e) {
        log(`heartbeat failed, retrying: ${(e as Error).message}`); // e.g. the server restarted
      }
    }
    log("going offline");
  }
  await client.close();
  return done;
}

export async function runSim(opts: SimOptions) {
  const o: AgentOptions = {
    baseUrl: opts.baseUrl.replace(/\/+$/, ""), speed: opts.speed ?? 1, log: opts.log ?? console.log,
    loop: opts.loop ?? false, heartbeatMs: opts.heartbeatMs ?? 30_000, signal: opts.signal,
  };
  const projectFile = opts.projectFile ?? DEFAULT_PROJECT;
  const project = validateProject(JSON.parse(fs.readFileSync(projectFile, "utf8")));
  const stories = loadStories(projectFile);
  const person = new Map(project.people.map(p => [p.id, p]));

  // Default cast: whoever the story file writes for; without stories, every junior.
  const storyTasks = project.tasks.filter(t => stories[t.id]);
  const cast = opts.people?.length ? opts.people
    : storyTasks.length ? [...new Set(storyTasks.map(t => t.workers[0]).filter(Boolean))]
    : project.people.filter(p => p.role === "junior").map(p => p.id);
  const unknown = cast.filter(id => !person.has(id));
  if (unknown.length) throw new Error(`unknown people: ${unknown.join(", ")}`);

  // A task with several workers is driven by the first simulated worker, so two agents never race on it.
  const owned = new Map(cast.map(id => [id, new Set<string>()]));
  const handsOff = new Set(opts.handsOff ?? []);
  for (const t of project.tasks) {
    if (handsOff.has(t.id)) continue;
    const driver = t.workers.find(w => owned.has(w));
    if (driver) owned.get(driver)!.add(t.id);
  }

  if (opts.reset) {
    const pm = project.people.find(p => p.role === "pm")!;
    const r = await fetch(`${o.baseUrl}/api/demo/reset`, { method: "POST", headers: { Authorization: `Bearer ${await login(o.baseUrl, pm)}` } });
    if (!r.ok) throw new Error(`reset failed (${r.status})`);
    o.log(`Demo data reset (as ${pm.name}).`);
  }

  o.log(`Simulating ${cast.map(id => person.get(id)!.name).join(", ")} against ${o.baseUrl}/mcp${o.loop ? " (--loop: agents stay online; Ctrl+C to stop)" : ""}`);
  const results = await Promise.all(cast.map((id, i) => runAgent(o, person.get(id)!, owned.get(id)!, stories, i * 1500)));
  const submitted = results.reduce((a, b) => a + b, 0);
  o.log(`Done: ${submitted} task(s) completed. When a milestone is finished, a senior or the PM approves it in the UI.`);
  return { submitted };
}
