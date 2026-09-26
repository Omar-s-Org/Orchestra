// MCP endpoint for agents. Each agent authenticates with its human's bearer token and
// acts strictly with that human's permissions; every call is audited with via="agent".
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { DB } from "./db.js";
import * as S from "./service.js";

const STATUSES = ["todo", "in_progress", "blocked", "review", "done"] as const;

function buildServer(c: S.Ctx) {
  const server = new McpServer({ name: "orchestra", version: "0.1.0" });
  const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const run = (fn: () => unknown) => {
    try { return ok(fn()); }
    catch (e) { return { isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] }; }
  };

  server.registerTool("whoami", { description: "Who you are acting for, their role, and their projects." }, () => run(() => S.me(c)));
  server.registerTool("list_my_tasks", {
    description: "Tasks assigned to your human. Use include_visible=true to list every task you are allowed to see.",
    inputSchema: { include_visible: z.boolean().optional() },
  }, ({ include_visible }) => run(() => S.listTasks(c, { mine: !include_visible })));
  server.registerTool("get_task", {
    description: "Full task: description, status, subtasks, comments, and its scope (documents you may read, people you may contact).",
    inputSchema: { task_id: z.string() },
  }, ({ task_id }) => run(() => S.getTask(c, task_id)));
  server.registerTool("update_task_status", {
    description: "Change a task's status. Workers move tasks todo→in_progress→review (or blocked). Only the task lead or a manager can mark done. Add a short note explaining the change.",
    inputSchema: { task_id: z.string(), status: z.enum(STATUSES), note: z.string().optional() },
  }, ({ task_id, status, note }) => run(() => S.setStatus(c, task_id, status, note)));
  server.registerTool("add_comment", {
    description: "Post a progress comment on a task (findings, blockers, links).",
    inputSchema: { task_id: z.string(), body: z.string() },
  }, ({ task_id, body }) => run(() => S.addComment(c, task_id, body)));
  server.registerTool("create_subtask", {
    description: "Break a task you hold into a subtask.",
    inputSchema: { parent_task_id: z.string(), title: z.string(), description: z.string().optional() },
  }, ({ parent_task_id, title, description }) => run(() => S.createTask(c, { parentId: parent_task_id, title, description })));
  server.registerTool("search_documents", {
    description: "Search the knowledge base. Only returns documents your human is cleared and scoped to read.",
    inputSchema: { query: z.string().optional() },
  }, ({ query }) => run(() => S.listDocuments(c, query)));
  server.registerTool("read_document", {
    description: "Read a knowledge-base document by id.",
    inputSchema: { document_id: z.string() },
  }, ({ document_id }) => run(() => S.readDocument(c, document_id)));
  server.registerTool("list_contacts", { description: "People you may contact, based on your tasks' scope." }, () => run(() => S.listContacts(c)));
  server.registerTool("send_message", {
    description: "Send a message to a person in your contacts, optionally about a task.",
    inputSchema: { to_user_id: z.string(), body: z.string(), task_id: z.string().optional() },
  }, ({ to_user_id, body, task_id }) => run(() => S.sendMessage(c, to_user_id, body, task_id)));
  server.registerTool("project_overview", {
    description: "Management roll-up of a project: progress per workstream and milestone, blocked tasks, tasks awaiting review, per-person load. Managers and admins only.",
    inputSchema: { project_id: z.string() },
  }, ({ project_id }) => run(() => S.projectOverview(c, project_id)));
  return server;
}

export function mountMcp(app: Express, db: DB) {
  // Stateless Streamable HTTP: a fresh server per request, bound to the caller's identity.
  app.post("/mcp", async (req: Request, res: Response) => {
    const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const user = token ? S.userByToken(db, token) : undefined;
    if (!user) return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid bearer token" }, id: null });
    const server = buildServer({ db, user, via: "agent" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: Request, res: Response) => void res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
