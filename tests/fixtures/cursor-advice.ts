// Explicit isolated test preloader. Never imported by the production launcher.
import { Agent, type AgentOptions, type SDKCustomTool } from "@cursor/sdk";
import { fixtureZip } from "./zip.ts";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
if (
  process.env.HAMRAH_CURSOR_FIXTURE !== "isolated-test" ||
  !path
    .resolve(process.env.DATA_DIR || "")
    .startsWith(path.resolve(tmpdir()) + path.sep) ||
  !process.env.CURSOR_API_KEY?.startsWith("fixture-")
)
  throw Error(
    "Refusing to load Cursor fixture outside its isolated test directory",
  );
const blocked = () =>
  !!process.env.HAMRAH_CURSOR_FAIL_FILE &&
  existsSync(process.env.HAMRAH_CURSOR_FAIL_FILE);
const archive = fixtureZip({
  "shop/package.json": JSON.stringify({
    scripts: { start: "node server.js" },
    dependencies: { express: "5", pg: "8" },
  }),
  "shop/server.js":
    'import express from "express"; import pg from "pg"; const db=new pg.Pool({connectionString:process.env.DATABASE_URL}); const app=express(); app.get("/",(req,res)=>res.send("fixture"));app.listen(process.env.PORT || 3000);',
});
const p = (
  ram: number,
  cpu: number,
  price: number,
  supports: string[] = [],
) => ({
  available: true,
  region: "iran",
  price,
  RAM: { amount: ram },
  CPU: { amount: cpu },
  volume: 5,
  supports,
});
const metadata = {
  plans: {
    projects: { small: p(0.5, 0.5, 1000), medium: p(1, 1, 2000) },
    databases: { db: p(0.5, 0.5, 500, ["postgres"]) },
    projectBundlePlans: {
      small: { basic: { available: true, displayPrice: 1000 } },
      medium: { basic: { available: true, displayPrice: 2000 } },
    },
    databaseBundlePlans: {
      db: { basic: { available: true, displayPrice: 500 } },
    },
  },
  databaseVersions: { postgres: [{ value: "16" }] },
};
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ),
    method = init?.method || "GET";
  if (["localhost", "127.0.0.1"].includes(url.hostname))
    return original(input, init);
  if (method !== "GET") throw Error("Fixture forbids all external mutations");
  if (url.origin === "https://api.liara.ir") {
    if (url.pathname === "/v1/me") {
      await new Promise((r) => setTimeout(r, 300));
      return Response.json(metadata);
    }
    if (url.pathname === "/v1/networks") return Response.json({ networks: [] });
    if (url.pathname === "/v2/teams") return Response.json({ teams: [] });
    if (url.pathname === "/v1/billing")
      return Response.json({ user: { balance: 5000000 } });
    if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
    if (url.pathname === "/v1/databases")
      return Response.json({ databases: [] });
  }
  if (url.origin === "https://api.cursor.com" && url.pathname === "/v1/me")
    return blocked()
      ? Response.json(
          { error: "Cursor is not available in your region" },
          { status: 403 },
        )
      : Response.json({
          apiKeyName: "FIXTURE ONLY",
          createdAt: "2026-01-01T00:00:00Z",
        });
  if (url.origin === "https://api.github.com") {
    if (url.pathname === "/repos/fixture/shop/commits/HEAD")
      return Response.json({ sha: "1".repeat(40) });
    if (url.pathname === `/repos/fixture/shop/zipball/${"1".repeat(40)}`)
      return new Response(new Uint8Array(archive), {
        headers: { "Content-Type": "application/zip" },
      });
  }
  throw Error(
    `Unexpected network request in isolated fixture: ${url.origin}${url.pathname}`,
  );
};
const make = (options?: AgentOptions) => ({
  agentId: "fixture-agent-" + randomUUID(),
  send: async () => {
    if (blocked())
      throw Error(
        "[permission_denied] Cursor is not available in your region.",
      );
    const tools = options?.local?.customTools as Record<string, SDKCustomTool>,
      ctx = { toolCallId: "fixture-call", sessionId: "fixture-session" };
    if (tools.cursor_probe) await tools.cursor_probe.execute({}, ctx);
    if (tools.submit_project_recommendation) {
      await tools.get_project_source.execute({}, ctx);
      await new Promise((r) => setTimeout(r, 250));
      await tools.get_liara_catalog.execute({}, ctx);
      const packages = [
        {
          id: "start",
          title: "شروع اقتصادی",
          appPlanId: "small/basic",
          reason:
            "برای شروع کم‌ترافیک این نمونه، برنامه و دیتابیس خصوصی کافی است.",
        },
        {
          id: "room",
          title: "فضای بیشتر برای رشد",
          appPlanId: "medium/basic",
          reason:
            "اگر هم‌زمانی مشتری‌ها بیشتر شود، این اندازه فضای بیشتری برای برنامه دارد.",
        },
      ].map((p) => ({
        ...p,
        databases: [
          {
            type: "postgres",
            planId: "db/basic",
            version: "16",
            reason: "وابستگی pg و اتصال DATABASE_URL در کد دیده شد.",
          },
        ],
        evidence: ["package.json", "server.js"],
      }));
      await new Promise((r) => setTimeout(r, 250));
      await tools.submit_project_recommendation.execute(
        {
          summary:
            "این محیط آزمون ایزوله است؛ پاسخ Cursor و APIها شبیه‌سازی شده‌اند. کد نمونه یک برنامهٔ Express با PostgreSQL است.",
          assumptions: [
            "این پیشنهاد فقط پاسخ شبیه‌سازی‌شده برای آزمایش رابط است؛ اجرای واقعی Cursor محسوب نمی‌شود.",
            "مصرف منابع تخمینی است و پس از انتشار نیاز به پایش دارد.",
          ],
          recommendedId: "start",
          packages,
        },
        ctx,
      );
    }
    return {
      id: "fixture-run-" + randomUUID(),
      wait: async () => ({
        status: "finished",
        result: "پاسخ شبیه‌سازی‌شدهٔ SDK برای تست؛ اجرای واقعی Cursor نیست.",
      }),
      cancel: async () => {},
    };
  },
  [Symbol.asyncDispose]: async () => {},
});
Agent.create = (async (options: AgentOptions) =>
  make(options)) as unknown as typeof Agent.create;
Agent.resume = (async (_id: string, options?: Partial<AgentOptions>) =>
  make(options as AgentOptions)) as unknown as typeof Agent.resume;
