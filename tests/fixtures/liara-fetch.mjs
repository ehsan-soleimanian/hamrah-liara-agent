// Only loaded by the isolated HTTP test child, never by the application launcher.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? input));
  if (url.origin === "https://api.cursor.com") {
    if (url.pathname !== "/v1/me" || init?.method !== "GET")
      throw new Error("Unexpected Cursor operation in connection test");
    const key = new Headers(init?.headers).get("Authorization");
    if (
      key === "Bearer valid-unsaved-cursor-key" ||
      key === "Bearer local-replacement-cursor-key-13579"
    )
      return Response.json({
        apiKeyName: "Private account key",
        createdAt: "2026-01-01T00:00:00Z",
        userEmail: "private@example.com",
      });
    return Response.json({ error: key }, { status: 401 });
  }
  if (url.origin !== "https://api.liara.ir") return originalFetch(input, init);
  const headers = new Headers(init?.headers);
  if (
    ![
      "Bearer local-test-liara-key-24681357",
      "Bearer valid-unsaved-liara-key",
    ].includes(headers.get("Authorization"))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (url.pathname === "/v1/me") {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return Response.json({ _id: "isolated-test-account" });
  }
  if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
  throw new Error(`Unexpected Liara request in HTTP test: ${url.pathname}`);
};
