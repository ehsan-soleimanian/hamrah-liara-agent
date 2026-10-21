import "dotenv/config";
import path from "node:path";
export const config = {
  mode: (process.env.APP_MODE === "live" ? "live" : "demo") as "live" | "demo",
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  liaraToken: process.env.LIARA_API_TOKEN || "",
  cursorKey: process.env.CURSOR_API_KEY || "",
  model: process.env.CURSOR_MODEL || "composer-2.5",
  password: process.env.DASHBOARD_PASSWORD || "",
  appId: process.env.LIARA_APP_ID || "",
  databaseId: process.env.LIARA_DATABASE_ID || "",
  teamId: process.env.LIARA_TEAM_ID || "",
  allowedApps: (process.env.LIARA_ALLOWED_APP_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  healthUrl: process.env.APP_HEALTH_URL || "",
  businessUrl: process.env.APP_BUSINESS_CHECK_URL || "",
  demoUrl: process.env.DEMO_APP_URL || "http://127.0.0.1:3002",
  demoToken: process.env.DEMO_CONTROL_TOKEN || "hamrah-local-demo-only",
  intervalMs: Math.max(
    2000,
    Number(
      process.env.MONITOR_INTERVAL_MS ||
        (process.env.APP_MODE === "live" ? 60000 : 5000),
    ),
  ),
  threshold: Math.max(1, Number(process.env.MONITOR_FAILURE_THRESHOLD || 3)),
};
if (
  !["127.0.0.1", "localhost", "::1"].includes(config.host) &&
  config.password.length < 20
)
  throw new Error(
    "Set DASHBOARD_PASSWORD (20+ characters) before exposing the server.",
  );
