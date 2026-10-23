import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";

const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
before(async () => {
  child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/monitoring-preview.ts"],
    {
      env: {
        ...process.env,
        HAMRAH_MONITOR_FIXTURE: "1",
        DATA_DIR: mkdtempSync(path.join(tmpdir(), "hamrah-monitor-preview-")),
        PORT: String(port),
        HOST: "127.0.0.1",
        APP_MODE: "live",
        LIARA_API_TOKEN: "isolated-fixture-key",
        CURSOR_API_KEY: "",
        LIARA_APP_ID: "fixture-app",
        LIARA_ALLOWED_APP_IDS: "fixture-app",
        LIARA_TEAM_ID: "",
        LIARA_DATABASE_ID: "",
        APP_HEALTH_URL: "https://preview.fixture.invalid/health",
        APP_BUSINESS_CHECK_URL: "https://preview.fixture.invalid/check",
        DASHBOARD_PASSWORD: "",
        MONITOR_INTERVAL_MS: "60000",
      },
      stdio: "pipe",
    },
  );
  let output = "";
  child.stderr?.on("data", (d) => (output += d));
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("fixture failed: " + output);
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
  }
});
const post = (route: string, body: unknown, method = "POST") =>
  fetch(base + "/api" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Hamrah-Client": "dashboard",
    },
    body: JSON.stringify(body),
  });
test("HTTP snapshot exposes explicit Cursor limitation, three measured alerts and scoped samples", async () => {
  const state = await (await fetch(base + "/api/state")).json();
  assert.equal(state.connections.cursorStatus.code, "region_blocked");
  assert.match(state.settings.businessName, /شبیه/);
  assert(state.monitoring.samples.length >= 3);
  assert(
    state.incidents.some(
      (i: any) =>
        i.category === "performance" &&
        i.performanceKeys.includes("CPU") &&
        i.performanceKeys.includes("RAM") &&
        i.performanceKeys.includes("کندی"),
    ),
  );
  const options = await fetch(base + "/api/resources/options");
  assert.equal(options.status, 200);
  assert.equal((await options.json()).current.id, "small/basic");
});
test("HTTP validates threshold ranges, unit contracts, strict quote schema and fingerprints", async () => {
  const policy = (await (await fetch(base + "/api/state")).json()).monitoring
    .policy;
  for (const resourcePolicy of [
    { ...policy, cpuPercent: 101 },
    { ...policy, consecutive: 1 },
    { ...policy, cpuUnit: "guess" },
  ])
    assert.equal(
      (await post("/settings", { resourcePolicy }, "PATCH")).status,
      400,
    );
  assert.equal(
    (await post("/resources/quote", { planId: "large/basic", cost: 1 })).status,
    400,
  );
  assert.equal(
    (await post("/actions", { kind: "resize_app", target: "fixture-app" }))
      .status,
    400,
  );
  const quote = await post("/resources/quote", { planId: "large/basic" });
  assert.equal(quote.status, 200);
  const a = await quote.json();
  assert.equal(a.status, "pending");
  assert.equal(
    (
      await post(`/actions/${a.id}/decision`, {
        approve: true,
        fingerprint: "0".repeat(64),
      })
    ).status,
    409,
  );
  const options = await (await fetch(base + "/api/resources/options")).json();
  assert.equal(options.current.id, "small/basic");
  assert.equal(
    (
      await post(`/actions/${a.id}/decision`, {
        approve: false,
        fingerprint: a.fingerprint,
      })
    ).status,
    200,
  );
});
test("HTTP approval changes only the simulated plan, verifies result and rejects duplicate dispatch", async () => {
  const a = await (
    await post("/resources/quote", { planId: "large/basic" })
  ).json();
  const result = await post(`/actions/${a.id}/decision`, {
    approve: true,
    fingerprint: a.fingerprint,
  });
  assert.equal(result.status, 200);
  assert.equal(
    (await (await fetch(base + "/api/resources/options")).json()).current.id,
    "large/basic",
  );
  const state = await (await fetch(base + "/api/state")).json();
  assert.equal(
    state.actions.find((v: any) => v.id === a.id).status,
    "completed",
  );
  assert.equal(
    (
      await post(`/actions/${a.id}/decision`, {
        approve: true,
        fingerprint: a.fingerprint,
      })
    ).status,
    409,
  );
});
