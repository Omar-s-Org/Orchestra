import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  title TEXT, department TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pm','senior','junior')),
  agent_key TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, due TEXT);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, milestone_id TEXT NOT NULL, parent_id TEXT,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  due TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_departments (task_id TEXT NOT NULL, department TEXT NOT NULL, PRIMARY KEY (task_id, department));
CREATE TABLE IF NOT EXISTS task_people (
  task_id TEXT NOT NULL, user_id TEXT NOT NULL, relation TEXT NOT NULL CHECK (relation IN ('worker','access')),
  PRIMARY KEY (task_id, user_id, relation));
CREATE TABLE IF NOT EXISTS task_links (
  from_task TEXT NOT NULL, to_task TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('depends_on','mentions')),
  source TEXT, PRIMARY KEY (from_task, to_task, type));
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  min_role TEXT NOT NULL DEFAULT 'junior' CHECK (min_role IN ('pm','senior','junior')),
  author_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_docs (task_id TEXT NOT NULL, doc_id TEXT NOT NULL, PRIMARY KEY (task_id, doc_id));
CREATE TABLE IF NOT EXISTS task_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, user_id TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('ui','agent')), agent_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('progress','completion','approval','status')),
  status_from TEXT, status_to TEXT, summary TEXT NOT NULL,
  agents_used TEXT NOT NULL DEFAULT '[]', cost_usd REAL NOT NULL DEFAULT 0, links TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  data BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_sessions (
  user_id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, task_id TEXT, activity TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, events TEXT NOT NULL, created_by TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT NOT NULL, via TEXT NOT NULL,
  action TEXT NOT NULL, entity_id TEXT, allowed INTEGER NOT NULL, detail TEXT);
-- Lookups by task/person that every poll does; without them per-task reads scan whole tables.
CREATE INDEX IF NOT EXISTS ix_updates_task ON task_updates (task_id, kind);
CREATE INDEX IF NOT EXISTS ix_people_user ON task_people (user_id);
CREATE INDEX IF NOT EXISTS ix_links_to ON task_links (to_task, type);
CREATE INDEX IF NOT EXISTS ix_artifacts_task ON artifacts (task_id);
CREATE INDEX IF NOT EXISTS ix_tasks_parent ON tasks (parent_id);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON auth_sessions (user_id);
`;

export const TABLES = ["meta", "audit", "webhooks", "agent_sessions", "artifacts", "task_updates", "task_docs", "kb_docs", "task_links",
  "task_people", "task_departments", "tasks", "milestones", "projects", "auth_sessions", "users"];

export function openDb(file = process.env.DATABASE_PATH ?? "./data/orchestra.sqlite"): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  // The v0 schema had different tables; drop it so an old local DB can't break boot.
  const v0 = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_members'").get();
  if (v0) for (const t of [...TABLES, "project_members", "workstreams", "task_scope", "documents", "comments", "messages"]) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec(SCHEMA);
  // Additive migrations for databases created by an earlier v1 build.
  const cols = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name);
  if (!cols.includes("due")) db.exec("ALTER TABLE tasks ADD COLUMN due TEXT");
  const mcols = (db.prepare("PRAGMA table_info(milestones)").all() as { name: string }[]).map(c => c.name);
  if (!mcols.includes("approved_at")) db.exec("ALTER TABLE milestones ADD COLUMN approved_at TEXT; ALTER TABLE milestones ADD COLUMN approved_by TEXT;");
  return db;
}

export const now = () => new Date().toISOString();
