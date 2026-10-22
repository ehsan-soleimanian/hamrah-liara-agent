import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

test("Cursor uses replacement keys immediately, redacts old keys and retains the last key if persistence fails", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-cursor-key-"));
  process.env.DATA_DIR = dir;
  process.env.CURSOR_API_KEY = "";
  const { config, saveCursorKey } = await import("../server/config.ts");
  const { Store } = await import("../server/store.ts");
  const { CursorBrain } = await import("../server/cursor.ts");
  const { redact } = await import("../server/security.ts");
  const { Agent } = await import("@cursor/sdk");
  const create = Agent.create;
  const resume = Agent.resume;
  const db = new Store(path.join(dir, "test-db"));
  const keys: string[] = [];
  function fakeAgent(options: { apiKey?: string }) {
    keys.push(options.apiKey || "");
    return {
      agentId: "local-cursor-test-agent",
      send: async () => ({
        id: "local-test-run",
        wait: async () => ({ status: "finished", result: "پاسخ آزمایشی" }),
        cancel: async () => {},
      }),
      [Symbol.asyncDispose]: async () => {},
    };
  }
  Agent.create = (async (options: { apiKey?: string }) =>
    fakeAgent(options)) as unknown as typeof Agent.create;
  Agent.resume = (async (_id: string, options?: { apiKey?: string }) =>
    fakeAgent(options ?? {})) as unknown as typeof Agent.resume;
  try {
    const brain = new CursorBrain(db, {});
    const previousLiara = config.liaraToken;
    const previousMode = config.mode;
    saveCursorKey("first-cursor-key-for-local-test");
    await brain.send("درخواست اول");
    saveCursorKey("replacement-cursor-key-for-local-test");
    await brain.send("درخواست دوم");
    assert.deepEqual(keys, [
      "first-cursor-key-for-local-test",
      "replacement-cursor-key-for-local-test",
    ]);
    assert.equal(config.liaraToken, previousLiara);
    assert.equal(config.mode, previousMode);
    assert.equal(redact(keys.join(" ")), "[REDACTED] [REDACTED]");
    const blockedWrite = path.join(
      dir,
      "vault",
      createHash("sha256").update("connection").digest("hex") + ".enc.tmp",
    );
    mkdirSync(blockedWrite);
    assert.throws(() => saveCursorKey("failed-cursor-key-for-local-test"));
    assert.equal(config.cursorKey, "replacement-cursor-key-for-local-test");
  } finally {
    Agent.create = create;
    Agent.resume = resume;
    db.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())));
    rmSync(dir, { recursive: true, force: true });
  }
});
