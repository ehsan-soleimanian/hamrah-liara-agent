import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Snapshot } from "../src/types.ts";
test("GitHub intake -> Cursor tool recommendation -> bound cost approval; region failure is explicit and retry reuses source", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-advice-http-")),
    fail = path.join(dir, "region-blocked");
  const socket = createServer();
  await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((r) => socket.close(() => r()));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/fixtures/cursor-advice.ts",
      "server/launcher.ts",
    ],
    {
      env: {
        ...process.env,
        APP_MODE: "live",
        PORT: String(port),
        DATA_DIR: dir,
        HOST: "127.0.0.1",
        LIARA_API_TOKEN: "fixture-liara-key",
        CURSOR_API_KEY: "fixture-cursor-key",
        LIARA_TEAM_ID: "",
        LIARA_APP_ID: "",
        LIARA_DATABASE_ID: "",
        LIARA_ALLOWED_APP_IDS: "",
        APP_HEALTH_URL: "",
        APP_BUSINESS_CHECK_URL: "",
        GITHUB_TOKEN: "",
        DASHBOARD_PASSWORD: "",
        HAMRAH_CURSOR_FIXTURE: "isolated-test",
        HAMRAH_CURSOR_FAIL_FILE: fail,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const base = `http://127.0.0.1:${port}/api`,
    headers = {
      "Content-Type": "application/json",
      "X-Hamrah-Client": "dashboard",
    };
  const post = async (route: string, body: unknown) => {
    const r = await fetch(base + route, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + "/state")).ok) break;
      } catch {}
      if (i > 600) throw Error(output || "Fixture startup timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
    const imported = await post("/projects/github", {
      url: "https://github.com/fixture/shop",
    });
    assert.equal(imported.status, 200);
    const id = imported.body.id;
    assert.equal(imported.body.advice.status, "pending");
    assert.equal(imported.body.agentReview, undefined);
    writeFileSync(fail, "region denied fixture");
    const reviewing = post(`/projects/${id}/advice`, {});
    for (let i = 0; i < 100; i++) {
      const p = await (await fetch(base + `/projects/${id}`)).json();
      if (p.advice?.status === "analyzing") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(
      (await post("/connection", { mode: "demo" })).status,
      409,
      "changing data stores must be blocked during the catalog phase before SDK starts",
    );
    assert.equal(
      (await post("/settings/cursor", { token: "fixture-key-replacement" }))
        .status,
      409,
    );
    const blocked = await reviewing;
    assert.equal(blocked.body.advice.status, "failed");
    assert.equal(blocked.body.advice.error.code, "region_blocked");
    assert.equal(blocked.body.advice.packages, undefined);
    const metadata = await post("/settings/cursor/test", {});
    assert.equal(metadata.status, 403);
    assert.match(metadata.body.error, /منطقه/);
    unlinkSync(fail);
    const ready = await post(`/projects/${id}/advice`, {});
    assert.equal(ready.body.advice.status, "ready");
    assert.equal(ready.body.advice.packages.length, 2);
    assert.ok(ready.body.advice.runId.startsWith("fixture-run-"));
    assert.equal(ready.body.hash, imported.body.hash);
    const selected = ready.body.advice.packages[1];
    const input = {
      projectId: id,
      packageId: selected.id,
      appName: "fixture-shop",
      appPlan: selected.app.id,
      networkId: "",
      databases: [
        {
          type: "postgres",
          name: "fixture-db",
          plan: "db/basic",
          version: "16",
          bindings: { DATABASE_URL: "url" },
        },
      ],
      env: {},
      healthPath: "/",
      businessPath: "",
    };
    const tampered = await post("/provision/quote", {
      ...input,
      appPlan: "small/basic",
    });
    assert.equal(tampered.status, 409);
    const quote = await post("/provision/quote", input);
    assert.equal(quote.status, 200);
    assert.equal(quote.body.status, "pending");
    assert.equal(quote.body.monthly, selected.monthly);
    assert.deepEqual(quote.body.resources, []);
    const state = (await (await fetch(base + "/state")).json()) as Snapshot;
    assert.ok(state.audit.some((a) => a.type === "project_advice_ready"));
    assert.ok(
      state.audit.some(
        (a) =>
          a.type === "tool_completed" && a.title.includes("get_project_source"),
      ),
    );
    assert.equal((await post("/settings/cursor/agent-test", {})).status, 200);
  } finally {
    child.kill();
  }
});
