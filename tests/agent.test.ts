import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { Engine } from "../server/engine.ts";
import { Liara } from "../server/liara.ts";
import { config } from "../server/config.ts";
import { redact, digest } from "../server/security.ts";
import { transition } from "../server/machine.ts";
import type { Incident, Action } from "../src/types.ts";
const dir = mkdtempSync(path.join(tmpdir(), "hamrah-tests-"));
let demo: ChildProcess;
let engine: Engine;
let store: Store;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, timeout = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("Condition timed out");
    await delay(50);
  }
}
before(async () => {
  config.mode = "demo";
  config.teamId = "";
  config.demoUrl = "http://127.0.0.1:3052";
  config.demoToken = "hamrah-test-token";
  config.dataDir = dir;
  config.threshold = 3;
  demo = spawn(process.execPath, ["--import", "tsx", "demo/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: path.join(dir, "shop"),
      DEMO_PORT: "3052",
      DEMO_CONTROL_TOKEN: config.demoToken,
    },
    stdio: "pipe",
  });
  let output = "";
  demo.stderr?.on("data", (d) => (output += d));
  demo.stdout?.on("data", (d) => (output += d));
  const started = Date.now();
  while (true) {
    try {
      if ((await fetch(`${config.demoUrl}/health`)).ok) break;
    } catch {}
    if (Date.now() - started > 12000)
      throw new Error(`Demo did not start: ${output}`);
    await delay(100);
  }
  store = new Store(path.join(dir, "manager"));
  engine = new Engine(store);
  await engine.refresh();
});
after(async () => {
  engine?.stop();
  store?.close();
  demo?.kill();
  await delay(300);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may briefly hold the child database open. */
  }
});

