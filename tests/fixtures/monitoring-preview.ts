// Explicitly isolated fixture: all network calls are replaced and cloud writes are simulated.
import path from "node:path";
import { tmpdir } from "node:os";
if (
  process.env.HAMRAH_MONITOR_FIXTURE !== "1" ||
  !path
    .resolve(process.env.DATA_DIR || ".")
    .startsWith(path.join(tmpdir(), "hamrah-monitor-preview-"))
)
  throw new Error("Isolated fixture requires a marked temporary directory");
let planID = "small";
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method || "GET";
  if (url.origin === "https://preview.fixture.invalid") {
    if (url.pathname === "/health")
      await new Promise((r) => setTimeout(r, 150));
    return Response.json({ ok: true });
  }
  if (url.origin !== "https://api.liara.ir")
    throw new Error("No external networking in isolated fixture");
  if (url.pathname === "/v1/projects/fixture-app/resize" && method === "POST") {
    const body = JSON.parse(String(init?.body));
    if (body.planID !== "large") throw new Error("Unexpected fixture plan");
    planID = body.planID;
    return Response.json({});
  }
  if (method !== "GET")
    throw new Error("Unsupported write in isolated fixture");
  if (url.pathname === "/v1/me")
    return Response.json({
      plans: {
        projects: {
          small: {
            available: true,
            price: 1,
            RAM: { amount: 1 },
            CPU: { amount: 1 },
            volume: 10,
          },
          large: {
            available: true,
            price: 2,
            RAM: { amount: 2 },
            CPU: { amount: 2 },
            volume: 10,
          },
        },
        databases: {},
        projectBundlePlans: {
          small: { basic: { available: true, displayPrice: 100 } },
          large: { basic: { available: true, displayPrice: 100 } },
        },
      },
    });
  if (url.pathname === "/v1/projects")
    return Response.json({
      projects: [{ project_id: "fixture-app", planID, type: "node" }],
    });
  if (url.pathname === "/v1/projects/fixture-app")
    return Response.json({
      project: { planID, bundlePlanID: "basic", type: "node" },
    });
  if (url.pathname.endsWith("/metrics/summary"))
    return Response.json({
      cpuUsage: [
        {
          applet: "fixture-1",
          value: [Date.now() / 1000, planID === "large" ? 25 : 92],
        },
      ],
      memoryUsage: [
        {
          applet: "fixture-1",
          value: [Date.now() / 1000, planID === "large" ? 40 : 90],
        },
      ],
    });
  if (url.pathname.endsWith("/logs"))
    return Response.json({
      text: "TypeError fixture application exception; database timeout",
    });
  if (url.pathname.endsWith("/releases"))
    return Response.json({ releases: [] });
  throw new Error("Unsupported fixture read: " + url.pathname);
};
const { config } = await import("../../server/config.ts");
const { Store } = await import("../../server/store.ts");
const { Engine } = await import("../../server/engine.ts");
const { defaultMonitorPolicy } = await import("../../server/monitoring.ts");
const db = new Store(path.join(config.dataDir, "live"));
const engine = new Engine(db);
engine.updateSettings({
  businessName: "آزمون ایزوله — دادهٔ شبیه‌سازی‌شده",
  resourcePolicy: {
    ...defaultMonitorPolicy,
    latencyMs: 100,
    cpuUnit: "percent",
    memoryUnit: "percent",
  },
});
db.set("cursorStatus", {
  ok: false,
  code: "region_blocked",
  model: config.model,
  checkedAt: new Date().toISOString(),
  message:
    "نمونهٔ آزمون: Cursor دسترسی از منطقهٔ فعلی سرور را نمی‌پذیرد؛ تحلیل مبتنی بر قواعد فعال است.",
});
await engine.tick(true);
await engine.tick(true);
await engine.tick(true);
await new Promise((r) => setTimeout(r, 25));
engine.stop();
db.close();
await import("../../server/index.ts");
