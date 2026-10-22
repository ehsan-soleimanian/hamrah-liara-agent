import { cpSync, existsSync } from "node:fs";
import { config } from "./config.ts";
import { digest, registerSecrets } from "./security.ts";
import type { Vault } from "./vault.ts";
export interface SavedConnection {
  mode: "demo" | "live";
  liaraToken: string;
  cursorKey: string;
  teamId: string;
}
export function restoreConnection(vault: Vault) {
  const saved = vault.get<SavedConnection>("connection");
  if (saved)
    Object.assign(config, {
      mode: saved.mode,
      liaraToken: saved.liaraToken,
      cursorKey: saved.cursorKey,
      teamId: saved.teamId,
    });
  restoreManaged(vault);
  registerSecrets([config.liaraToken, config.cursorKey]);
}
export function restoreManaged(vault: Vault) {
  const account = digest({
    mode: config.mode,
    token: config.liaraToken,
    team: config.teamId,
  });
  const managed = vault.get<{
    appId?: string;
    databaseId?: string;
    healthUrl?: string;
    businessUrl?: string;
    allowedApps?: string[];
    secretJobId?: string;
  }>(`managed:${account}`);
  if (managed) {
    config.appId = managed.appId || "";
    config.databaseId = managed.databaseId || "";
    config.healthUrl = managed.healthUrl || "";
    config.businessUrl = managed.businessUrl || "";
    config.allowedApps = managed.allowedApps || [];
    if (managed.secretJobId)
      registerSecrets(
        Object.values(
          vault.get<Record<string, string>>(`app-env:${managed.secretJobId}`) ||
            {},
        ),
      );
  }
}
export function copyProjectSnapshot(from: string, to: string) {
  if (!existsSync(to))
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}
