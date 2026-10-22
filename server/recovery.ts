import { randomUUID } from "node:crypto";
import { orderSnapshot, ordersHash } from "./order-snapshot.ts";
import { config } from "./config.ts";
import { digest, registerSecrets } from "./security.ts";
import { Vault } from "./vault.ts";
import type { Store } from "./store.ts";
import type { Backup, RestorePreview } from "../src/types.ts";

// This is an explicit contract of our owned florist sample, not an invented Liara restore API.
export class Recovery {
  constructor(
    private db: Store,
    private local: (endpoint: string, body?: unknown) => Promise<any>,
  ) {}
  scope() {
    return digest({
      mode: config.mode,
      token: config.liaraToken,
      team: config.teamId,
      app: config.mode === "demo" ? "golbazar" : config.appId,
      database: config.databaseId,
    });
  }
  private secret() {
    const vault = new Vault(config.dataDir);
    const account = digest({
      mode: config.mode,
      token: config.liaraToken,
      team: config.teamId,
    });
    const managed = vault.get<{ appId?: string; secretJobId?: string }>(`managed:${account}`);
    if (managed?.appId !== config.appId) return "";
    const env = managed?.secretJobId
      ? vault.get<Record<string, string>>(`app-env:${managed.secretJobId}`)
      : undefined;
    return env?.HAMRAH_CONTROL_TOKEN || env?.TEST_CONTROL_TOKEN || "";
  }
  available() {
    return (
      config.mode === "demo" ||
      (!!config.healthUrl && this.secret().length >= 32)
    );
  }
  async control(endpoint: string, body?: unknown) {
    if (config.mode === "demo") return this.local(endpoint, body);
    if (!this.available() || !config.allowedApps.includes(config.appId))
      throw new Error(
        "قرارداد امن بازیابی گل‌بازار برای این برنامه متصل نیست.",
      );
    const secret = this.secret();
    registerSecrets([secret]);
    const origin = new URL(config.healthUrl).origin;
    if (!origin.startsWith("https://"))
      throw new Error("بازیابی ابری فقط با HTTPS مجاز است.");
    const response = await fetch(`${origin}/control/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? "سفارش‌ها تغییر کرده‌اند؛ پیش‌نمایش تازه بگیرید."
          : `قرارداد بازیابی گل‌بازار تأیید نشد (${response.status}).`,
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > 4_000_000)
      throw new Error("حجم نسخه از حد مجاز این نمونه بیشتر است.");
    return JSON.parse(text);
  }
  list() {
    return this.db
      .list<Backup>("backups")
      .filter((b) => b.scope === this.scope());
  }
  read(id: string) {
    const record = this.list().find((b) => b.id === id);
    if (!record) throw new Error("نسخهٔ پشتیبان این فروشگاه پیدا نشد.");
    const payload = orderSnapshot.parse(
      new Vault(config.dataDir).get(`orders:${id}`),
    );
    if (ordersHash(payload.orders) !== record.checksum)
      throw new Error("یکپارچگی نسخهٔ پشتیبان تأیید نشد؛ بازیابی متوقف شد.");
    return { record, payload };
  }
  async create(purpose = "درخواست شما") {
    const scope = this.scope();
    const payload = orderSnapshot.parse(await this.control("backup"));
    if (new Set(payload.orders.map((o) => o.id)).size !== payload.orders.length)
      throw new Error("شناسهٔ سفارش تکراری است.");
    // A dry run inserts into an isolated temporary table and checks all rows, without touching orders.
    const tested = await this.control("restore-preview", payload);
    if (
      tested.ok !== true ||
      tested.checksum !== ordersHash(payload.orders) ||
      tested.count !== payload.orders.length
    )
      throw new Error("آزمایش خواندن نسخهٔ پشتیبان موفق نبود.");
    if (scope !== this.scope())
      throw new Error("حساب هنگام تهیهٔ نسخه تغییر کرد.");
    const id = randomUUID();
    const vault = new Vault(config.dataDir);
    vault.put(`orders:${id}`, payload);
    const persisted = orderSnapshot.parse(vault.get(`orders:${id}`));
    if (ordersHash(persisted.orders) !== tested.checksum)
      throw new Error("بازخوانی نسخهٔ ذخیره‌شده موفق نبود.");
    const record: Backup = {
      id,
      name: purpose,
      at: new Date().toISOString(),
      size: `${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)} KB`,
      status: "ready",
      source: config.mode,
      checksum: tested.checksum,
      orderCount: payload.orders.length,
      verifiedAt: new Date().toISOString(),
      scope,
      purpose,
    };
    this.db.put("backups", record);
    this.db.audit(
      "backup_verified",
      "نسخه ذخیره و در جدول جداگانه آزمایش شد",
      `${id}; rows=${record.orderCount}; sha256=${record.checksum}`,
    );
    return record;
  }
  async preview(id: string): Promise<RestorePreview> {
    const { record, payload } = this.read(id);
    const current = orderSnapshot.parse(await this.control("backup"));
    const tested = await this.control("restore-preview", payload);
    if (tested.ok !== true || tested.checksum !== record.checksum)
      throw new Error("آزمایش نسخه موفق نبود.");
    const rows = new Map(payload.orders.map((o) => [o.id, o]));
    const at = new Date().toISOString();
    const preview: RestorePreview = {
      backupId: id,
      backupCount: payload.orders.length,
      currentCount: current.orders.length,
      removedCount: current.orders.filter((o) => !rows.has(o.id)).length,
      changedCount: current.orders.filter(
        (o) => rows.has(o.id) && digest(rows.get(o.id)) !== digest(o),
      ).length,
      currentHash: ordersHash(current.orders),
      checksum: record.checksum!,
      at,
      expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
    };
    this.db.set(`restore-preview:${id}`, preview);
    return preview;
  }
  async restore(id: string, currentHash: string) {
    const { payload } = this.read(id);
    await this.control("restore", {
      ...payload,
      expectedCurrentHash: currentHash,
    });
    const restored = orderSnapshot.parse(await this.control("backup"));
    if (ordersHash(restored.orders) !== ordersHash(payload.orders))
      throw new Error("سفارش‌های بازیابی‌شده با نسخه یکسان نیستند.");
  }
}
