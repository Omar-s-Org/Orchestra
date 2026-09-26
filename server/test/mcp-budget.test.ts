import { describe, it, expect } from "vitest";
import { measureBudget, formatBudget } from "../src/mcp-budget.js";

// Before the MCP efficiency work (11 tools, full task echoed on every write): definitions 1,092 + instructions 299,
// results 4,447 tokens in 9 calls, so ~5,840 tokens in the agent's context per task. Budgets keep the gains.
const BUDGET = { context: 1150, results: 600, calls: 6 };

describe("MCP token budget (one agent, one task)", () => {
  it("stays within budget", async () => {
    const b = await measureBudget();
    console.log(formatBudget(b));
    expect(b.definitions + b.instructions).toBeLessThanOrEqual(BUDGET.context);
    expect(b.results).toBeLessThanOrEqual(BUDGET.results);
    expect(b.calls.length).toBeLessThanOrEqual(BUDGET.calls);
  }, 30_000);
});
