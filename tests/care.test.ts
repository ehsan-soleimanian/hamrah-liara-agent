import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { Store } from "../server/store.ts";
import { Engine } from "../server/engine.ts";
import { config } from "../server/config.ts";
import { ordersHash } from "../server/order-snapshot.ts";
import type { Action, Incident, Probe } from "../src/types.ts";
const directory = mkdtempSync(path.join(tmpdir(), "hamrah-care-"));
let child: ChildProcess, engine: Engine, store: Store;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
before(async () => {
  const socket = createServer();
  await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  Object.assign(config, {
    mode: "demo",
    dataDir: directory,
    teamId: "",
    liaraToken: "",
    appId: "",
    databaseId: "",
    demoUrl: `http://127.0.0.1:${port}`,
    demoToken: "care-test-only",
    threshold: 2,
  });
  child = spawn(process.execPath, ["--import", "tsx", "demo/index.ts"], {
    env: {
      ...process.env,
      DATA_DIR: path.join(directory, "shop"),
      DEMO_PORT: String(port),
      DEMO_CONTROL_TOKEN: config.demoToken,
    },
    stdio: "pipe",
  });
  let output = "";
  child.stderr?.on("data", (d) => (output += d));
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${config.demoUrl}/health`)).ok) break;
    } catch {}
    if (i > 300) throw new Error(output || "Shop startup timed out");
    await pause(100);
  }
  store = new Store(path.join(directory, "manager"));
  engine = new Engine(store);
  await engine.refresh();
});
after(async () => {
  engine?.stop();
  store?.close();
  child?.kill();
});
async function order(product = "دسته‌گل آزمون") {
  const r = await fetch(`${config.demoUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product }),
  });
  assert.equal(r.status, 200);
  return r.json();
}

