import { test } from "node:test";
import assert from "node:assert/strict";
import {
  testConnection,
  ConnectionTestError,
} from "../server/connection-test.ts";

test("connection checks send credentials only to fixed read endpoints and return no account data", async () => {
  for (const provider of ["liara", "cursor"] as const) {
    let called = false;
    const request: typeof fetch = async (url, options) => {
      called = true;
      assert.equal(
        url,
        provider === "liara"
          ? "https://api.liara.ir/v1/projects"
          : "https://api.cursor.com/v1/me",
      );
      assert.equal(options?.method, "GET");
      assert.equal(options?.body, undefined);
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("Authorization"), "Bearer local-test-secret");
      assert.equal(
        headers.get("x-team-id"),
        provider === "liara" ? "test-team" : null,
      );
      return Response.json(
        provider === "liara"
          ? { projects: [] }
          : {
              apiKeyName: "Private key name",
              createdAt: "2026-01-01T00:00:00Z",
              userEmail: "private@example.com",
            },
      );
    };
    const result = await testConnection(
      provider,
      "local-test-secret",
      "test-team",
      request,
    );
    assert.equal(called, true);
    assert.equal(result.ok, true);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.doesNotMatch(
      JSON.stringify(result),
      /local-test-secret|private@example|Private key name/,
    );
  }
});

test("missing keys never contact providers and service errors stay distinct without exposing their bodies", async () => {
  const unexpected: typeof fetch = async () => {
    throw new Error("must not be called");
  };
  for (const provider of ["liara", "cursor"] as const) {
    await assert.rejects(
      testConnection(provider, "", "", unexpected),
      (error: unknown) =>
        error instanceof ConnectionTestError && error.status === 400,
    );
    for (const [http, status, message] of [
      [401, 422, /پذیرفته نشد/],
      [403, 422, /دسترسی/],
      [429, 429, /محدودیت/],
      [500, 502, /HTTP 500/],
      [302, 502, /HTTP 302/],
    ] as const) {
      const request: typeof fetch = async () =>
        new Response("leaked-token account@example.com", { status: http });
      await assert.rejects(
        testConnection(provider, "leaked-token", "", request),
        (error: unknown) => {
          assert.ok(error instanceof ConnectionTestError);
          assert.equal(error.status, status);
          assert.match(error.message, message);
          assert.doesNotMatch(error.message, /leaked-token|account@example/);
          return true;
        },
      );
    }
  }
});

test("HTTP 200, a network error and a timeout cannot falsely confirm a connection", async () => {
  for (const provider of ["liara", "cursor"] as const) {
    for (const reply of [
      () => Response.json({}),
      () => Response.json({ error: "secret-value" }),
      () => new Response("<html>Login</html>"),
    ]) {
      const request: typeof fetch = async () => reply();
      await assert.rejects(
        testConnection(provider, "secret-value", "", request),
        (error: unknown) =>
          error instanceof ConnectionTestError &&
          error.status === 502 &&
          !error.message.includes("secret-value"),
      );
    }
    const network: typeof fetch = async () => {
      throw new TypeError("secret-value from upstream");
    };
    await assert.rejects(
      testConnection(provider, "secret-value", "", network),
      /اینترنت سرور/,
    );
    const timeout: typeof fetch = async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("abort signal did not fire")),
          1000,
        );
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    await assert.rejects(
      testConnection(provider, "secret-value", "", timeout, 10),
      (error: unknown) =>
        error instanceof ConnectionTestError && error.status === 504,
    );
  }
});
