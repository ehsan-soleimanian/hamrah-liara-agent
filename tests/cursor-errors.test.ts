import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorFailure } from "../server/cursor-errors.ts";
import {
  testConnection,
  ConnectionTestError,
} from "../server/connection-test.ts";

test("provider region rejection is distinguished from a bad key without echoing upstream data", async () => {
  const error = cursorFailure(
    new Error(
      "[permission_denied] Cursor is not available in your region. PRIVATE_VENDOR_BODY",
    ),
  );
  assert.equal(error.code, "region_blocked");
  assert.equal(error.httpStatus, 403);
  assert.match(error.message, /منطقه/);
  assert.doesNotMatch(error.message, /PRIVATE_VENDOR_BODY/);
  const request: typeof fetch = async () =>
    Response.json(
      { error: "Cursor is not available in your region. PRIVATE_VENDOR_BODY" },
      { status: 403 },
    );
  await assert.rejects(
    () => testConnection("cursor", "PRIVATE_TEST_KEY", "", request),
    (e: unknown) =>
      e instanceof ConnectionTestError &&
      e.status === 403 &&
      /منطقه/.test(e.message) &&
      !e.message.includes("PRIVATE"),
  );
});
test("SDK auth, limits, transport and malformed output remain distinct and safely actionable", () => {
  assert.equal(
    cursorFailure(new Error("[unauthenticated] invalid api key")).code,
    "invalid_key",
  );
  assert.equal(
    cursorFailure(new Error("[resource_exhausted] limit")).code,
    "rate_limited",
  );
  assert.equal(
    cursorFailure(new Error("fetch failed PRIVATE_DATA")).code,
    "network",
  );
  assert.doesNotMatch(
    cursorFailure(new Error("UNKNOWN PRIVATE_DATA")).message,
    /PRIVATE_DATA/,
  );
});
