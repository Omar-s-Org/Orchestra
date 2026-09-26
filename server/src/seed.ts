// Demo data lives in JSON project files (server/projects/*.json, format in docs/PROJECT_FORMAT.md).
// reset() reloads whichever project file was loaded last, or the Northwind demo.
import fs from "node:fs";
import type { DB } from "./db.js";
import { loadProjectFile, DEFAULT_PROJECT } from "./project-file.js";

export function currentProjectFile(db: DB) {
  const row = db.prepare("SELECT value FROM meta WHERE key='project_file'").get() as { value: string } | undefined;
  return row && fs.existsSync(row.value) ? row.value : DEFAULT_PROJECT;
}

export function reset(db: DB, file = currentProjectFile(db)) {
  return loadProjectFile(db, file);
}
