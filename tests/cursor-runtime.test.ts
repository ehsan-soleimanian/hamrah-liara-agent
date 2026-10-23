import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent, type AgentOptions, type SDKCustomTool } from "@cursor/sdk";
import { config } from "../server/config.ts";
import { CursorBrain } from "../server/cursor.ts";
import { Store } from "../server/store.ts";
test("a hung Cursor run times out, rejects late tool calls, records safe failure and releases its lock for retry", async () => {
  const old = { ...config },
    create = Agent.create,
    resume = Agent.resume,
    dir = mkdtempSync(path.join(tmpdir(), "hamrah-runtime-"));
  Object.assign(config, { dataDir: dir, cursorKey: "fixture-runtime-key" });
  const db = new Store(dir);
  let hung = true,
    executed = 0,
    cancelled = false,
    tools: Record<string, SDKCustomTool> = {};
  const fake = (options?: AgentOptions) => {
    tools = options!.local!.customTools!;
    return {
      agentId: "fixture-runtime-agent",
      send: async () => ({
        id: "fixture-runtime-run",
        wait: () =>
          hung
            ? new Promise(() => {})
            : Promise.resolve({
                status: "finished",
                result: "fixture model success",
              }),
        cancel: async () => {
          cancelled = true;
        },
      }),
      [Symbol.asyncDispose]: async () => {},
    };
  };
  Agent.create = (async (options: AgentOptions) =>
    fake(options)) as unknown as typeof Agent.create;
  Agent.resume = (async (_id: string, options?: Partial<AgentOptions>) =>
    fake(options as AgentOptions)) as unknown as typeof Agent.resume;
  try {
    const brain = new CursorBrain(db, {
      request_action: {
        execute: () => {
          throw Error("write must not be available");
        },
      },
    });
    const policy = {
      readOnly: true,
      sessionKey: "project-fixture",
      timeoutMs: 20,
      customTools: {
        source: {
          annotations: { readOnlyHint: true },
          execute: async () => {
            executed++;
            return "fixture";
          },
        },
      },
    };
    await assert.rejects(() => brain.send("fixture", policy), /مهلت/);
    assert.equal(cancelled, true);
    assert.equal(brain.isBusy, false);
    assert.equal(db.value<any>("cursorStatus", {}).code, "timeout");
    assert.deepEqual(Object.keys(tools), ["source"]);
    await assert.rejects(async () => tools.source.execute({}, {}), /مهلت/);
    assert.equal(executed, 0);
    hung = false;
    await brain.send("fixture retry", policy);
    assert.equal(db.value<any>("cursorStatus", {}).ok, true);
    assert.equal(
      db.value<any>("cursorStatus", {}).runId,
      "fixture-runtime-run",
    );
    assert.equal(
      db.value("cursorAgentId", null),
      null,
      "project session must not overwrite the SRE conversation",
    );
  } finally {
    Agent.create = create;
    Agent.resume = resume;
    db.close();
    Object.assign(config, old);
  }
});
