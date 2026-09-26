// npm run seed                       → reload the current project (Northwind by default)
import path from "node:path";
// npm run load -- path/to/project.json → validate + load another project file
import { openDb } from "./db.js";
import { reset } from "./seed.js";
import { ProjectFileError } from "./project-file.js";

try {
  // npm -w runs inside server/; resolve paths from where the user typed the command.
  const file = process.argv[2] ? path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : undefined;
  const r = reset(openDb(), file);
  console.log(`Loaded "${r.project}": ${r.people} people, ${r.milestones} milestones, ${r.tasks} tasks, ${r.docs} docs.`);
} catch (e) {
  console.error(e instanceof ProjectFileError ? e.message : e);
  process.exit(1);
}
