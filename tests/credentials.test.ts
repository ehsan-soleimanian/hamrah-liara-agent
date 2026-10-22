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
