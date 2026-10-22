import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
const dir = mkdtempSync(path.join(tmpdir(), "hamrah-http-tests-"));
const reservation = createServer();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const password = "a-local-test-password-12345";
const auth = `Basic ${Buffer.from("test:" + password).toString("base64")}`;
let child: ChildProcess;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function startServer() {
  child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      pathToFileURL(path.resolve("tests/fixtures/liara-fetch.mjs")).href,
      "server/index.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_MODE: "demo",
        PORT: String(port),
        HOST: "127.0.0.1",
        DASHBOARD_PASSWORD: password,
        DATA_DIR: dir,
        MONITOR_INTERVAL_MS: "60000",
        LIARA_API_TOKEN: "",
        CURSOR_API_KEY: "",
      },
      stdio: "pipe",
    },
  );
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
}
before(startServer);
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

test("loopback API rejects foreign Host headers to prevent DNS rebinding", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      base + "/api/state",
      { headers: { Authorization: auth, Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 403);
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

test("mode changes reject invalid input, missing credentials and failed authentication", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  assert.equal(
    (
      await fetch(base + "/api/connection", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "live" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/connection", {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "production" }),
      })
    ).status,
    400,
  );
  for (const input of [
    { mode: "live" },
    { mode: "live", liaraToken: "invalid-test-key" },
  ]) {
    const response = await fetch(base + "/api/connection", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 409);
    assert.ok(!(await response.text()).includes("invalid-test-key"));
    const state = await (await fetch(base + "/api/state", { headers })).json();
    assert.equal(state.mode, "demo");
    assert.equal(state.connections.liara, false);
  }
});

test("connection tests require dashboard authorization and do not save entered keys or alter mode and history", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  const before = await (await fetch(base + "/api/state", { headers })).json();
  for (const provider of ["liara", "cursor"]) {
    const url = base + `/api/settings/${provider}/test`;
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...headers, Origin: "https://attacker.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(url, { method: "POST", headers, body: "{}" })).status,
      400,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ token: "", extra: true }),
        })
      ).status,
      400,
    );
    const invalid = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "invalid-secret-value" }),
    });
    assert.equal(invalid.status, 422);
    assert.ok(!(await invalid.text()).includes("invalid-secret-value"));
    const valid = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: `valid-unsaved-${provider}-key` }),
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    const result = await valid.json();
    assert.equal(result.ok, true);
    assert.equal(result.source, "entered");
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.doesNotMatch(
      JSON.stringify(result),
      /valid-unsaved|private@example|Private account/,
    );
  }
  const after = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(after.connections.liara, before.connections.liara);
  assert.equal(after.connections.cursor, before.connections.cursor);
  assert.equal(after.mode, before.mode);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.audit, before.audit);
});

test("Liara key saves securely, survives restart and never reaches exports", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  const route = base + "/api/settings/liara";
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ token: "rejected" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.example" },
        body: JSON.stringify({ token: "rejected" }),
      })
    ).status,
    403,
  );
  for (const token of ["", "  ", "abc\ndef", "کلید", "x".repeat(8193)]) {
    assert.equal(
      (
        await fetch(route, {
          method: "POST",
          headers,
          body: JSON.stringify({ token }),
        })
      ).status,
      400,
    );
  }
  const secret = "local-test-liara-key-24681357";
  const response = await fetch(route, {
    method: "POST",
    headers,
    body: JSON.stringify({ token: ` ${secret} ` }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!(await response.text()).includes(secret));
  const state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.connections.liara, true);
  assert.equal(state.mode, "demo");
  for (const endpoint of [
    "/api/state",
    "/api/memory/export",
    "/api/audit/export",
  ]) {
    assert.ok(
      !(await (await fetch(base + endpoint, { headers })).text()).includes(
        secret,
      ),
    );
  }
  const { Vault } = await import("../server/vault.ts");
  assert.equal(
    new Vault(dir).get<{ liaraToken: string }>("connection")?.liaraToken,
    secret,
  );
  const { readdirSync, readFileSync } = await import("node:fs");
  for (const filename of readdirSync(path.join(dir, "vault"))) {
    assert.ok(
      !readFileSync(path.join(dir, "vault", filename)).includes(
        Buffer.from(secret),
      ),
    );
  }
  const stopped = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill();
  await stopped;
  await startServer();
  const restored = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(restored.connections.liara, true);
});

