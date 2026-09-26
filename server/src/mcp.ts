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

function buildServer(c: S.Ctx) {
  const server = new McpServer({ name: "orchestra", version: "1.0.0" });
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

  server.registerTool("whoami", { description: "Who you act for: your human's name, role (pm/senior/junior), department and the project." },
    () => run(() => S.me(c)));
  server.registerTool("list_my_tasks", { description: "Tasks where your human is a worker or has access. Start here." },
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
    description: "Announce you are starting work on a task (moves todo → in_progress and shows you live on the board). Give a one-line plan.",
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
