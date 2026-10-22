import { test } from "node:test";
import assert from "node:assert/strict";
import { liaraFetch } from "../server/liara-transport.ts";
test("transport refuses a foreign origin before transmitting credentials", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  try {
    await assert.rejects(
      () =>
        liaraFetch("https://unexpected.example", {
          headers: { Authorization: "Bearer test-secret" },
        }),
      /origin/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});
test("transport never replays an uncertain write", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("reset", { cause: { code: "ECONNRESET" } });
  };
  try {
    await assert.rejects(
      () =>
        liaraFetch("https://api.liara.ir/v1/projects", {
          method: "POST",
          body: "{}",
        }),
      /reset/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
