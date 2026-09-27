// MCP endpoint for agents. An agent authenticates with its human's agent key and acts with exactly
// that person's permissions. Every call is a heartbeat for the live view and is audited as via="agent".
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { DB } from "./db.js";
import * as S from "./service.js";
import * as V from "./mcp-view.js";
import { MCP_BROWSER_NOTE } from "./status-page.js";

const report = {
  agents_used: z.array(z.string()).optional().describe("Sub-agents/tools used"),
  cost_usd: z.number().min(0).optional().describe("Estimated USD cost of this step"),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
};
const taskId = z.string().describe("e.g. T-12");

/** Sent once on connect (MCP server instructions). Static on purpose, so clients can cache it. */
export const AGENT_INSTRUCTIONS = `You are the AI agent of one person on an Orchestra project and act with exactly their permissions.
Loop: 1) next_task: brief of your next unlocked task (description, scope, docs inline). 2) start_task with a one-line plan. 3) Do the work; report_progress 1-2 times, each at most 80 words: what you did, which sub-agents/tools, cost_usd estimate; mention related tasks as T-12 to link them. 4) Files: attach_artifact, then embed its markdown. 5) submit_task with the completion report (what, how, results, agents, cost); it completes the task and names your next one. A senior or the PM approves the whole milestone later; never approve anything yourself.
Errors: "Locked (409)" = prerequisites not approved yet, do another task or stop. "Forbidden (403)" = not allowed, tell your human; don't retry around it.
Results omit empty fields. Use get_task, team_board and search_kb only when you need more.`;

const LABEL: Record<number, string> = { 400: "BadRequest", 401: "Unauthorized", 403: "Forbidden", 404: "NotFound", 409: "Locked" };
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { destructiveHint: false, openWorldHint: false } as const;

function buildServer(c: S.Ctx) {
  const server = new McpServer({ name: "orchestra", version: "2.0.0" }, { instructions: AGENT_INSTRUCTIONS });
  const run = (fn: () => unknown) => {
    try {
      S.heartbeat(c);
      return { content: [{ type: "text" as const, text: V.compact(fn()) }] };
    } catch (e) {
      const status = (e as { status?: number }).status;
      return { isError: true, content: [{ type: "text" as const, text: `${status ? `${LABEL[status] ?? "Error"} (${status})` : "Error"}: ${(e as Error).message}` }] };
    }
  };
  const rep = (a: { agents_used?: string[]; cost_usd?: number; links?: { label: string; url: string }[] }, summary: string) =>
    ({ summary, agentsUsed: a.agents_used, costUsd: a.cost_usd, links: a.links });

  server.registerTool("next_task", {
    title: "Next task", annotations: READ,
    description: "Start here. Brief of your suggested next unlocked task (or of task_id): description, scope, prerequisites, docs inline, latest update. Also who you are and what's locked.",
    inputSchema: { task_id: taskId.optional() },
  }, ({ task_id }) => run(() => V.nextTask(c, task_id)));
  server.registerTool("start_task", {
    title: "Start task", annotations: WRITE,
    description: "Mark a task in progress with a one-line plan (shows you live on the board).",
    inputSchema: { task_id: taskId, plan: z.string() },
  }, ({ task_id, plan }) => run(() => V.ack(S.startTask(c, task_id, plan))));
  server.registerTool("report_progress", {
    title: "Report progress", annotations: WRITE,
    description: "Progress update (markdown, max ~80 words): what was done and how.",
    inputSchema: { task_id: taskId, summary: z.string().min(1), ...report },
  }, (a) => run(() => V.ack(S.reportProgress(c, a.task_id, rep(a, a.summary)))));
  server.registerTool("attach_artifact", {
    title: "Attach file", annotations: WRITE,
    description: "Attach a file you produced (base64 or text). Returns a url and markdown to embed.",
    inputSchema: { task_id: taskId, name: z.string(), mime: z.string().describe("e.g. image/png, image/svg+xml, text/markdown"), base64: z.string().optional(), text: z.string().optional() },
  }, (a) => run(() => S.attachArtifact(c, a.task_id, a)));
  server.registerTool("submit_task", {
    title: "Submit for review", annotations: WRITE,
    description: "Finish a task: completion report (markdown: what, how, results, agents, cost). Completes it, unlocks what depends on it, and names your next task.",
    inputSchema: { task_id: taskId, explanation: z.string().min(20), ...report },
  }, (a) => run(() => V.afterSubmit(c, S.submitTask(c, a.task_id, rep(a, a.explanation)))));
  server.registerTool("get_task", {
    title: "Task detail", annotations: READ,
    description: "Any visible task. Default: fields plus counts. include adds history (last history_limit updates, 0 = all), artifacts, links (mentions), subtasks, or all.",
    inputSchema: { task_id: taskId, include: z.array(z.enum(["history", "artifacts", "links", "subtasks", "all"])).optional(), history_limit: z.number().int().min(0).optional() },
  }, ({ task_id, include, history_limit }) => run(() => V.taskDetail(c, task_id, include, history_limit)));
  server.registerTool("team_board", {
    title: "Team board", annotations: READ,
    description: "Tasks you may see, one compact row each, in suggested order. Filters: status, department, person (user id), mine.",
    inputSchema: { status: z.enum(["todo", "in_progress", "review", "done"]).optional(), department: z.string().optional(), person: z.string().optional(), mine: z.boolean().optional() },
  }, (f) => run(() => S.listTasks(c, f).map(V.boardRow)));
  server.registerTool("search_kb", {
    title: "Search knowledge base", annotations: READ,
    description: "Knowledge-base docs you are cleared to read (id, title, excerpt).",
    inputSchema: { query: z.string().optional() },
  }, ({ query }) => run(() => S.listKb(c, query).map(V.kbRow)));
  server.registerTool("read_kb", {
    title: "Read doc", annotations: READ,
    description: "Full knowledge-base doc by id.", inputSchema: { doc_id: z.string() },
  }, ({ doc_id }) => run(() => S.readKb(c, doc_id)));
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
  // A person opening the URL in a browser gets a short explanation instead of a JSON error.
  app.get("/mcp", (req, res) => req.accepts(["html", "json"]) === "html" ? void res.type("html").send(MCP_BROWSER_NOTE) : notAllowed(req, res));
  app.delete("/mcp", notAllowed);
}