test("probes verify both health and a real database write with rollback", async () => {
  const before = await engine.control("backup");
  const result = await engine.check();
  const after = await engine.control("backup");
  assert.equal(result.healthy, true);
  assert.equal(result.businessOk, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    after.orders,
    before.orders,
    "verification must not create orders",
  );
});
test("monitor discovers fault without chat and waits for human approval", async () => {
  await engine.demoFault("pool");
  assert.equal(store.list("incidents").length, 0);
  await engine.tick(true);
  await engine.tick(true);
  await until(
    () => store.list<Incident>("incidents")[0]?.status === "AWAITING_APPROVAL",
  );
  const incidents = store.list<Incident>("incidents");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].evidence.length, 3);
  assert.match(incidents[0].diagnosis || "", /دیتابیس/);
  assert.equal(
    (await engine.check()).healthy,
    false,
    "nothing changes before approval",
  );
  await engine.tick(true);
  assert.equal(
    store.list("incidents").length,
    1,
    "repeated failures must be deduplicated",
  );
});
test("approval binds exact parameters, executes once, verifies business outcome", async () => {
  const action = store.list<Action>("actions")[0];
  await assert.rejects(
    () => engine.decide(action.id, true, "0".repeat(64)),
    /معتبر نیست/,
  );
  const run = engine.decide(action.id, true, action.fingerprint);
  await assert.rejects(
    () => engine.decide(action.id, true, action.fingerprint),
    /قبلاً/,
  );
  await run;
  assert.equal(store.get<Action>("actions", action.id)?.status, "completed");
  const incident = store.get<Incident>("incidents", action.incidentId!)!;
  assert.equal(incident.status, "RESOLVED");
  assert.match(incident.verification || "", /هر دو موفق/);
  assert.deepEqual(
    incident.timeline.map((t) => t.status),
    [
      "DETECTED",
      "INVESTIGATING",
      "PLAN_READY",
      "AWAITING_APPROVAL",
      "EXECUTING",
      "VERIFYING",
      "RESOLVED",
    ],
  );
  assert.equal((await engine.check()).healthy, true);
});
test("persistent failure is escalated and never falsely reported resolved", async () => {
  await engine.demoFault("persistent");
  await engine.tick(true);
  await engine.tick(true);
  await until(
    () => store.list<Incident>("incidents")[0]?.status === "AWAITING_APPROVAL",
  );
  const action = store.list<Action>("actions")[0];
  await engine.decide(action.id, true, action.fingerprint);
  assert.equal(store.get<Action>("actions", action.id)?.status, "failed");
  assert.equal(
    store.get<Incident>("incidents", action.incidentId!)?.status,
    "ESCALATED",
  );
  assert.equal((await engine.check()).healthy, false);
  await engine.demoFault("none");
});
test("external recovery can be rechecked without falsely attributing a repair", async () => {
  const incident = store
    .list<Incident>("incidents")
    .find((i) => i.status === "ESCALATED")!;
  await engine.recheckIncident(incident.id);
  const recovered = store.get<Incident>("incidents", incident.id)!;
  assert.equal(recovered.status, "RESOLVED");
  assert.match(recovered.verification || "", /بیرون از عملیات همراه/);
  assert.equal(recovered.timeline.at(-2)?.status, "VERIFYING");
});
test("backup restoration restores actual records and creates a safety snapshot", async () => {
  await engine.createBackup();
  const backup = engine.snapshot().backups[0];
  const original = await engine.control("backup");
  await fetch(`${config.demoUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product: "test flower" }),
  });
  assert.equal(
    (await engine.control("backup")).orders.length,
    original.orders.length + 1,
  );
  const action = engine.propose({
    kind: "restore_backup",
    target: "golbazar",
    backupId: backup.id,
  });
  await engine.decide(action.id, true, action.fingerprint);
  assert.equal(store.get<Action>("actions", action.id)?.status, "completed");
  assert.deepEqual((await engine.control("backup")).orders, original.orders);
  assert.equal(engine.snapshot().backups.length, 2);
});
test("rejecting and expiring approvals cannot dispatch an operation", async () => {
  const rejected = engine.propose({ kind: "restart_app", target: "golbazar" });
  await engine.decide(rejected.id, false, rejected.fingerprint);
  assert.equal(store.get<Action>("actions", rejected.id)?.status, "rejected");
  const expired = engine.propose({ kind: "restart_app", target: "golbazar" });
  store.put("actions", {
    ...expired,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  await assert.rejects(
    () => engine.decide(expired.id, true, expired.fingerprint),
    /مهلت/,
  );
  assert.equal(store.get<Action>("actions", expired.id)?.status, "expired");
  assert.throws(
    () => engine.propose({ kind: "restart_app", target: "other-customer" }),
    /فقط برنامه/,
  );
});
test("memory persists and uncertain operations are not replayed after restart", async () => {
  await engine.chat("چه چیزهایی در حافظه می‌ماند؟");
  const messageCount = engine.snapshot().messages.length;
  const action = engine.propose({ kind: "restart_app", target: "golbazar" });
  store.put("actions", { ...action, status: "executing" });
  const interrupted = {
    ...store.list<Incident>("incidents")[0],
    id: randomUUID(),
    status: "VERIFYING" as const,
  };
  store.put("incidents", interrupted);
  store.close();
  store = new Store(path.join(dir, "manager"));
  engine = new Engine(store);
  assert.equal(engine.snapshot().messages.length, messageCount);
  assert.equal(store.get<Action>("actions", action.id)?.status, "failed");
  assert.match(
    store.get<Action>("actions", action.id)?.error || "",
    /نامشخص|بسته شد/,
  );
  assert.equal(
    store.get<Incident>("incidents", interrupted.id)?.status,
    "ESCALATED",
  );
});
test("audit hash chain detects tampering", () => {
  assert.equal(store.verifyAudit(), true);
  const raw = store.db
    .prepare("SELECT seq,data FROM audit ORDER BY seq LIMIT 1")
    .get()!;
  const data = JSON.parse(raw.data as string);
  data.title = "tampered";
  store.db
    .prepare("UPDATE audit SET data=? WHERE seq=?")
    .run(JSON.stringify(data), raw.seq as number);
  assert.equal(store.verifyAudit(), false);
});
test("secrets are redacted from structured objects, URLs, logs and known env values", () => {
  assert.doesNotMatch(
    redact({
      password: "p4ss",
      envs: [{ key: "TOKEN", value: "xyz" }],
      message: "Bearer my.token.value",
    }),
    /p4ss|xyz|my.token.value/,
  );
  assert.doesNotMatch(
    redact("postgres://alice:password@db.internal:5432/shop"),
    /alice:password/,
  );
  const old = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "unique-secret-for-test";
  assert.doesNotMatch(
    redact("SDK failure with unique-secret-for-test"),
    /unique-secret/,
  );
  if (old) process.env.CURSOR_API_KEY = old;
  else delete process.env.CURSOR_API_KEY;
});
test("Liara adapter uses verified paths, authentication, denies unscoped writes", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        projects: [
          { project_id: "test-app", type: "node", scale: 1, planID: "small" },
        ],
        logs: [],
      }),
      { status: 200 },
    );
  };
  const liara = new Liara("test-secret", fake);
  const apps = await liara.apps();
  assert.equal(apps[0].id, "test-app");
  assert.equal(requests[0].url, "https://api.liara.ir/v1/projects");
  assert.equal(
    (requests[0].init?.headers as Record<string, string>).Authorization,
    "Bearer test-secret",
  );
  await assert.rejects(() => liara.restart("unapproved"), /مجوز تغییر/);
  assert.equal(requests.length, 1);
  config.allowedApps = ["test-app"];
  await liara.restart("test-app");
  assert.equal(
    requests[1].url,
    "https://api.liara.ir/v1/projects/test-app/actions/restart",
  );
  assert.equal(requests[1].init?.method, "POST");
});
test("invalid state transitions cannot skip verification", () => {
  const at = new Date().toISOString();
  const incident: Incident = {
    id: randomUUID(),
    appId: "golbazar",
    title: "test",
    summary: "test",
    status: "DETECTED",
    createdAt: at,
    updatedAt: at,
    evidence: [],
    timeline: [],
    source: "demo",
  };
  assert.throws(
    () => transition(incident, "RESOLVED", "fake success"),
    /Invalid transition/,
  );
  assert.equal(
    transition(incident, "INVESTIGATING", "collect logs").status,
    "INVESTIGATING",
  );
});
test("HTTP 200 does not prove business success without ok:true", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/business" ? { ok: false } : { healthy: true },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const original = {
    mode: config.mode,
    healthUrl: config.healthUrl,
    businessUrl: config.businessUrl,
  };
  try {
    config.mode = "live";
    config.healthUrl = `http://127.0.0.1:${port}/health`;
    config.businessUrl = `http://127.0.0.1:${port}/business`;
    const result = await engine.check();
    assert.equal(result.statusCode, 200);
    assert.equal(result.healthOk, true);
    assert.equal(result.businessOk, false);
    assert.equal(result.healthy, false);
  } finally {
    Object.assign(config, original);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("live mode fails closed for unsupported payment, restore and provisioning actions", () => {
  config.mode = "live";
  config.appId = "test-app";
  config.allowedApps = ["test-app"];
  for (const kind of [
    "enable_redis",
    "enable_email",
    "restore_backup",
  ] as const)
    assert.throws(
      () => engine.propose({ kind, target: "test-app" }),
      /پیاده‌سازی نشده/,
    );
  config.mode = "demo";
  config.appId = "";
  config.allowedApps = [];
});
