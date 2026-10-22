import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

test("existing Liara clients use a replacement key and redact previous keys", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-key-tests-"));
  process.env.DATA_DIR = dir;
  process.env.LIARA_API_TOKEN = "";
  try {
    const { config, saveLiaraToken } = await import("../server/config.ts");
    const { Liara } = await import("../server/liara.ts");
    const { redact } = await import("../server/security.ts");
    const authorizations: string[] = [];
    const fake: typeof fetch = async (_input, init) => {
      authorizations.push(
        new Headers(init?.headers).get("Authorization") || "",
      );
      return Response.json({ projects: [] });
    };
    const client = new Liara(undefined, fake);
    saveLiaraToken("first-key-for-local-test");
    await client.apps();
    saveLiaraToken("replacement-key-for-local-test");
    await client.apps();
    assert.deepEqual(authorizations, [
      "Bearer first-key-for-local-test",
      "Bearer replacement-key-for-local-test",
    ]);
    assert.equal(config.liaraToken, "replacement-key-for-local-test");
    assert.equal(
      redact("first-key-for-local-test replacement-key-for-local-test"),
      "[REDACTED] [REDACTED]",
    );
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all Liara calls bind the approved team via query, preserving existing parameters and never silently using a personal account", async () => {
  const { Liara } = await import("../server/liara.ts");
  const captured: { url: URL; method: string; header: string | null }[] = [];
  const client = new Liara(
    "test-key",
    async (input, init) => {
      captured.push({
        url: new URL(String(input)),
        method: init?.method || "GET",
        header: new Headers(init?.headers).get("x-team-id"),
      });
      return Response.json({});
    },
    "approved-team",
  );
  await client.call("/v1/projects/example/releases?page=1&count=20");
  await client.call("/v1/projects?teamID=wrong-team", "POST", {
    name: "example",
  });
  assert.equal(captured[0].url.searchParams.get("page"), "1");
  assert.ok(
    captured.every((c) => c.url.searchParams.get("teamID") === "approved-team"),
  );
  assert.ok(captured.every((c) => c.header === null));
  await assert.rejects(
    () => client.call("https://attacker.example/secrets"),
    /endpoint/,
  );
});

test("transient DNS failures retry reads once, expose only a safe code, and never replay writes", async () => {
  const { Liara } = await import("../server/liara.ts");
  let calls = 0;
  const error = () =>
    new TypeError("private transport detail", { cause: { code: "EAI_AGAIN" } });
  const client = new Liara(
    "test-key",
    async () => {
      if (++calls === 1) throw error();
      return Response.json({ projects: [] });
    },
    "",
  );
  await client.apps();
  assert.equal(calls, 2);
  let writes = 0;
  const bad = new Liara(
    "test-key",
    async () => {
      writes++;
      throw error();
    },
    "",
  );
  await assert.rejects(() => bad.call("/v1/projects", "POST", {}));
  assert.equal(writes, 1);
  await assert.rejects(() => bad.apps(), /EAI_AGAIN/);
  assert.equal(writes, 3);
});