test("checkout-only failure is discovered autonomously even while website is healthy; repair needs approval", async () => {
  await engine.demoFault("checkout");
  const probe = await engine.check();
  assert.equal(probe.healthOk, true);
  assert.equal(probe.businessOk, false);
  await engine.tick(true);
  for (
    let i = 0;
    i < 160 &&
    !store.list<Action>("actions").some((a) => a.status === "pending");
    i++
  )
    await pause(50);
  const action = store
    .list<Action>("actions")
    .find((a) => a.status === "pending")!;
  assert.ok(action);
  assert.equal(
    (await engine.check()).businessOk,
    false,
    "agent must not mutate before approval",
  );
  await engine.decide(action.id, true, action.fingerprint);
  assert.equal(store.get<Action>("actions", action.id)?.status, "completed");
  assert.equal(
    store.get<Incident>("incidents", action.incidentId!)?.status,
    "RESOLVED",
  );
  assert.equal((await engine.check()).businessOk, true);
});
test("backup is encrypted, independently read back, and dry-run restored without changing customer orders", async () => {
  await order("private-flower-order-unique");
  const before = await engine.control("backup");
  const backup = await engine.createBackup();
  assert.equal(backup?.orderCount, 1);
  assert.ok(backup?.verifiedAt);
  assert.equal(backup?.checksum, ordersHash(before.orders));
  assert.deepEqual((await engine.control("backup")).orders, before.orders);
  assert.equal(
    store.value(`backup:${backup!.id}`, null),
    null,
    "no plaintext order snapshot in manager SQLite",
  );
  const encrypted = readdirSync(path.join(directory, "vault")).filter((n) =>
    n.endsWith(".enc"),
  );
  assert.ok(encrypted.length);
  for (const name of encrypted)
    assert.equal(
      readFileSync(path.join(directory, "vault", name)).includes(
        Buffer.from("private-flower-order-unique"),
      ),
      false,
    );
});
test("restore preview reports orders at risk; a new order invalidates the approved replacement atomically", async () => {
  const backup = engine.snapshot().backups[0];
  await order();
  const preview = await engine.prepareRestore(backup.id);
  assert.equal(preview.backupCount, 1);
  assert.equal(preview.currentCount, 2);
  assert.equal(preview.removedCount, 1);
  const action = engine.propose({
    kind: "restore_backup",
    target: "golbazar",
    backupId: backup.id,
  });
  await order("arrived-after-preview");
  await engine.decide(action.id, true, action.fingerprint);
  assert.equal(store.get<Action>("actions", action.id)?.status, "failed");
  assert.equal(
    (await engine.control("backup")).orders.length,
    3,
    "fresh orders must survive stale approval",
  );
  await engine.prepareRestore(backup.id);
  const fresh = engine.propose({
    kind: "restore_backup",
    target: "golbazar",
    backupId: backup.id,
  });
  await engine.decide(fresh.id, true, fresh.fingerprint);
  assert.equal(store.get<Action>("actions", fresh.id)?.status, "completed");
  assert.equal((await engine.control("backup")).orders.length, 1);
  assert.ok(
    engine
      .snapshot()
      .backups.some(
        (b) => b.purpose === "نسخهٔ ایمنی پیش از بازیابی" && b.orderCount === 3,
      ),
  );
});
test("scope and preview expiry fail closed before a write", async () => {
  const a = engine.propose({ kind: "restart_app", target: "golbazar" });
  config.teamId = "different-team";
  await assert.rejects(
    () => engine.decide(a.id, true, a.fingerprint),
    /حساب|فروشگاه/,
  );
  config.teamId = "";
  await engine.decide(a.id, false, a.fingerprint);
  const backup = engine.snapshot().backups[0];
  await engine.prepareRestore(backup.id);
  const preview = store.value<any>(`restore-preview:${backup.id}`, null);
  preview.expiresAt = new Date(Date.now() - 1).toISOString();
  store.set(`restore-preview:${backup.id}`, preview);
  assert.throws(
    () =>
      engine.propose({
        kind: "restore_backup",
        target: "golbazar",
        backupId: backup.id,
      }),
    /پیش‌نمایش/,
  );
});
test("safe sample deployment creates verified safety backup, then checks orders twice; backup failure prevents release", async () => {
  const releases = engine.snapshot().releases.length;
  const a = engine.propose({ kind: "deploy_release", target: "golbazar" });
  const original = engine.createBackup.bind(engine);
  engine.createBackup = async () => {
    throw new Error("backup storage unavailable");
  };
  await engine.decide(a.id, true, a.fingerprint);
  engine.createBackup = original;
  assert.equal(store.get<Action>("actions", a.id)?.status, "failed");
  assert.equal(engine.snapshot().releases.length, releases);
  const b = engine.propose({ kind: "deploy_release", target: "golbazar" });
  await engine.decide(b.id, true, b.fingerprint);
  const completed = store.get<Action>("actions", b.id)!;
  assert.equal(completed.status, "completed");
  assert.ok(completed.steps?.some((s) => s.label.includes("دو بررسی")));
  assert.ok(
    engine
      .snapshot()
      .backups.some((b) => b.purpose === "نسخهٔ ایمنی پیش از انتشار"),
  );
});
test("scheduled protection requires explicit approval and does not create duplicate backups", async () => {
  assert.equal(engine.care().policy.enabled, false);
  assert.throws(() => engine.setProtection(true, false), /تأیید/);
  engine.setProtection(true, true);
  for (const b of store.list<any>("backups"))
    store.put("backups", {
      ...b,
      at: new Date(Date.now() - 7 * 3600000).toISOString(),
    });
  const before = engine.snapshot().backups.length;
  await Promise.all([engine.protect(), engine.protect()]);
  assert.equal(engine.snapshot().backups.length, before + 1);
  await engine.protect();
  assert.equal(engine.snapshot().backups.length, before + 1);
  engine.setProtection(false, false);
  await engine.protect();
  assert.equal(engine.snapshot().backups.length, before + 1);
});
test("paused or stale evidence cannot make the dashboard claim healthy; audit remains intact", async () => {
  const probe = await engine.check();
  store.put("probes", {
    ...probe,
    at: new Date(Date.now() - 3600000).toISOString(),
  });
  assert.equal(engine.care().health, "stale");
  engine.updateSettings({ monitoring: false });
  assert.equal(engine.care().health, "paused");
  engine.updateSettings({ monitoring: true });
  assert.equal(store.verifyAudit(), true);
});

test("uncertain native Liara backup submission is reconciled by reads without a repeated POST", async () => {
  const previous = { ...config },
    original = engine.liara;
  try {
    Object.assign(config, {
      mode: "live",
      appId: "scoped-app",
      databaseId: "scoped-db",
      allowedApps: ["scoped-app"],
      healthUrl: "",
      liaraToken: "fixture-token",
    });
    let submissions = 0;
    engine.liara.backups = async () =>
      submissions
        ? [
            {
              id: "new-object",
              name: "new-object",
              at: new Date().toISOString(),
              size: "1 KB",
              bytes: 1024,
              status: "ready",
              source: "live",
            },
          ]
        : [];
    engine.liara.createBackup = async () => {
      submissions++;
      throw new Error("connection lost after POST");
    };
    await assert.rejects(() => engine.createBackup(), /connection lost/);
    const reconciled = await engine.createBackup();
    assert.equal(reconciled?.id, "new-object");
    assert.equal(submissions, 1);
  } finally {
    engine.liara = original;
    Object.assign(config, previous);
  }
});
