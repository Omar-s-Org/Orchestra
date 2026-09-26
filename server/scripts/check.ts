// npm run check                         → against http://localhost:8787
// npm run check -- --url https://<host>  → against a hosted server (read-only; safe on the demo)
import { parseArgs } from "node:util";
import { runChecks, formatResults } from "../src/check.js";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const url = values.url ?? process.env.ORCHESTRA_URL ?? "http://localhost:8787";
console.log(`Checking ${url} against the frontend contract (docs/LOVABLE_PLAN.md §4)…\n`);
const results = await runChecks(url);
console.log(formatResults(results));
process.exit(results.every(r => r.ok) ? 0 : 1);
