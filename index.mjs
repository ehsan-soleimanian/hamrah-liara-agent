import { recovery } from "./recovery.mjs";
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";
// Test storefront: no customers, payments or personal data.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  application_name: "golbazar-demo",
});
const log = (level, event) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), level, event }));
pool.on("error", () => log("error", "database_pool_error"));
const page = readFileSync(new URL("./store.html", import.meta.url));
let faultUntil = 0;
const startedAt = new Date().toISOString();
const secret =
  process.env.HAMRAH_CONTROL_TOKEN || process.env.TEST_CONTROL_TOKEN || "";
function authorized(req) {
  const a = Buffer.from(req.headers.authorization || ""),
    b = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let bytes = 0,
    chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4_000_000) throw new Error("body_limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
async function ready() {
  if (Date.now() < faultUntil) throw new Error("controlled_test_fault");
  await pool.query("SELECT 1");
}
// Idempotent schema setup belongs to this owned sample, never the intake analyser.
await pool.query(`CREATE TABLE IF NOT EXISTS demo_orders (
  id UUID PRIMARY KEY, product TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      await ready();
      json(res, 200, {
        ok: true,
        service: "golbazar",
        database: "postgresql",
        startedAt,
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/checkout/check") {
      await ready();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const id = randomUUID();
        await client.query(
          "INSERT INTO demo_orders(id,product) VALUES($1,$2)",
          [id, "verification-only"],
        );
        const read = await client.query(
          "SELECT id FROM demo_orders WHERE id=$1",
          [id],
        );
        if (read.rowCount !== 1) throw new Error("verification_read_failed");
        await client.query("ROLLBACK");
        json(res, 200, {
          ok: true,
          check: "postgres-order-write-read-rollback",
          persisted: false,
        });
      } finally {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/orders") {
      const data = await body(req);
      await ready();
      if (data.product !== "spring") {
        json(res, 400, { error: "invalid_product" });
        return;
      }
      const id = randomUUID();
      await pool.query("INSERT INTO demo_orders(id,product) VALUES($1,$2)", [
        id,
        "spring",
      ]);
      log("info", "demo_order_created");
      json(res, 201, { ok: true, id, testOnly: true });
      return;
    }
    if (req.url?.startsWith("/control/")) {
      if (!authorized(req)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      const operation = req.url.slice("/control/".length);
      if (
        (req.method === "GET" && operation === "backup") ||
        (req.method === "POST" &&
          ["restore-preview", "restore"].includes(operation))
      ) {
        const result = await recovery(
          pool,
          operation,
          req.method === "POST" ? await body(req) : {},
        );
        json(res, 200, result);
        return;
      }
      if (req.method === "POST" && req.url === "/control/fault") {
        const data = await body(req);
        faultUntil =
          data.enabled === true
            ? Date.now() +
              Math.min(300, Math.max(10, Number(data.seconds) || 120)) * 1000
            : 0;
        log(
          "warn",
          faultUntil
            ? "controlled_test_fault_enabled"
            : "controlled_test_fault_cleared",
        );
        json(res, 200, { ok: true, faultUntil });
        return;
      }
      if (req.method === "POST" && req.url === "/control/order-check") {
        const { id } = await body(req);
        if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) {
          json(res, 400, { error: "invalid_id" });
          return;
        }
        const result = await pool.query(
          "SELECT id FROM demo_orders WHERE id=$1",
          [id],
        );
        json(res, 200, { ok: true, exists: result.rowCount === 1, startedAt });
        return;
      }
    }
    json(res, 404, { error: "not_found" });
  } catch (error) {
    log(
      "error",
      error.message === "controlled_test_fault"
        ? "controlled_test_fault"
        : "request_failed",
    );
    json(res, error.status === 409 ? 409 : 503, {
      ok: false,
      error:
        error.status === 409
          ? "orders_changed"
          : "service_temporarily_unavailable",
    });
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  log("info", "golbazar_ready"),
);
async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
