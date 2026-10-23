import "dotenv/config";
import path from "node:path";
import { Vault } from "./vault.ts";
import { digest, registerSecrets } from "./security.ts";
export const config = {
  mode: (process.env.APP_MODE === "live" ? "live" : "demo") as "live" | "demo",
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  liaraToken: process.env.LIARA_API_TOKEN || "",
  cursorKey: process.env.CURSOR_API_KEY || "",
  cursorProxyUrl: process.env.CURSOR_PROXY_URL || "",
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

const credentials = new Vault(config.dataDir);
const savedConnection =
  credentials.get<
    Pick<typeof config, "mode" | "liaraToken" | "cursorKey" | "teamId">
  >("connection");
if (savedConnection)
  Object.assign(config, {
    mode: savedConnection.mode,
    liaraToken: savedConnection.liaraToken,
    cursorKey: savedConnection.cursorKey,
    teamId: savedConnection.teamId,
  });
if (config.mode === "live")
  config.intervalMs = Math.max(60000, config.intervalMs);
registerSecrets([config.liaraToken, config.cursorKey]);

export function saveLiaraToken(token: string) {
  // Commit to disk before activating; failed writes retain the previous key.
  credentials.put("connection", {
    mode: config.mode,
    cursorKey: config.cursorKey,
    teamId: config.teamId,
    liaraToken: token,
  });
  registerSecrets([token]);
  const changed = config.liaraToken !== token;
  config.liaraToken = token;
  if (changed) {
    const managed = credentials.get<{
      appId?: string;
      databaseId?: string;
      allowedApps?: string[];
      healthUrl?: string;
      businessUrl?: string;
      secretJobId?: string;
    }>(`managed:${digest({ mode: config.mode, token, team: config.teamId })}`);
    Object.assign(config, {
      appId: managed?.appId || "",
      databaseId: managed?.databaseId || "",
      allowedApps: managed?.allowedApps || [],
      healthUrl: managed?.healthUrl || "",
      businessUrl: managed?.businessUrl || "",
    });
    if (managed?.secretJobId)
      registerSecrets(
        Object.values(
          credentials.get<Record<string, string>>(
            `app-env:${managed.secretJobId}`,
          ) || {},
        ),
      );
  }
}

export function saveCursorKey(key: string) {
  credentials.put("connection", {
    mode: config.mode,
    liaraToken: config.liaraToken,
    cursorKey: key,
    teamId: config.teamId,
  });
  registerSecrets([key]);
  config.cursorKey = key;
}
