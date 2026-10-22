import "dotenv/config";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { orderSnapshot, ordersHash } from "../server/order-snapshot.ts";
import { secureEqual } from "../server/security.ts";
const dir = path.resolve(process.env.DATA_DIR || "./data");
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, "golbazar.sqlite"));
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, product TEXT, at TEXT);`,
);
let fault = "none";
let cache = false;
const logs: { at: string; level: string; message: string }[] = [];
function log(level: string, message: string) {
  logs.push({ at: new Date().toISOString(), level, message });
  if (logs.length > 100) logs.shift();
}
log("info", "Golbazar is listening; database connection healthy.");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
const broken = () => fault === "pool" || fault === "persistent";
app.get("/health", (_req, res) => {
  if (broken()) {
    log(
      "error",
      "ConnectionAcquireTimeout: database connection pool exhausted; 20/20 connections busy",
    );
    res
      .status(500)
      .json({ healthy: false, error: "connection_pool_exhausted" });
  } else res.json({ healthy: true, database: "connected", cache });
});
app.get("/api/checkout/check", (_req, res) => {
  if (broken() || fault === "checkout") {
    if (fault === "checkout")
      log(
        "error",
        "CheckoutWorkerStalled: transient order worker stalled; checkout write unavailable",
      );
    res.status(500).json({ ok: false, error: "checkout_database_unavailable" });
    return;
  }
  try {
    db.exec("BEGIN");
    const verificationId = randomUUID();
    db.prepare("INSERT INTO orders VALUES(?,?,?)").run(
      verificationId,
      "verification-only",
      new Date().toISOString(),
    );
    if (!db.prepare("SELECT id FROM orders WHERE id=?").get(verificationId))
      throw new Error("verification_read_failed");
    db.exec("ROLLBACK");
    res.json({
      ok: true,
      check: "order-write-read-rollback",
      persisted: false,
    });
  } catch {
    db.exec("ROLLBACK");
    res.status(500).json({ ok: false });
  }
});
app.post("/api/orders", (req, res) => {
  if (broken() || fault === "checkout") {
    if (fault === "checkout")
      log(
        "error",
        "CheckoutWorkerStalled: transient order worker stalled; checkout write unavailable",
      );
    res.status(500).json({ error: "در حال حاضر امکان ثبت سفارش نیست." });
    return;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO orders VALUES(?,?,?)").run(
    id,
    String(req.body.product || "دسته گل بهاری").slice(0, 200),
    new Date().toISOString(),
  );
  log("info", `Order ${id} created successfully.`);
  res.json({ id, ok: true });
});
app.use("/control", (req, res, next) => {
  if (
    !secureEqual(
      req.headers.authorization || "",
      `Bearer ${process.env.DEMO_CONTROL_TOKEN || "hamrah-local-demo-only"}`,
    )
  ) {
    res.sendStatus(401);
    return;
  }
  next();
});
app.get("/control/logs", (_req, res) => res.json({ logs }));
app.post("/control/fault", (req, res) => {
  fault = ["pool", "persistent", "checkout", "none"].includes(req.body.fault)
    ? req.body.fault
    : "pool";
  log("warn", `Demo fault switched to ${fault}`);
  res.json({ fault });
});
app.post("/control/restart", (_req, res) => {
  if (fault !== "persistent") fault = "none";
  log("info", "Worker restarted; transient connection pool released.");
  res.json({ accepted: true });
});
app.post("/control/cache", (_req, res) => {
  cache = true;
  log("info", "Demo cache flag enabled (no real Redis provisioned).");
  res.json({ cache, simulated: true });
});
app.get("/control/backup", (_req, res) =>
  res.json({
    orders: db.prepare("SELECT * FROM orders").all(),
    at: new Date().toISOString(),
  }),
);
app.post("/control/restore-preview", (req, res) => {
  const parsed = orderSnapshot.safeParse(req.body);
  if (!parsed.success) {
    res.sendStatus(400);
    return;
  }
  try {
    db.exec(
      "CREATE TEMP TABLE IF NOT EXISTS restore_test(id TEXT PRIMARY KEY, product TEXT, at TEXT); DELETE FROM restore_test;",
    );
    const insert = db.prepare("INSERT INTO restore_test VALUES(?,?,?)");
    for (const o of parsed.data.orders) insert.run(o.id, o.product, o.at);
    const rows = db
      .prepare("SELECT * FROM restore_test")
      .all() as typeof parsed.data.orders;
    res.json({ ok: true, count: rows.length, checksum: ordersHash(rows) });
  } catch {
    res.sendStatus(400);
  } finally {
    db.exec("DROP TABLE IF EXISTS restore_test");
  }
});
app.post("/control/restore", (req, res) => {
  const parsed = orderSnapshot.safeParse({
    orders: req.body.orders,
    at: req.body.at,
  });
  if (!parsed.success || typeof req.body.expectedCurrentHash !== "string") {
    res.sendStatus(400);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare("SELECT * FROM orders")
      .all() as typeof parsed.data.orders;
    if (ordersHash(current) !== req.body.expectedCurrentHash) {
      db.exec("ROLLBACK");
      res.status(409).json({ error: "orders_changed" });
      return;
    }
    db.exec("DELETE FROM orders");
    for (const o of parsed.data.orders)
      db.prepare("INSERT INTO orders VALUES(?,?,?)").run(o.id, o.product, o.at);
    db.exec("COMMIT");
    log("info", "Orders restored from verified snapshot.");
    res.json({ ok: true, count: parsed.data.orders.length });
  } catch {
    db.exec("ROLLBACK");
    res.sendStatus(400);
  }
});
app.get("/", (_req, res) =>
  res
    .type("html")
    .send(
      `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>گل‌بازار | فروشگاه آزمایشی همراه</title><style>body{font:17px Tahoma;max-width:850px;margin:70px auto;background:#f5f6f0;color:#253b30;padding:24px}small{color:#65756c}h1{font-size:54px}.card{background:white;border-radius:25px;padding:35px;margin-top:24px}button{border:0;background:#216249;color:white;border-radius:12px;padding:16px 24px;cursor:pointer;font:inherit}a{color:#216249}#result{margin-top:20px}</style><small>فروشگاه آزمایشی واقعی · همراه</small><h1>برای هر حس، یک گل.</h1><p>گل‌بازار، یک کسب‌وکار کوچک با یک مدیر فنی همیشه بیدار.</p><div class="card"><h2>دسته‌گل بهاری</h2><p>رز، لیسیانتوس و کمی حال خوب — ۴۸۰٬۰۰۰ تومان</p><button id="order">ثبت سفارش آزمایشی</button><div id="result" role="status"></div></div><p><a href="http://127.0.0.1:3001">بازگشت به همراه</a> · <a href="/health">وضعیت سلامت</a></p><script>document.getElementById('order').onclick=async()=>{let out=document.getElementById('result');out.textContent='در حال ثبت…';try{let r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:'دسته گل بهاری'})});let d=await r.json();out.textContent=r.ok?'سفارش ثبت شد. کد: '+d.id:d.error}catch{out.textContent='اتصال برقرار نشد.'}};</script></html>`,
    ),
);
app.listen(Number(process.env.DEMO_PORT || 3002), "127.0.0.1", () =>
  console.log(
    `Golbazar demo: http://127.0.0.1:${process.env.DEMO_PORT || 3002}`,
  ),
);
