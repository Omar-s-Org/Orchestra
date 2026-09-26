// MCP endpoint for agents. An agent authenticates with its human's agent key and acts with exactly
// that person's permissions. Every call is a heartbeat for the live view and is audited as via="agent".
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { DB } from "./db.js";
import * as S from "./service.js";

const report = {
  agents_used: z.array(z.string()).optional().describe('Sub-agents or tools you used, e.g. ["research agent","image generator"]'),
  cost_usd: z.number().min(0).optional().describe("Approximate cost of this step in USD (model/API usage)"),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional().describe("Links to results (PRs, docs, artifact URLs)"),
};

/** Sent to every agent on connect (MCP server instructions), so any MCP client works correctly without a custom prompt. */
export const AGENT_INSTRUCTIONS = `You are the AI agent of one person on an Orchestra project. You act with exactly their permissions.
How to work:
1. Call next_task first. Work on the task it suggests (or another unlocked task of yours). Never try to start a task with locked: true; it waits for its prerequisites (blocked_by) to be approved. If everything is locked, say so and stop.
2. Call get_task and read its description, scope and linked knowledge-base docs (read_kb) before starting.
3. start_task with a one-line plan.
4. While working, report_progress 1-3 times. The summary is markdown explaining HOW you did it: which sub-agents or tools you used and what each produced. Fill agents_used and cost_usd (your best estimate), and add links to results. Mention related tasks by id (e.g. T-4) to link them.
5. If you produce a file (chart, image, report), attach_artifact and embed the returned markdown in your next summary.
6. submit_task with a completion explanation: what was done, how, results, agents used, cost. It goes to review; only a senior or the PM can mark it done. Never claim a task is done yourself.
Refusals (403/409) are the permission system working: report them to your human, don't retry around them.`;

function buildServer(c: S.Ctx) {
  const server = new McpServer({ name: "orchestra", version: "1.0.0" }, { instructions: AGENT_INSTRUCTIONS });
  const run = (fn: () => unknown) => {
    try {
      S.heartbeat(c);
      return { content: [{ type: "text" as const, text: JSON.stringify(fn(), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
    }
  };
  const rep = (a: { summary: string; agents_used?: string[]; cost_usd?: number; links?: { label: string; url: string }[] }) =>
    ({ summary: a.summary, agentsUsed: a.agents_used, costUsd: a.cost_usd, links: a.links });

  server.registerTool("whoami", { description: "Who you act for: your human's name, role (pm/senior/junior), department, the project, and how to work on tasks." },
    () => run(() => ({ ...S.me(c), how_to_work: AGENT_INSTRUCTIONS })));
  server.registerTool("next_task", { description: "Start here: your suggested next task (prerequisites first, then due date), plus your locked tasks and what they wait on. Suggested order only; any unlocked task may be done first." },
    () => run(() => S.nextTask(c)));
  server.registerTool("list_my_tasks", { description: "Tasks where your human is a worker or has access, in suggested order (field `sequence`). Tasks with `locked: true` wait on prerequisites in `blocked_by` and can't be started yet." },
    () => run(() => S.listTasks(c, { mine: true })));
  server.registerTool("team_board", {
    description: "Every task you are allowed to see (your department at or below your level; the PM sees all). Optional status filter.",
    inputSchema: { status: z.enum(["todo", "in_progress", "review", "done"]).optional() },
  }, ({ status }) => run(() => S.listTasks(c, { status })));
  server.registerTool("get_task", {
    description: "Full task: description, scope, departments, workers, dependencies, linked knowledge-base docs and all previous updates.",
    inputSchema: { task_id: z.string() },
  }, ({ task_id }) => run(() => S.getTask(c, task_id)));
  server.registerTool("start_task", {
    description: "Announce you are starting work on a task (moves todo → in_progress and shows you live on the board). Give a one-line plan. Fails if the task is locked (a prerequisite isn't done yet).",
    inputSchema: { task_id: z.string(), plan: z.string().describe("What you are about to do, one or two sentences") },
  }, ({ task_id, plan }) => run(() => S.startTask(c, task_id, plan)));
  server.registerTool("report_progress", {
    description: "Report progress on a task you work on. Explain in markdown HOW you did it (which sub-agents, what they did), what it cost, and link results. Mention related tasks by id (e.g. T-4) to link them.",
    inputSchema: { task_id: z.string(), summary: z.string().describe("Markdown explanation of what was done and how"), ...report },
  }, (a) => run(() => S.reportProgress(c, a.task_id, rep(a))));
  server.registerTool("attach_artifact", {
    description: "Attach a file you produced (image, report, CSV…) to a task. Returns a url and ready markdown to embed in report_progress or submit_task.",
    inputSchema: { task_id: z.string(), name: z.string(), mime: z.string().describe("e.g. image/png, image/svg+xml, text/markdown"),
      base64: z.string().optional().describe("File content, base64"), text: z.string().optional().describe("Or plain-text content") },
  }, (a) => run(() => S.attachArtifact(c, a.task_id, a)));
  server.registerTool("submit_task", {
    description: "Finish a task: moves it to review for a senior/PM to approve. The explanation must say how the work was done (agents used, decisions, results) and may embed artifacts. You cannot mark tasks done yourself.",
    inputSchema: { task_id: z.string(), explanation: z.string().describe("Markdown completion report"), ...report },
  }, (a) => run(() => S.submitTask(c, a.task_id, { summary: a.explanation, agentsUsed: a.agents_used, costUsd: a.cost_usd, links: a.links })));
  server.registerTool("search_kb", {
    description: "Search the shared knowledge base (only documents your human is cleared to read).",
    inputSchema: { query: z.string().optional() },
  }, ({ query }) => run(() => S.listKb(c, query)));
  server.registerTool("read_kb", { description: "Read a knowledge-base document by id.", inputSchema: { doc_id: z.string() } },
    ({ doc_id }) => run(() => S.readKb(c, doc_id)));
  return server;
}

export function mountMcp(app: Express, db: DB) {
  // Stateless Streamable HTTP: a fresh server per request, bound to the caller's identity.
  app.post("/mcp", async (req: Request, res: Response) => {
    const key = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const user = key ? S.userByAgentKey(db, key) : undefined;
    if (!user) return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid agent key" }, id: null });
    const server = buildServer({ db, user, via: "agent", agentName: req.header("x-agent-name") || undefined });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: Request, res: Response) => void res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
