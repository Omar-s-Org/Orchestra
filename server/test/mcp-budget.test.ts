import { describe, it, expect } from "vitest";
import { measureBudget, formatBudget } from "../src/mcp-budget.js";

// Baseline measured before the MCP efficiency work (11 tools, full task echoed on every write).
const BASELINE = { context: 1303 + 299, results: 4447, calls: 9 };

describe("MCP token budget (one agent, one task)", () => {
  it("stays within budget", async () => {
    const b = await measureBudget();
    console.log(formatBudget(b));
    expect(b.definitions + b.instructions).toBeLessThanOrEqual(BASELINE.context);
    expect(b.results).toBeLessThanOrEqual(BASELINE.results);
    expect(b.calls.length).toBeLessThanOrEqual(BASELINE.calls);
  }, 30_000);
});
