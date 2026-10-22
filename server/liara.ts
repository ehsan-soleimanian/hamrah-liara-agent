import { config } from "./config.ts";
import { redact } from "./security.ts";
import { liaraFetch } from "./liara-transport.ts";
import type { Service, Backup, Release } from "../src/types.ts";
const safe = (s: string) => encodeURIComponent(s);
export class LiaraError extends Error {
  operation?: "source_upload" | "release_create";
  constructor(public status: number) {
    super(
      status === 402
        ? "لیارا اعتبار حساب انتخاب‌شده را برای این عملیات نپذیرفت. ابتدا موجودی و انتخاب حساب شخصی یا تیم را بررسی کنید. (HTTP 402)"
        : status === 401 || status === 403
          ? `کلید یا دسترسی حساب لیارا اجازهٔ این عملیات را نمی‌دهد. اتصال و دسترسی تیم را بررسی کنید. (HTTP ${status})`
          : status === 429
            ? "تعداد درخواست‌ها به لیارا زیاد شده است؛ کمی بعد دوباره بررسی کنید. (HTTP 429)"
            : `لیارا درخواست را نپذیرفت (HTTP ${status}).`,
    );
  }
}
export class Liara {
  constructor(
    private token?: string,
    private request: typeof fetch = liaraFetch,
    private teamId = config.teamId,
  ) {}
  async call(endpoint: string, method = "GET", body?: unknown) {
    const token = this.token ?? config.liaraToken;
    if (!token) throw new Error("کلید API لیارا را در تنظیمات وارد کنید.");
    const url = new URL(endpoint, "https://api.liara.ir");
    if (url.origin !== "https://api.liara.ir")
      throw new Error("Invalid Liara endpoint");
    // PaaS and DBaaS use the teamID query parameter (official console/CLI contract).
    // A made-up team header is silently ignored and charges the personal account.
    if (this.teamId) url.searchParams.set("teamID", this.teamId);
    const send = () =>
      this.request(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body instanceof FormData
            ? body
            : body === undefined
              ? undefined
              : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      if (method !== "GET") throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        response = await send();
      } catch (retryError) {
        const cause = (
          retryError as Error & {
            cause?: { code?: string; errors?: { code?: string }[] };
          }
        ).cause;
        const code = cause?.code || cause?.errors?.[0]?.code || "NETWORK_ERROR";
        throw new Error(
          `ارتباط خواندنی با لیارا برقرار نشد (${/^[A-Z_0-9]+$/.test(code) ? code : "NETWORK_ERROR"}).`,
        );
      }
    }
    if (!response.ok) throw new LiaraError(response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  async apps(): Promise<Service[]> {
    const data = await this.call("/v1/projects");
    if (!Array.isArray(data.projects))
      throw new Error(
        "پاسخ فهرست برنامه‌های لیارا با قالب مورد انتظار هم‌خوانی ندارد.",
      );
    return data.projects.map((p: Record<string, unknown>) => ({
      id: String(p.project_id || p._id),
      name: String(p.project_id || p._id),
      platform: String(p.type || "app"),
      type: "app",
      status: p.scale === 0 ? "down" : "unknown",
      detail: p.scale === 0 ? "سرویس خاموش است" : "منتظر بررسی سلامت",
      plan: String(p.planID || "—"),
    }));
  }
  async logs(app: string) {
    return {
      source: "Liara logs API",
      text: redact(
        await this.call(
          `/v2/projects/${safe(app)}/logs?start=${Math.floor(Date.now() / 1000) - 1800}&direction=forward&last_lines=true`,
        ),
      ),
    };
  }
  async metrics(app: string) {
    return this.call(`/v1/projects/${safe(app)}/metrics/summary`);
  }
  async restart(app: string) {
    this.assertWritable(app);
    return this.call(`/v1/projects/${safe(app)}/actions/restart`, "POST");
  }
  async backups(): Promise<Backup[]> {
    if (!config.databaseId) return [];
    const data = await this.call(
      `/v1/databases/${safe(config.databaseId)}/backups`,
    );
    return (data.backups || []).map((b: Record<string, unknown>) => ({
      id: String(b.name),
      name: String(b.name),
      at: String(b.lastModified),
      size: `${(Number(b.size) / 1024 / 1024).toFixed(1)} MB`,
      status: "ready",
      source: "live",
    }));
  }
  async createBackup(app: string) {
    this.assertWritable(app);
    if (!config.databaseId)
      throw new Error("LIARA_DATABASE_ID تنظیم نشده است.");
    return this.call(
      `/v1/databases/${safe(config.databaseId)}/backups`,
      "POST",
    );
  }
  async releases(app: string): Promise<Release[]> {
    const data = await this.call(
      `/v1/projects/${safe(app)}/releases?page=1&count=20`,
    );
    return (data.releases || []).map(
      (r: Record<string, unknown>, i: number) => ({
        id: String(r._id),
        version: String(r.tag || `release-${i + 1}`),
        title: String(
          (r.gitInfo as Record<string, unknown> | undefined)?.message ||
            "انتشار لیارا",
        ),
        at: String(r.created_at || ""),
        status: String(r.state || "unknown"),
        source: "live",
      }),
    );
  }
  async deploy(
    app: string,
    archive: Buffer,
    options = { port: 3000, type: "docker" },
  ) {
    this.assertWritable(app);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
      "project.tar.gz",
    );
    const source = await this.call(
      `/v2/projects/${safe(app)}/sources`,
      "POST",
      form,
    ).catch((error) => {
      if (error instanceof LiaraError) error.operation = "source_upload";
      throw error;
    });
    if (!source.sourceID) throw new Error("لیارا شناسهٔ سورس را برنگرداند.");
    return this.call(`/v2/projects/${safe(app)}/releases`, "POST", {
      sourceID: source.sourceID,
      port: options.port,
      type: options.type,
    }).catch((error) => {
      if (error instanceof LiaraError) error.operation = "release_create";
      throw error;
    });
  }
  assertWritable(app: string) {
    if (!config.allowedApps.includes(app))
      throw new Error("این برنامه در LIARA_ALLOWED_APP_IDS مجوز تغییر ندارد.");
  }
}
