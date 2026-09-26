import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { DB } from "./db.js";
import * as S from "./service.js";
import { reset } from "./seed.js";
import { mountMcp } from "./mcp.js";

type AuthedReq = Request & { ctx: S.Ctx; token: string };

const bearer = (req: Request) => (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");

export function createApp(db: DB) {
  const app = express();
  // Lets an https Lovable preview call a server on the user's own machine (Chrome Private Network Access).
  app.use((req, res, next) => {
    if (req.header("access-control-request-private-network")) res.setHeader("Access-Control-Allow-Private-Network", "true");
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));

  const send = (res: Response, fn: () => unknown) => {
    try { res.json(fn()); }
    catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: (e as Error).message });
    }
  };

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });
  app.post("/api/auth/login", (req, res) => send(res, () => S.login(db, req.body?.email, req.body?.password)));
  app.post("/api/demo/reset", (_req, res) => send(res, () => { reset(db); return { ok: true }; }));

  mountMcp(app, db);

  // Session token from the header, or ?token= so <img src> can load artifacts (demo only).
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req) || (typeof req.query.token === "string" ? req.query.token : "");
    const user = token ? S.userBySession(db, token) : undefined;
    if (!user) return void res.status(401).json({ error: "Not logged in or session expired" });
    Object.assign(req, { ctx: { db, user, via: "ui" }, token });
    next();
  };
  const h = (fn: (c: S.Ctx, req: Request) => unknown) => (req: Request, res: Response) => send(res, () => fn((req as AuthedReq).ctx, req));
  const q = (req: Request, k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
  const p = (req: Request, k: string) => String(req.params[k]);

  const r = express.Router();
  r.use(auth);
  r.post("/auth/logout", (req, res) => send(res, () => S.logout(db, (req as AuthedReq).token)));
  r.get("/me", h(c => S.me(c)));
  r.get("/me/agent-key", h((c, req) => S.agentKey(c, `${req.protocol}://${req.get("host")}`)));
  r.get("/tasks", h((c, req) => S.listTasks(c, { status: q(req, "status"), department: q(req, "department"), person: q(req, "person"), mine: q(req, "mine") === "true" })));
  r.get("/tasks/:id", h((c, req) => S.getTask(c, p(req, "id"))));
  r.post("/tasks/:id/approve", h((c, req) => S.approveTask(c, p(req, "id"), req.body?.note)));
  r.post("/tasks/:id/reopen", h((c, req) => S.reopenTask(c, p(req, "id"), req.body?.note)));
  r.get("/activity", h((c, req) => S.activity(c, { limit: Number(q(req, "limit")), task: q(req, "task"), via: q(req, "via"), kind: q(req, "kind") })));
  r.get("/agents/live", h(c => S.liveAgents(c)));
  r.get("/overview", h(c => S.overview(c)));
  r.get("/graph", h(c => S.graph(c)));
  r.get("/kb", h((c, req) => S.listKb(c, q(req, "q"))));
  r.get("/kb/:id", h((c, req) => S.readKb(c, p(req, "id"))));
  r.get("/artifacts/:id", (req, res) => {
    try {
      const a = S.getArtifact((req as unknown as AuthedReq).ctx, p(req, "id"));
      res.setHeader("Content-Type", a.mime);
      res.setHeader("Content-Disposition", `inline; filename="${a.name.replace(/"/g, "")}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // SVGs can carry scripts; sandbox anything served from here.
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.send(a.data);
    } catch (e) { res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message }); }
  });
  // PM setup
  r.post("/milestones", h((c, req) => S.createMilestone(c, req.body ?? {})));
  r.post("/tasks", h((c, req) => S.createTask(c, req.body ?? {})));
  r.post("/kb", h((c, req) => S.createDoc(c, req.body ?? {})));
  r.post("/webhooks", h((c, req) => S.addWebhook(c, req.body ?? {})));
  r.get("/audit", h(c => S.auditLog(c)));
  app.use("/api", r);
  return app;
}
