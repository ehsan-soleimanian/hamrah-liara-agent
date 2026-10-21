import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(path.join(tmpdir(), "hamrah-http-tests-"));
const base = "http://127.0.0.1:3053";
const password = "a-local-test-password-12345";
const auth = `Basic ${Buffer.from("test:" + password).toString("base64")}`;
let child: ChildProcess;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
before(async () => {
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_MODE: "demo",
      PORT: "3053",
      HOST: "127.0.0.1",
      DASHBOARD_PASSWORD: password,
      DATA_DIR: dir,
      MONITOR_INTERVAL_MS: "60000",
      LIARA_API_TOKEN: "",
      CURSOR_API_KEY: "",
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  const start = Date.now();
  while (true) {
    try {
      if (
        (
          await fetch(base + "/api/health", {
            headers: { Authorization: auth },
          })
        ).ok
      )
        break;
    } catch {}
    if (Date.now() - start > 15000) throw new Error(output);
    await delay(100);
  }
});
after(async () => {
  child?.kill();
  await delay(300);
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});
test("password protects health, state and memory exports", async () => {
  for (const route of ["/api/health", "/api/state", "/api/memory/export"])
    assert.equal((await fetch(base + route)).status, 401);
  assert.equal(
    (await fetch(base + "/api/state", { headers: { Authorization: auth } }))
      .status,
    200,
  );
});
test("mutations reject missing client header and foreign origins", async () => {
  assert.equal(
    (
      await fetch(base + "/api/check", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/check", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          "X-Hamrah-Client": "dashboard",
          Origin: "https://attacker.example",
        },
        body: "{}",
      })
    ).status,
    403,
  );
});
test("invalid chat input is rejected without adding a conversation message", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  const before = await (await fetch(base + "/api/state", { headers })).json();
  const response = await fetch(base + "/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "", unexpected: "x" }),
  });
  assert.equal(response.status, 400);
  const after = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(before.messages.length, after.messages.length);
});
test("responses apply security headers and never expose env credentials", async () => {
  const response = await fetch(base + "/api/state", {
    headers: { Authorization: auth },
  });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-security-policy") || "",
    /frame-ancestors 'none'/,
  );
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(password));
  assert.doesNotMatch(body, /"liaraToken"|"cursorKey"/);
  assert.equal(
    (
      await fetch(base + "/api/does-not-exist", {
        headers: { Authorization: auth },
      })
    ).status,
    404,
  );
});
