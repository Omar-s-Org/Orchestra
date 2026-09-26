// npm run sim                                   → John, Priya and Mia work their tasks on http://localhost:8787
// npm run sim -- --reset                        → reset the demo data first (as the PM)
// npm run sim -- --loop                         → stay online after the work (live rail stays green); re-works tasks after a reset; Ctrl+C stops
// npm run sim -- --url https://<domain> --people john,mia --speed 2 --project path/to/project.json
// Env equivalents: ORCHESTRA_URL, SIM_PEOPLE, SIM_SPEED, PROJECT_FILE.
// Hosted: --project must be the same file the server loaded (its PROJECT_FILE), or agents look for the wrong tasks.
import path from "node:path";
import { parseArgs } from "node:util";
import { runSim } from "./sim.js";

const { values: a } = parseArgs({
  options: { url: { type: "string" }, people: { type: "string" }, speed: { type: "string" }, project: { type: "string" }, reset: { type: "boolean" }, loop: { type: "boolean" } },
});
const project = a.project ?? process.env.PROJECT_FILE;
const people = a.people ?? process.env.SIM_PEOPLE;
const stop = new AbortController();
process.once("SIGINT", () => { console.log("\nStopping agents…"); stop.abort(); });

runSim({
  baseUrl: a.url ?? process.env.ORCHESTRA_URL ?? "http://localhost:8787",
  // npm -w runs inside server/; resolve paths from where the user typed the command.
  projectFile: project ? path.resolve(process.env.INIT_CWD ?? process.cwd(), project) : undefined,
  people: people ? people.split(",").map(s => s.trim()).filter(Boolean) : undefined,
  speed: Number(a.speed ?? process.env.SIM_SPEED ?? 1),
  reset: a.reset,
  loop: a.loop,
  signal: stop.signal,
}).catch(e => {
  console.error(`Simulator failed: ${(e as Error).message}`);
  process.exit(1);
});
