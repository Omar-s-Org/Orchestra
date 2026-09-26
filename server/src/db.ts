import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, title TEXT, department TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','lead','contributor')),
  token TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL, user_id TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS workstreams (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT);
CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL, name TEXT NOT NULL, due TEXT);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, milestone_id TEXT, parent_id TEXT,
  title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','review','done')),
  assignee_id TEXT, lead_id TEXT, created_by TEXT, due TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- Programmable scope: what the assignee of a task may see / talk to.
CREATE TABLE IF NOT EXISTS task_scope (
  task_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('document','person','task')),
  ref_id TEXT NOT NULL, granted_by TEXT, PRIMARY KEY (task_id, kind, ref_id));
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal' CHECK (classification IN ('internal','restricted','confidential')),
  visibility TEXT NOT NULL DEFAULT 'project' CHECK (visibility IN ('project','scoped')),
  owner_id TEXT, tags TEXT);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, author_id TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('ui','agent')), body TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, task_id TEXT,
  via TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT NOT NULL,
  via TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, project_id TEXT,
  allowed INTEGER NOT NULL, detail TEXT);
`;

export function openDb(file = process.env.DATABASE_PATH ?? "./data/orchestra.sqlite"): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();
