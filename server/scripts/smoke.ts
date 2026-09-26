// npm run smoke -- --url https://<backend>   Full end-to-end check of a running server.
// RESETS the demo data (runs the Lumen demo at full speed, then loads Northwind again).
import { parseArgs } from "node:util";
import { runSelfTest, formatSelfTest } from "../src/selftest.js";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const url = values.url ?? process.env.ORCHESTRA_URL ?? "http://localhost:8787";
console.log(`Self-test of ${url} (resets the demo data)…\n`);
const r = await runSelfTest(url);
console.log(formatSelfTest(r));
process.exit(r.ok ? 0 : 1);
