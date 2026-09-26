// npm run mcp:budget: how many tokens one agent spends on our MCP layer to take and finish one task.
import { measureBudget, formatBudget } from "../src/mcp-budget.js";

console.log(formatBudget(await measureBudget()));
