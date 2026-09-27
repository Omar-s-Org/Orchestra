import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { DB } from "./db.js";
import * as S from "./service.js";
import { reset } from "./seed.js";
import { mountMcp } from "./mcp.js";
import { Forbidden } from "./permissions.js";
import { startDemo, stopDemo, demoStatus, loadDemo } from "./demo-runner.js";
import { statusPage } from "./status-page.js";
import { runSelfTest } from "./selftest.js";

type AuthedReq = Request & { ctx: S.Ctx; token: string };

const bearer = (req: Request) => (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");

export function createApp(db: DB) {
  const app = express();
  // Railway/Render terminate TLS in front of us: trust X-Forwarded-Proto so URLs we hand out are https.
  app.set("trust proxy", true);
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
  app.get("/", (req, res) => { res.type("html").send(statusPage(db, `${req.protocol}://${req.get("host")}`, demoStatus(db).available_cast)); });
  app.post("/api/auth/login", (req, res) => send(res, () => S.login(db, req.body?.email, req.body?.password)));

  // DEMO ONLY: who can log in (no passwords); lets the login screen list the current project's people.
  app.get("/api/demo/accounts", (_req, res) => send(res, () =>
    db.prepare("SELECT email, name, role, department, title FROM users ORDER BY CASE role WHEN 'pm' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END, name").all()));

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
  r.post("/milestones/:id/approve", h((c, req) => S.approveMilestone(c, p(req, "id"), req.body?.note)));
  r.post("/tasks", h((c, req) => S.createTask(c, req.body ?? {})));
  r.post("/kb", h((c, req) => S.createDoc(c, req.body ?? {})));
  r.post("/webhooks", h((c, req) => S.addWebhook(c, req.body ?? {})));
  r.get("/audit", h(c => S.auditLog(c)));
  // Run demo: load a demo project and let its simulated agents work it (PM only). Humans approve in the UI.
  const pmOnly = (c: S.Ctx) => { if (c.user.role !== "pm") throw new Forbidden("Only the PM can run the demo"); };
  r.get("/demo/status", h(c => demoStatus(c.db)));
  r.post("/demo/run", h((c, req) => { pmOnly(c); return startDemo(db, `http://127.0.0.1:${req.socket.localPort}`, req.body ?? {}); }));
  r.post("/demo/stop", h(c => { pmOnly(c); return stopDemo(db); }));
  r.post("/demo/load", h((c, req) => { pmOnly(c); return loadDemo(db, String(req.body?.project ?? "")); }));
  // Full end-to-end check of this server (resets the data). One at a time.
  let selftest: Promise<unknown> | null = null;
  r.post("/demo/selftest", async (req, res) => {
    const c = (req as AuthedReq).ctx;
    if (c.user.role !== "pm") return void res.status(403).json({ error: "Only the PM can run the self-test" });
    if (selftest) return void res.status(409).json({ error: "A self-test is already running" });
    selftest = runSelfTest(`http://127.0.0.1:${req.socket.localPort}`);
    try { res.json(await selftest); }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
    finally { selftest = null; }
  });
  // Wipes all data, so it needs the PM (the URL may be public when hosted).
  r.post("/demo/reset", h(c => {
    if (c.user.role !== "pm") throw new Forbidden("Only the PM can reset the demo");
    stopDemo(db); // a running demo's agents would otherwise keep working on the freshly reset data
    reset(db);
    return { ok: true };
  }));
  app.use("/api", r);
  // JSON errors everywhere (the UI and agents parse them), including unknown routes and malformed JSON bodies.
  app.use("/api", (_req: Request, res: Response) => void res.status(404).json({ error: "Not found" }));
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
  });
  return app;
}
