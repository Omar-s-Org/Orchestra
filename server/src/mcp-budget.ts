// Token budget of the MCP layer: what one agent pays us to receive a task and report it done.
// Runs the agent's intended call sequence over real MCP against an in-memory Lumen server and sizes
// every tool result, plus the tool definitions and instructions an agent keeps in context.
// Tokens are estimated as characters / 4 (good enough to compare versions; not a billing figure).
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openDb } from "./db.js";
import { reset } from "./seed.js";
import { createApp } from "./http.js";
import { AGENT_INSTRUCTIONS } from "./mcp.js";

export const tokens = (s: string) => Math.ceil(s.length / 4);

const LUMEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../projects/lumen.json");

/** Priya's agent does T-5 (ingestion) the way AGENT_INSTRUCTIONS tell it to. */
export const FLOW: [tool: string, args: Record<string, unknown>][] = [
  ["next_task", {}],                                   // brief: task, prerequisites, docs inline
  ["start_task", { task_id: "T-5", plan: "Build the ingestion pipeline for the help-centre articles." }],
  ["report_progress", { task_id: "T-5", summary: "A crawler agent fetched 412 help-centre articles; a chunking agent split them into 3,180 passages. Feeds T-9.", agents_used: ["crawler agent", "chunking agent"], cost_usd: 0.8 }],
  ["report_progress", { task_id: "T-5", summary: "An embedding agent indexed every passage; spot checks on 20 queries pass.", agents_used: ["embedding agent"], cost_usd: 1.1 }],
  ["attach_artifact", { task_id: "T-5", name: "coverage.svg", mime: "image/svg+xml", text: "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>" }],
  ["submit_task", { task_id: "T-5", explanation: "Ingestion pipeline done: 412 articles, 3,180 passages indexed and spot-checked; ready for the answer engine (T-9).", agents_used: ["crawler agent", "chunking agent", "embedding agent"], cost_usd: 0.3 }],
];

/**
 * definitions = what the model sees of each tool (name, description, input schema), which clients send
 * with every request. wire = the full tools/list JSON, including SDK metadata ($schema, annotations,
 * execution) that clients use themselves.
 */
export type Budget = { definitions: number; wire: number; instructions: number; tools: number; calls: { tool: string; tokens: number }[]; results: number };

export async function measureBudget(flow = FLOW, agentKey = "ak_priya"): Promise<Budget> {
  const db = openDb(":memory:");
  reset(db, LUMEN);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const client = new Client({ name: "mcp-budget", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${agentKey}` } },
    }));
    const { tools } = await client.listTools();
    const calls: Budget["calls"] = [];
    for (const [tool, args] of flow) {
      const r = await client.callTool({ name: tool, arguments: args }) as { isError?: boolean; content: { text: string }[] };
      const text = r.content.map(c => c.text).join("");
      if (r.isError) throw new Error(`${tool} failed: ${text}`);
      calls.push({ tool, tokens: tokens(text) });
    }
    return {
      definitions: tokens(JSON.stringify(tools.map(({ name, description, inputSchema: { $schema: _s, ...schema } }) => ({ name, description, input_schema: schema })))),
      wire: tokens(JSON.stringify(tools)), instructions: tokens(AGENT_INSTRUCTIONS), tools: tools.length,
      calls, results: calls.reduce((s, c) => s + c.tokens, 0),
    };
  } finally {
    await client.close();
    server.close();
  }
}

export function formatBudget(b: Budget) {
  return [
    `Tool definitions: ~${b.definitions} tokens seen by the model (${b.tools} tools; ~${b.wire} on the wire) · instructions: ~${b.instructions} tokens`,
    ...b.calls.map((c, i) => `  ${String(i + 1).padStart(2)}. ${c.tool.padEnd(16)} ~${c.tokens}`),
    `Results for one task: ~${b.results} tokens in ${b.calls.length} calls`,
    `In context after the task: ~${b.definitions + b.instructions + b.results} tokens`,
  ].join("\n");
}
