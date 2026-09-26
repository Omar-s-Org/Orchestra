import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { DB } from "./db.js";
import * as S from "./service.js";
import { reset } from "./seed.js";
import { mountMcp } from "./mcp.js";

type AuthedReq = Request & { ctx: S.Ctx };

export function createApp(db: DB) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });

  // DEMO ONLY: lets the UI offer a "log in as" switcher. Remove for any real deployment.
  app.get("/api/demo/users", (_req, res) => {
    res.json(db.prepare("SELECT id,name,title,department,role,token FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'lead' THEN 2 ELSE 3 END, name").all());
  });
  app.post("/api/demo/reset", (_req, res) => { reset(db); res.json({ ok: true }); });

  mountMcp(app, db);

  const auth = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const user = token ? S.userByToken(db, token) : undefined;
    if (!user) return void res.status(401).json({ error: "Missing or invalid bearer token" });
    (req as AuthedReq).ctx = { db, user, via: "ui" };
    next();
  };
  const h = (fn: (c: S.Ctx, req: Request) => unknown) => (req: Request, res: Response) => {
    try { res.json(fn((req as AuthedReq).ctx, req)); }
    catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: (e as Error).message });
    }
  };
  const p = (req: Request, k: string) => String(req.params[k]);

  const r = express.Router();
  r.use(auth);
  r.get("/me", h(c => S.me(c)));
  r.get("/users", h(c => S.listUsers(c)));
  r.get("/tasks", h((c, q) => S.listTasks(c, { projectId: q.query.projectId as string | undefined, mine: q.query.mine === "true", status: q.query.status as never })));
  r.get("/tasks/:id", h((c, q) => S.getTask(c, p(q, "id"))));
  r.post("/tasks", h((c, q) => S.createTask(c, q.body)));
  r.post("/tasks/:id/status", h((c, q) => S.setStatus(c, p(q, "id"), q.body.status, q.body.note)));
  r.post("/tasks/:id/comments", h((c, q) => S.addComment(c, p(q, "id"), q.body.body)));
  r.post("/tasks/:id/assign", h((c, q) => S.assignTask(c, p(q, "id"), q.body.assigneeId)));
  r.post("/tasks/:id/scope", h((c, q) => S.grantScope(c, p(q, "id"), q.body.kind, q.body.refId)));
  r.delete("/tasks/:id/scope/:kind/:refId", h((c, q) => S.revokeScope(c, p(q, "id"), p(q, "kind"), p(q, "refId"))));
  r.get("/documents", h((c, q) => S.listDocuments(c, q.query.q as string | undefined)));
  r.get("/documents/:id", h((c, q) => S.readDocument(c, p(q, "id"))));
  r.get("/contacts", h(c => S.listContacts(c)));
  r.get("/messages", h(c => S.inbox(c)));
  r.post("/messages", h((c, q) => S.sendMessage(c, q.body.toId, q.body.body, q.body.taskId)));
  r.get("/projects/:id/overview", h((c, q) => S.projectOverview(c, p(q, "id"))));
  r.post("/projects/:id/members", h((c, q) => S.addMember(c, p(q, "id"), q.body.userId)));
  r.get("/audit", h((c, q) => S.auditLog(c, q.query.projectId as string | undefined)));
  r.post("/admin/users", h((c, q) => S.createUser(c, q.body)));
  r.post("/admin/users/:id/role", h((c, q) => S.setRole(c, p(q, "id"), q.body.role)));
  app.use("/api", r);
  return app;
}
