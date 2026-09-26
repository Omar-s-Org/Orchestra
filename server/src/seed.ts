// Demo data lives in JSON project files (server/projects/*.json, format in docs/PROJECT_FORMAT.md).
// reset() reloads whichever project file was loaded last, or the Northwind demo.
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import { loadProjectFile, DEFAULT_PROJECT } from "./project-file.js";

export function currentProjectFile(db: DB) {
  const row = db.prepare("SELECT value FROM meta WHERE key='project_file'").get() as { value: string } | undefined;
  if (row && fs.existsSync(row.value)) return row.value;
  // PROJECT_FILE picks the project a fresh (e.g. hosted) database starts with.
  return process.env.PROJECT_FILE ? path.resolve(process.env.PROJECT_FILE) : DEFAULT_PROJECT;
}

/**
 * Reload a project. Logins survive the reset for people who still exist with the same id and role, so the PM who
 * clicks "Reset demo" / "Run demo" isn't logged out by their own click.
 */
export function reset(db: DB, file = currentProjectFile(db)) {
  const sessions = db.prepare("SELECT s.token, s.user_id, s.created_at, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id").all() as { token: string; user_id: string; created_at: string; role: string }[];
  const result = loadProjectFile(db, file);
  // Only if the person still exists with the SAME role, so a login can never gain rights across projects.
  const keep = db.prepare("INSERT OR IGNORE INTO auth_sessions (token, user_id, created_at) SELECT ?, id, ? FROM users WHERE id = ? AND role = ?");
  db.transaction(() => { for (const s of sessions) keep.run(s.token, s.created_at, s.user_id, s.role); })();
  return result;
}