test("Cursor keys save securely, replace without exposing values, persist after restart and preserve Liara and mode", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  const url = base + "/api/settings/cursor";
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "unauthorized" }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ token: "rejected" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.example" },
        body: JSON.stringify({ token: "rejected" }),
      })
    ).status,
    403,
  );
  for (const token of ["", "  ", "abc\ndef", "کلید", "x".repeat(4097)]) {
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ token }),
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ token: "test", unexpected: true }),
      })
    ).status,
    400,
  );
  const before = await (await fetch(base + "/api/state", { headers })).json();
  const { Vault } = await import("../server/vault.ts");
  const vault = new Vault(dir);
  const liara = vault.get<{ liaraToken: string }>("connection")!.liaraToken;
  for (const secret of [
    "local-first-cursor-key-13579",
    "local-replacement-cursor-key-13579",
  ]) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: ` ${secret} ` }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes(secret));
    const saved = vault.get<{ liaraToken: string; cursorKey: string }>(
      "connection",
    )!;
    assert.equal(saved.cursorKey, secret);
    assert.equal(saved.liaraToken, liara);
    for (const endpoint of [
      "/api/state",
      "/api/memory/export",
      "/api/audit/export",
    ]) {
      assert.ok(
        !(await (await fetch(base + endpoint, { headers })).text()).includes(
          secret,
        ),
      );
    }
    const { readdirSync, readFileSync } = await import("node:fs");
    for (const filename of readdirSync(path.join(dir, "vault"))) {
      assert.ok(
        !readFileSync(path.join(dir, "vault", filename)).includes(
          Buffer.from(secret),
        ),
      );
    }
  }
  let state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.connections.cursor, true);
  assert.equal(state.connections.liara, before.connections.liara);
  assert.equal(state.mode, before.mode);
  const stopped = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill();
  await stopped;
  await startServer();
  state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.connections.cursor, true);
  assert.equal(state.connections.liara, before.connections.liara);
  assert.equal(state.mode, before.mode);
});

test("stored-key connection tests use persisted credentials and return only safe results", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  const { Vault } = await import("../server/vault.ts");
  const vault = new Vault(dir);
  const before = vault.get("connection");
  for (const provider of ["liara", "cursor"]) {
    const response = await fetch(base + `/api/settings/${provider}/test`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.source, "saved");
    assert.ok(!JSON.stringify(result).includes("local-test-liara"));
    assert.ok(!JSON.stringify(result).includes("local-replacement-cursor"));
  }
  assert.deepEqual(vault.get("connection"), before);
});

test("switching with the stored key updates live events, persists mode, and preserves separate histories", async () => {
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Hamrah-Client": "dashboard",
  };
  await fetch(base + "/api/settings", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ businessName: "دموی محفوظ", monitoring: false }),
  });
  const events = await fetch(base + "/api/events", {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const reader = events.body!.getReader();
  const waitForLive = (async () => {
    const decoder = new TextDecoder();
    let data = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done)
        throw new Error("Live event stream closed during mode switch");
      data += decoder.decode(chunk.value, { stream: true });
      if (data.includes('"mode":"live"')) return;
    }
  })();
  async function changeMode(mode: "demo" | "live") {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await fetch(base + "/api/connection", {
        method: "POST",
        headers,
        body: JSON.stringify({ mode }),
      });
      const result = await response.json();
      if (response.status === 409 && /منتظر پایان/.test(result.error)) {
        await delay(100);
        continue;
      }
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok(!JSON.stringify(result).includes("local-test-liara-key"));
      return;
    }
    assert.fail("Mode switch stayed busy");
  }
  await changeMode("live");
  await waitForLive;
  await reader.cancel();
  let state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.mode, "live");
  assert.equal(state.connections.liara, true);
  assert.equal(state.connections.cursor, true);
  assert.equal(state.connections.writable, false);
  assert.notEqual(state.settings.businessName, "دموی محفوظ");
  assert.ok(state.monitor.intervalMs >= 60000);
  await fetch(base + "/api/settings", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ businessName: "حساب واقعی", monitoring: false }),
  });
  const stopped = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill();
  await stopped;
  await startServer();
  state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.mode, "live");
  assert.equal(state.settings.businessName, "حساب واقعی");
  assert.equal(state.connections.cursor, true);
  assert.ok(!JSON.stringify(state).includes("local-test-liara-key"));
  await changeMode("demo");
  state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.mode, "demo");
  assert.equal(state.settings.businessName, "دموی محفوظ");
  assert.equal(state.connections.liara, true);
  assert.equal(state.connections.cursor, true);
});
