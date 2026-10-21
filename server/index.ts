import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { config } from "./config.ts";
import { Store } from "./store.ts";
import { Engine } from "./engine.ts";
import { redact, secureEqual } from "./security.ts";
const db = new Store(path.join(config.dataDir, config.mode));
const engine = new Engine(db);
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use((req, res, next) => {
  if (config.password) {
    const auth = req.headers.authorization || "";
    let password = "";
    try {
      password = Buffer.from(auth.replace(/^Basic /, ""), "base64")
        .toString()
        .split(":")
        .slice(1)
        .join(":");
    } catch {}
    if (!secureEqual(password, config.password)) {
      res.set("WWW-Authenticate", 'Basic realm="Hamrah"');
      res.status(401).send("Authentication required");
      return;
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.headers["x-hamrah-client"] !== "dashboard") {
      res.status(403).json({ error: "درخواست از رابط معتبر ارسال نشده است." });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const url = new URL(origin);
      const requestHost = (req.headers.host || "").split(":")[0];
      if (
        url.hostname !== requestHost &&
        !(
          ["127.0.0.1", "localhost"].includes(url.hostname) &&
          ["127.0.0.1", "localhost"].includes(requestHost)
        )
      ) {
        res.status(403).json({ error: "Origin is not allowed" });
        return;
      }
    }
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/events",
  }),
);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, mode: config.mode }),
);
app.get("/api/state", (_req, res) => res.json(engine.snapshot()));
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = () =>
    res.write(`data: ${JSON.stringify(engine.snapshot())}\n\n`);
  send();
  engine.listeners.add(send);
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
  req.on("close", () => {
    engine.listeners.delete(send);
    clearInterval(heartbeat);
  });
});
app.post("/api/refresh", async (_req, res) => {
  await engine.refresh();
  res.json({ ok: true });
});
app.post("/api/check", async (_req, res) => {
  await engine.tick(true);
  res.json({ ok: true });
});
app.post("/api/incidents/:id/recheck", async (req, res) => {
  await engine.recheckIncident(req.params.id);
  res.json({ ok: true });
});
app.post(
  "/api/chat",
  rateLimit({ windowMs: 60000, limit: 15, legacyHeaders: false }),
  async (req, res) => {
    const { message } = z
      .object({ message: z.string().trim().min(1).max(4000) })
      .strict()
      .parse(req.body);
    await engine.chat(message);
    res.json({ ok: true });
  },
);
app.post("/api/actions", async (req, res) => {
  res.json(engine.propose(req.body));
});
app.post("/api/actions/:id/decision", async (req, res) => {
  const { approve, fingerprint } = z
    .object({ approve: z.boolean(), fingerprint: z.string().length(64) })
    .strict()
    .parse(req.body);
  // The synchronous claim in decide happens before its first await.
  await engine.decide(req.params.id, approve, fingerprint);
  res.json({ ok: true });
});
app.post("/api/demo/fault", async (req, res) => {
  const { kind } = z
    .object({ kind: z.enum(["pool", "persistent", "none"]) })
    .strict()
    .parse(req.body);
  await engine.demoFault(kind);
  res.json({ ok: true });
});
app.patch("/api/settings", (req, res) => {
  const settings = z
    .object({
      monitoring: z.boolean().optional(),
      notify: z.boolean().optional(),
      businessName: z.string().trim().min(1).max(60).optional(),
    })
    .strict()
    .parse(req.body);
  res.json(engine.updateSettings(settings));
});
app.post("/api/setup/context", (req, res) => {
  const context = z
    .object({ projectType: z.enum(["shop", "company", "app"]) })
    .strict()
    .parse(req.body);
  db.set("businessRequirements", context);
  db.audit("setup", "نیاز کسب‌وکار ثبت شد", JSON.stringify(context), "user");
  engine.emit();
  res.json({ ok: true });
});
app.get("/api/logs", async (_req, res) => res.json(await engine.logs()));
app.get("/api/audit/export", (_req, res) => {
  res
    .set("Content-Disposition", 'attachment; filename="hamrah-audit.json"')
    .json({
      integrityVerified: db.verifyAudit(),
      exportedAt: new Date().toISOString(),
      events: db.auditList(),
    });
});
app.get("/api/memory/export", (_req, res) => {
  const state = engine.snapshot();
  res
    .set("Content-Disposition", 'attachment; filename="hamrah-memory.json"')
    .json({
      exportedAt: new Date().toISOString(),
      messages: state.messages,
      incidents: state.incidents,
      actions: state.actions,
      audit: state.audit,
    });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "مسیر API پیدا نشد." }),
);
const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
}
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(error instanceof z.ZodError ? 400 : 409)
      .json({
        error:
          error instanceof z.ZodError
            ? "اطلاعات درخواست معتبر نیست."
            : redact(error.message),
      });
  },
);
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Hamrah API: http://${config.host}:${config.port} (${config.mode})`,
  );
  engine.start();
});
const shutdown = () => {
  engine.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
