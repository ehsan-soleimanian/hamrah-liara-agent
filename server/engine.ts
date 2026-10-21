import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as tar from "tar";
import { z } from "zod";
import { config } from "./config.ts";
import { Store } from "./store.ts";
import { Liara } from "./liara.ts";
import { CursorBrain } from "./cursor.ts";
import { digest, redact } from "./security.ts";
import { transition } from "./machine.ts";
import type {
  Action,
  ActionKind,
  Incident,
  IncidentStatus,
  Message,
  Probe,
  Service,
  Settings,
  Snapshot,
  Backup,
  Release,
} from "../src/types.ts";
const now = () => new Date().toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sourceFiles = ["Dockerfile", "package.json", "index.mjs", "liara.json"];
const sourceHash = () =>
  digest(
    sourceFiles.map((file) => [
      file,
      readFileSync(path.resolve("demo/site", file), "utf8"),
    ]),
  );
const actionSchema = z
  .object({
    kind: z.enum([
      "restart_app",
      "deploy_release",
      "restore_backup",
      "create_backup",
      "enable_redis",
      "enable_email",
    ]),
    target: z.string().min(1).max(100),
    incidentId: z.string().optional(),
    backupId: z.string().optional(),
  })
  .strict();
export class Engine {
  liara = new Liara();
  brain: CursorBrain;
  services: Service[] = [];
  notices: string[] = [];
  listeners = new Set<() => void>();
  probing = false;
  executing = false;
  timer?: ReturnType<typeof setInterval>;
  lastCheck?: string;
  failures = 0;
  constructor(public db: Store) {
    this.brain = new CursorBrain(db, {
      list_apps: {
        description: "List the actual connected apps. Read only.",
        annotations: { readOnlyHint: true },
        execute: async () => ({
          content: [{ type: "text", text: redact(await this.loadServices()) }],
        }),
      },
      get_logs: {
        description: "Read redacted logs for the configured managed app.",
        annotations: { readOnlyHint: true },
        execute: async () => ({
          content: [{ type: "text", text: redact(await this.logs()) }],
        }),
      },
      get_metrics: {
        description:
          "Read actual Liara resource metrics. May be unavailable; never invent values.",
        annotations: { readOnlyHint: true },
        execute: async () => ({
          content: [
            {
              type: "text",
              text: redact(
                config.mode === "demo"
                  ? { source: "demo", cpu: 18, memory: 42 }
                  : await this.liara.metrics(this.appId()),
              ),
            },
          ],
        }),
      },
      get_memory: {
        description:
          "Read incidents, recent probes, prior decisions and conversation from persistent memory.",
        annotations: { readOnlyHint: true },
        execute: async () => ({
          content: [
            {
              type: "text",
              text: redact({
                requirements: db.value("businessRequirements", {}),
                incidents: db.list<Incident>("incidents").slice(0, 8),
                probes: db.list<Probe>("probes").slice(0, 8),
                messages: db.list<Message>("messages").slice(0, 12),
                audit: db.auditList().slice(0, 12),
              }),
            },
          ],
        }),
      },
      request_action: {
        description:
          "Request a sensitive action. ONLY creates a pending human approval. Does NOT execute. Allowed kinds restart_app or create_backup. Do not use if no supporting evidence.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["restart_app", "create_backup"] },
            target: { type: "string" },
            incidentId: { type: "string" },
          },
          required: ["kind", "target"],
          additionalProperties: false,
        },
        execute: async (args) => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(this.propose(actionSchema.parse(args))),
            },
          ],
        }),
      },
    });
    if (!db.value("initialized", false)) this.seed();
    // A crash after dispatch leaves the outcome uncertain: never blindly replay it.
    for (const action of db.list<Action>("actions"))
      if (action.status === "executing") {
        db.put("actions", {
          ...action,
          status: "failed",
          error:
            "برنامه هنگام اجرای عملیات بسته شد؛ وضعیت واقعی باید دوباره بررسی شود.",
        });
        const incident = action.incidentId
          ? db.get<Incident>("incidents", action.incidentId)
          : undefined;
        if (incident && ["EXECUTING", "VERIFYING"].includes(incident.status))
          this.move(
            incident.id,
            "ESCALATED",
            "راه‌اندازی مجدد مدیر؛ نتیجهٔ عملیات نامشخص است.",
          );
        db.audit(
          "recovery",
          "عملیات نیمه‌تمام برای بررسی علامت‌گذاری شد",
          action.id,
        );
      }
    for (const incident of db.list<Incident>("incidents"))
      if (
        [
          "DETECTED",
          "INVESTIGATING",
          "PLAN_READY",
          "EXECUTING",
          "VERIFYING",
        ].includes(incident.status)
      ) {
        this.move(
          incident.id,
          "ESCALATED",
          "سرور در میانهٔ بررسی یا اجرا دوباره راه‌اندازی شد؛ نتیجه باید با شواهد تازه بررسی شود.",
        );
      }
  }
  appId() {
    return config.mode === "demo" ? "golbazar" : config.appId;
  }
  settings(): Settings {
    return this.db.value("settings", {
      monitoring: true,
      notify: true,
      businessName: "گل‌بازار",
    });
  }
  emit() {
    for (const listener of this.listeners) listener();
  }
  seed() {
    this.db.set("initialized", true);
    this.db.set("settings", {
      monitoring: true,
      notify: true,
      businessName: config.mode === "demo" ? "گل‌بازار" : "کسب‌وکار من",
    });
    this.message(
      "assistant",
      config.mode === "demo"
        ? "سلام، من همراه هستم. مراقب گل‌بازارم تا شما به کسب‌وکارتان برسید. این محیط نمایشی است؛ می‌توانید یک اختلال واقعی در فروشگاه محلی ایجاد کنید و مسیر رفع آن را ببینید."
        : "سلام، من همراه هستم. ابتدا اتصال‌ها و آدرس بررسی سلامت کسب‌وکار را تنظیم کنید. هر تغییر حساس با تأیید شما اجرا می‌شود.",
      "system",
    );
    if (config.mode === "demo") {
      this.db.put("releases", {
        id: "demo-release-1",
        version: "v1.0.0",
        title: "راه‌اندازی اولیهٔ گل‌بازار",
        at: now(),
        status: "ready",
        source: "demo",
      } satisfies Release);
      this.db.audit(
        "setup",
        "همراه آمادهٔ مراقبت است",
        "حالت نمایشی؛ داده‌های منابع نمونه هستند. بررسی‌های سلامت از فروشگاه محلی دریافت می‌شوند.",
      );
    }
  }
  message(
    role: Message["role"],
    content: string,
    provider: Message["provider"],
  ) {
    this.db.put("messages", {
      id: randomUUID(),
      role,
      content: redact(content),
      at: now(),
      provider,
    } satisfies Message);
    this.emit();
  }
  move(id: string, status: IncidentStatus, note: string) {
    const incident = this.db.get<Incident>("incidents", id);
    if (!incident) throw new Error("رخداد پیدا نشد.");
    const next = transition(incident, status, note);
    this.db.put("incidents", next);
    this.db.audit("incident", note, `${id}: ${status}`);
    this.emit();
    return next;
  }
  async control(endpoint: string, body?: unknown) {
    if (config.mode !== "demo")
      throw new Error("کنترل فروشگاه آزمایشی فقط در حالت دمو مجاز است.");
    const url = new URL(config.demoUrl);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("فروشگاه دمو باید روی همین دستگاه باشد.");
    const r = await fetch(`${config.demoUrl}/control/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${config.demoToken}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
      redirect: "error",
    });
    if (!r.ok) throw new Error(`فروشگاه آزمایشی پاسخ نداد (${r.status}).`);
    return r.json();
  }
  async loadServices() {
    if (config.mode === "demo") {
      const last = this.db.list<Probe>("probes")[0];
      this.services = [
        {
          id: "golbazar",
          name: "وب‌سایت گل‌بازار",
          platform: "Node.js",
          type: "app",
          status: last ? (last.healthy ? "healthy" : "down") : "unknown",
          detail: last
            ? last.healthy
              ? "سفارش‌ها بدون مشکل ثبت می‌شوند"
              : "ثبت سفارش نیاز به بررسی دارد"
            : "در انتظار بررسی",
          url: config.demoUrl,
          cpu: 18,
          memory: 42,
          plan: "استاندارد · نمونه",
        },
        {
          id: "golbazar-db",
          name: "اطلاعات فروشگاه",
          platform: "SQLite",
          type: "database",
          status: last ? (last.healthy ? "healthy" : "warning") : "unknown",
          detail: "دیتابیس واقعی محلی",
          plan: "محلی",
        },
        {
          id: "golbazar-storage",
          name: "فضای فایل‌ها",
          platform: "Object storage",
          type: "storage",
          status: "healthy",
          detail: "سرویس نمایشی",
          plan: "۵ گیگابایت · نمونه",
        },
      ];
      return this.services;
    }
    this.services = await this.liara.apps();
    const last = this.db.list<Probe>("probes")[0];
    this.services = this.services.map((s) =>
      s.id === config.appId && last
        ? {
            ...s,
            status: last.healthy ? "healthy" : "down",
            detail: last.healthy
              ? "بررسی سلامت و کسب‌وکار موفق"
              : "بررسی سایت ناموفق",
            url: config.healthUrl,
          }
        : s,
    );
    return this.services;
  }
  async refresh() {
    this.notices = [];
    try {
      await this.loadServices();
    } catch (error) {
      this.notices.push(redact((error as Error).message));
    }
    if (config.mode === "live" && config.liaraToken) {
      for (const [collection, read] of [
        ["backups", () => this.liara.backups()],
        [
          "releases",
          () =>
            config.appId
              ? this.liara.releases(config.appId)
              : Promise.resolve([]),
        ],
      ] as const) {
        try {
          const items = await read();
          this.db.set(`${collection}Cache`, items);
        } catch (error) {
          this.notices.push(
            `${collection}: ${redact((error as Error).message)}`,
          );
        }
      }
    }
    this.emit();
  }
  async logs() {
    return config.mode === "demo"
      ? await this.control("logs")
      : await this.liara.logs(this.appId());
  }
  async check(): Promise<Probe> {
    const health =
      config.mode === "demo" ? `${config.demoUrl}/health` : config.healthUrl;
    const business =
      config.mode === "demo"
        ? `${config.demoUrl}/api/checkout/check`
        : config.businessUrl;
    const start = performance.now();
    let statusCode = 0;
    let healthOk = false,
      businessOk = false;
    let error: string | undefined;
    try {
      if (!health) throw new Error("APP_HEALTH_URL تنظیم نشده است.");
      const r = await fetch(health, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      statusCode = r.status;
      healthOk = r.ok;
      const healthData = await r.json().catch(() => null);
      if (
        healthData &&
        (healthData.ok === false || healthData.healthy === false)
      )
        healthOk = false;
      if (!business)
        throw new Error(
          "بررسی مسیر اصلی کسب‌وکار تنظیم نشده؛ موفقیت کامل قابل تأیید نیست.",
        );
      const b = await fetch(business, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      const businessData = await b.json().catch(() => null);
      businessOk = b.ok && businessData?.ok === true;
      if (b.ok && !businessOk)
        error =
          "مسیر بررسی کسب‌وکار باید نتیجهٔ واقعی آزمایش را با JSON شامل ok: true برگرداند.";
    } catch (e) {
      error = redact((e as Error).message);
    }
    return {
      id: randomUUID(),
      at: now(),
      healthy: healthOk && businessOk,
      healthOk,
      businessOk,
      latency: Math.round(performance.now() - start),
      statusCode,
      error,
    };
  }
  async tick(force = false) {
    this.expireApprovals();
    if (
      this.probing ||
      this.executing ||
      (!force && !this.settings().monitoring)
    )
      return;
    if (config.mode === "live" && !config.healthUrl) return;
    this.probing = true;
    try {
      const probe = await this.check();
      this.db.put("probes", probe);
      this.lastCheck = probe.at;
      // Keep at most 7 days at 1-minute intervals; retention avoids unbounded storage.
      this.db.db
        .prepare(
          "DELETE FROM records WHERE collection='probes' AND rowid NOT IN (SELECT rowid FROM records WHERE collection='probes' ORDER BY rowid DESC LIMIT 10080)",
        )
        .run();
      this.failures = probe.healthy ? 0 : this.failures + 1;
      if (probe.healthy) this.db.set("outageLatched", false);
      await this.loadServices().catch(() => {});
      this.emit();
      const active = this.db
        .list<Incident>("incidents")
        .find((i) => !["RESOLVED", "ESCALATED", "REJECTED"].includes(i.status));
      if (
        this.failures >= config.threshold &&
        !active &&
        !this.db.value("outageLatched", false)
      ) {
        this.db.set("outageLatched", true);
        const id = randomUUID();
        const at = now();
        this.db.put("incidents", {
          id,
          appId: this.appId(),
          title: "ثبت سفارش فروشگاه با اختلال روبه‌رو شده",
          summary: `${config.threshold} بررسی پیاپی ناموفق بود. همراه در حال بررسی علت است.`,
          status: "DETECTED",
          createdAt: at,
          updatedAt: at,
          evidence: [
            {
              label: "بررسی سلامت",
              value: `HTTP ${probe.statusCode || "unreachable"}`,
              source:
                config.mode === "demo" ? "Golbazar /health" : "APP_HEALTH_URL",
              at,
            },
            {
              label: "ثبت سفارش آزمایشی",
              value: probe.businessOk ? "موفق" : "ناموفق",
              source: "business-check",
              at,
            },
          ],
          timeline: [
            {
              status: "DETECTED",
              at,
              note: "اختلال توسط پایش مستقل شناسایی شد.",
            },
          ],
          source: config.mode,
        } satisfies Incident);
        this.db.audit(
          "detection",
          "یک اختلال را زودتر پیدا کردم",
          `${id}; consecutiveFailures=${this.failures}`,
        );
        this.emit();
        void this.investigate(id);
      }
    } finally {
      this.probing = false;
    }
  }
  expireApprovals() {
    let changed = false;
    for (const action of this.db.list<Action>("actions"))
      if (
        action.status === "pending" &&
        Date.parse(action.expiresAt) <= Date.now()
      ) {
        this.db.put("actions", { ...action, status: "expired" });
        this.db.audit(
          "expired",
          "مهلت تأیید تمام شد؛ عملیاتی اجرا نشد",
          action.id,
        );
        changed = true;
        const incident = action.incidentId
          ? this.db.get<Incident>("incidents", action.incidentId)
          : undefined;
        if (incident?.status === "AWAITING_APPROVAL")
          this.move(
            incident.id,
            "ESCALATED",
            "مهلت تأیید تمام شد؛ شواهد تازه باید بررسی شوند.",
          );
      }
    if (changed) this.emit();
  }
  async recheckIncident(id: string) {
    if (this.executing)
      throw new Error("یک عملیات یا بررسی نتیجه در حال اجراست.");
    const incident = this.db.get<Incident>("incidents", id);
    if (
      !incident ||
      !["AWAITING_APPROVAL", "ESCALATED", "REJECTED"].includes(incident.status)
    )
      throw new Error("این رخداد اکنون برای بررسی مجدد آماده نیست.");
    this.executing = true;
    try {
      const action = incident.actionId
        ? this.db.get<Action>("actions", incident.actionId)
        : undefined;
      if (action?.status === "pending") {
        this.db.put("actions", {
          ...action,
          status: "cancelled",
          error: "برای بررسی نتیجهٔ اصلاح بیرونی، پیشنهاد قبلی لغو شد.",
        });
        this.db.audit(
          "cancelled",
          "پیشنهاد قبلی لغو شد؛ بررسی اصلاح بیرونی",
          action.id,
        );
      }
      this.move(
        id,
        "VERIFYING",
        "بدون تغییر زیرساخت، نتیجهٔ اصلاح بیرونی را دوباره بررسی می‌کنم.",
      );
      let last: Probe | undefined;
      let success = true;
      for (let i = 0; i < 2; i++) {
        last = await this.check();
        this.db.put("probes", last);
        this.lastCheck = last.at;
        success = success && last.healthy;
        await wait(config.mode === "demo" ? 250 : 2000);
      }
      if (success) {
        const current = this.db.get<Incident>("incidents", id)!;
        this.db.put("incidents", {
          ...current,
          verification:
            "دو بررسی متوالی سلامت و مسیر کسب‌وکار موفق بود؛ بهبود بیرون از عملیات همراه انجام شده است.",
        });
        this.move(id, "RESOLVED", "رفع مشکل پس از اصلاح بیرونی تأیید شد.");
        this.failures = 0;
        this.db.set("outageLatched", false);
      } else
        this.move(
          id,
          "ESCALATED",
          `بهبود کامل تأیید نشد؛ سلامت ${last?.healthOk ? "موفق" : "ناموفق"}، مسیر کسب‌وکار ${last?.businessOk ? "موفق" : "ناموفق"}.`,
        );
    } finally {
      this.executing = false;
      await this.loadServices().catch(() => {});
      this.emit();
    }
  }
  async investigate(id: string) {
    try {
      this.move(id, "INVESTIGATING", "در حال جمع‌آوری لاگ و بررسی مسیر سفارش");
      const logs = await this.logs();
      const incident = this.db.get<Incident>("incidents", id)!;
      this.db.put("incidents", {
        ...incident,
        evidence: [
          ...incident.evidence,
          {
            label: "لاگ برنامه",
            value: redact(logs).slice(-1800),
            source:
              config.mode === "demo" ? "local demo logs" : "Liara logs API",
            at: now(),
          },
        ],
      });
      this.emit();
      if (config.mode === "demo") {
        await wait(900);
        const exhausted = redact(logs).includes("connection pool exhausted");
        if (!exhausted) {
          this.move(
            id,
            "ESCALATED",
            "شواهد برای پیشنهاد اصلاح خودکار کافی نیست.",
          );
          return;
        }
        const updated = this.db.get<Incident>("incidents", id)!;
        this.db.put("incidents", {
          ...updated,
          diagnosis:
            "اتصال‌های دیتابیس مشغول مانده‌اند و فروشگاه نمی‌تواند سفارش جدید بگیرد. راه‌اندازی مجدد می‌تواند اتصال‌های موقت را آزاد کند؛ سپس ثبت سفارش را دوباره آزمایش می‌کنم.",
          confidence: "شواهد مستقیم از لاگ",
        });
        this.propose({
          kind: "restart_app",
          target: this.appId(),
          incidentId: id,
        });
        this.message(
          "assistant",
          "مشکل ثبت سفارش را پیدا کردم: اتصال‌های دیتابیس آزاد نشده‌اند. پیشنهاد می‌کنم برنامه را یک‌بار راه‌اندازی مجدد کنیم. این کار ممکن است چند ثانیه سایت را از دسترس خارج کند؛ منتظر تأیید شما هستم.",
          "demo",
        );
      } else if (config.cursorKey) {
        const response = await this.brain.send(
          `Investigate incident ${id} for app ${this.appId()}. Get memory, logs and resource metrics. Explain evidence and uncertainty. If restart is supported by evidence, use request_action with this incidentId. Otherwise do not propose mutation. Evidence collected: ${redact(this.db.get("incidents", id))}`,
        );
        const current = this.db.get<Incident>("incidents", id)!;
        this.db.put("incidents", { ...current, diagnosis: response });
        this.message("assistant", response, "cursor");
        if (this.db.get<Incident>("incidents", id)?.status === "INVESTIGATING")
          this.move(
            id,
            "ESCALATED",
            "تحلیل آماده است؛ اصلاح امنِ قابل‌اجرایی پیشنهاد نشده است.",
          );
      } else {
        this.move(
          id,
          "ESCALATED",
          "کلید Cursor تنظیم نشده؛ شواهد ذخیره شد و نیاز به بررسی دارد.",
        );
      }
    } catch (e) {
      const current = this.db.get<Incident>("incidents", id);
      if (
        current &&
        !["ESCALATED", "RESOLVED", "REJECTED"].includes(current.status)
      )
        this.move(
          id,
          "ESCALATED",
          `بررسی کامل نشد: ${redact((e as Error).message)}`,
        );
    }
  }
  propose(input: z.infer<typeof actionSchema>) {
    input = actionSchema.parse(input);
    if (input.target !== this.appId())
      throw new Error("فقط برنامهٔ انتخاب‌شده قابل تغییر است.");
    if (config.mode === "live") {
      this.liara.assertWritable(input.target);
      if (
        !["restart_app", "deploy_release", "create_backup"].includes(input.kind)
      )
        throw new Error(
          "این عملیات در اتصال واقعی پیاده‌سازی نشده است؛ عملیاتی اجرا نشد.",
        );
    }
    const descriptions: Record<
      ActionKind,
      { title: string; description: string; impact: string; cost: string }
    > = {
      restart_app: {
        title: "راه‌اندازی مجدد فروشگاه",
        description:
          "اتصال‌های موقت آزاد می‌شوند. پس از راه‌اندازی، سلامت سایت و ثبت سفارش را بررسی می‌کنم.",
        impact: "ممکن است سایت برای چند ثانیه در دسترس نباشد.",
        cost: "هزینهٔ جدیدی ایجاد نمی‌کند",
      },
      deploy_release: {
        title: "انتشار نسخهٔ جدید گل‌بازار",
        description:
          config.mode === "demo"
            ? "ثبت انتشار نمایشی و بررسی فروشگاه محلی؛ سورس روی ابر ارسال نمی‌شود."
            : "بارگذاری سورس نمونهٔ گل‌بازار و ساخت نسخهٔ Docker روی برنامهٔ انتخاب‌شده در لیارا.",
        impact:
          config.mode === "demo"
            ? "یک انتشار نمایشی ثبت می‌شود؛ کد فروشگاه محلی و زیرساخت ابری تغییر نمی‌کنند."
            : "نسخهٔ فعلی برنامه جایگزین می‌شود؛ انتشار ابر ممکن است چند دقیقه طول بکشد.",
        cost:
          config.mode === "demo"
            ? "بدون هزینه یا پرداخت در محیط نمایشی"
            : "مصرف پلن فعلی؛ هزینهٔ ساخت طبق حساب لیارا",
      },
      restore_backup: {
        title: "بازگردانی نسخهٔ پشتیبان",
        description:
          "سفارش‌های فروشگاه محلی از نسخهٔ انتخاب‌شده بازیابی می‌شوند.",
        impact:
          "سفارش‌های ثبت‌شده بعد از این نسخه حذف می‌شوند؛ پیش از اجرا نسخهٔ ایمنی می‌گیرم.",
        cost: "آزمایشی؛ بدون پرداخت",
      },
      create_backup: {
        title: "تهیهٔ نسخهٔ پشتیبان",
        description:
          "یک نسخه از اطلاعات فروشگاه تهیه می‌کنم و نتیجه را ثبت می‌کنم.",
        impact: "ممکن است هنگام تهیهٔ نسخه، بار موقت روی دیتابیس ایجاد شود.",
        cost:
          config.mode === "demo"
            ? "بدون هزینه در محیط محلی"
            : "مطابق تعرفه و فضای پشتیبان حساب لیارا",
      },
      enable_redis: {
        title: "آزمایش فعال‌سازی کش",
        description:
          "در حالت دمو، قابلیت کش را شبیه‌سازی می‌کنیم. Redis واقعی ساخته نمی‌شود و تغییری در کد رخ نمی‌دهد.",
        impact: "فقط پرچم کش فروشگاه محلی تغییر می‌کند.",
        cost: "نمایشی · بدون پرداخت واقعی",
      },
      enable_email: {
        title: "آزمایش فعال‌سازی ایمیل",
        description:
          "ثبت سرویس ایمیل نمایشی برای آشنایی با مسیر فعال‌سازی؛ ایمیلی ارسال نمی‌شود.",
        impact: "هیچ ایمیل‌سرور واقعی ساخته نمی‌شود.",
        cost: "نمایشی · بدون پرداخت واقعی",
      },
    };
    const params: Record<string, string> = {};
    if (input.backupId) params.backupId = input.backupId;
    if (input.kind === "deploy_release") params.sourceHash = sourceHash();
    if (
      input.kind === "restore_backup" &&
      !this.db.get<Backup>("backups", input.backupId || "")
    )
      throw new Error("نسخهٔ پشتیبان پیدا نشد.");
    if (input.incidentId) {
      const incident = this.db.get<Incident>("incidents", input.incidentId);
      if (
        !incident ||
        incident.appId !== input.target ||
        incident.status !== "INVESTIGATING"
      )
        throw new Error("رخداد برای دریافت راهکار در وضعیت مجاز نیست.");
    }
    const existing = this.db
      .list<Action>("actions")
      .find(
        (a) =>
          a.status === "pending" &&
          a.kind === input.kind &&
          a.target === input.target &&
          a.incidentId === input.incidentId &&
          digest(a.params) === digest(params) &&
          new Date(a.expiresAt).getTime() > Date.now(),
      );
    if (existing) return existing;
    const action: Action = {
      id: randomUUID(),
      kind: input.kind,
      target: input.target,
      ...descriptions[input.kind],
      status: "pending",
      createdAt: now(),
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      incidentId: input.incidentId,
      params,
      fingerprint: digest({ kind: input.kind, target: input.target, params }),
    };
    this.db.put("actions", action);
    if (input.incidentId) {
      let incident = this.move(
        input.incidentId,
        "PLAN_READY",
        "راهکار با توجه به شواهد آماده شد.",
      );
      incident = { ...incident, actionId: action.id };
      this.db.put("incidents", incident);
      this.move(
        input.incidentId,
        "AWAITING_APPROVAL",
        `برای «${action.title}» منتظر تأیید شما هستم.`,
      );
    }
    this.db.audit(
      "approval_requested",
      `${action.title}؛ منتظر تأیید`,
      `${action.id}; fingerprint=${action.fingerprint}`,
    );
    this.emit();
    return action;
  }
  async decide(id: string, approve: boolean, fingerprint: string) {
    const action = this.db.get<Action>("actions", id);
    if (!action) throw new Error("درخواست پیدا نشد.");
    if (action.status !== "pending")
      throw new Error("این درخواست قبلاً پردازش شده است.");
    if (
      action.fingerprint !== fingerprint ||
      action.fingerprint !==
        digest({
          kind: action.kind,
          target: action.target,
          params: action.params,
        })
    )
      throw new Error("جزئیات عملیات تغییر کرده؛ تأیید معتبر نیست.");
    if (new Date(action.expiresAt).getTime() < Date.now()) {
      this.db.put("actions", { ...action, status: "expired" });
      if (action.incidentId)
        this.move(
          action.incidentId,
          "ESCALATED",
          "مهلت تأیید تمام شد؛ برای تصمیم جدید نیاز به بررسی است.",
        );
      this.emit();
      throw new Error("مهلت تأیید تمام شده است؛ دوباره بررسی کنید.");
    }
    if (this.executing) throw new Error("یک عملیات دیگر در حال اجراست.");
    if (!approve) {
      this.db.put("actions", { ...action, status: "rejected" });
      if (action.incidentId)
        this.move(
          action.incidentId,
          "REJECTED",
          "شما اجرای پیشنهاد را رد کردید.",
        );
      this.db.audit("rejected", "پیشنهاد با تصمیم شما اجرا نشد", id, "user");
      this.emit();
      return;
    }
    // No await before claiming: concurrent approval requests cannot dispatch twice.
    this.executing = true;
    this.db.put("actions", { ...action, status: "executing" });
    this.db.audit(
      "approved",
      `${action.title} تأیید شد`,
      `${id}; fingerprint=${fingerprint}`,
      "user",
    );
    if (action.incidentId)
      this.move(
        action.incidentId,
        "EXECUTING",
        "تأیید شما دریافت شد؛ در حال اجرا.",
      );
    this.emit();
    try {
      if (action.kind === "restart_app") {
        if (config.mode === "demo") await this.control("restart", {});
        else await this.liara.restart(action.target);
      }
      if (action.kind === "create_backup") {
        await this.createBackup();
        await this.refresh();
        const note =
          config.mode === "demo"
            ? "نسخهٔ پشتیبان محلی ذخیره و قابل بازیابی است."
            : "درخواست تهیهٔ پشتیبان پذیرفته شد؛ آماده‌شدن فایل را از فهرست پشتیبان‌های لیارا بررسی کنید.";
        this.db.put("actions", {
          ...action,
          status: "completed",
          description: note,
        });
        this.db.audit(
          config.mode === "demo" ? "verified" : "backup_submitted",
          note,
          action.id,
        );
        this.message("assistant", note, "system");
        this.emit();
        return;
      }
      if (action.kind === "restore_backup") {
        await this.createBackup();
        const backup = this.db.value<{ orders: unknown[] } | null>(
          `backup:${action.params.backupId}`,
          null,
        );
        if (!backup) throw new Error("محتوای نسخه پیدا نشد.");
        await this.control("restore", backup);
        const restored = await this.control("backup");
        if (digest(restored.orders) !== digest(backup.orders))
          throw new Error("محتوای بازیابی با نسخهٔ انتخاب‌شده یکسان نیست.");
      }
      if (action.kind === "enable_redis") await this.control("cache", {});
      if (action.kind === "enable_email") this.db.set("emailEnabled", true);
      let expectedRelease: string | undefined;
      if (action.kind === "deploy_release") {
        if (action.params.sourceHash !== sourceHash())
          throw new Error(
            "سورس از زمان تأیید تغییر کرده است؛ درخواست انتشار تازه بسازید.",
          );
        if (config.mode === "live") {
          const archive = path.join(config.dataDir, "golbazar.tar.gz");
          await tar.c(
            { gzip: true, file: archive, cwd: path.resolve("demo/site") },
            sourceFiles,
          );
          const result = await this.liara.deploy(
            action.target,
            readFileSync(archive),
          );
          if (!result.releaseID)
            throw new Error("شناسهٔ انتشار برای تأیید نتیجه دریافت نشد.");
          expectedRelease = String(result.releaseID);
          this.db.audit(
            "deploy_submitted",
            "درخواست انتشار به لیارا ارسال شد",
            redact(result),
          );
        } else
          this.db.put("releases", {
            id: randomUUID(),
            version: `v1.0.${this.db.list("releases").length}`,
            title: "انتشار نمایشی با تأیید شما",
            at: now(),
            status: "ready",
            source: "demo",
          } satisfies Release);
      }
      if (action.incidentId)
        this.move(
          action.incidentId,
          "VERIFYING",
          "عملیات ارسال شد؛ اکنون نتیجهٔ واقعی را بررسی می‌کنم.",
        );
      let verified = false;
      let last: Probe | undefined;
      let consecutiveSuccess = 0;
      const attempts =
        config.mode === "live" && action.kind === "deploy_release" ? 24 : 3;
      for (let i = 0; i < attempts; i++) {
        await wait(config.mode === "demo" ? 450 : 5000);
        if (expectedRelease) {
          const releases = await this.liara.call(
            `/v1/projects/${encodeURIComponent(action.target)}/releases?page=1&count=20`,
          );
          const release = releases.releases?.find(
            (r: { _id: string }) => r._id === expectedRelease,
          );
          if (release && ["failed", "error"].includes(release.state))
            throw new Error("ساخت نسخهٔ جدید در لیارا ناموفق بود.");
          if (releases.currentRelease !== expectedRelease) {
            this.db.audit(
              "deploy_wait",
              "در انتظار فعال‌شدن نسخهٔ جدید",
              expectedRelease,
            );
            this.emit();
            continue;
          }
        }
        last = await this.check();
        this.db.put("probes", last);
        this.lastCheck = last.at;
        this.emit();
        consecutiveSuccess = last.healthy ? consecutiveSuccess + 1 : 0;
        if (consecutiveSuccess >= 2) {
          verified = true;
          break;
        }
      }
      if (!verified)
        throw new Error(
          `بهبود کامل تأیید نشد. سلامت: ${last?.healthOk ? "موفق" : "ناموفق"}، مسیر کسب‌وکار: ${last?.businessOk ? "موفق" : "ناموفق"}. ${last?.error || "نیاز به بررسی بیشتر؛ رخداد بسته نشد."}`,
        );
      this.db.put("actions", { ...action, status: "completed" });
      this.failures = 0;
      this.db.set("outageLatched", false);
      if (action.incidentId) {
        const incident = this.db.get<Incident>("incidents", action.incidentId)!;
        this.db.put("incidents", {
          ...incident,
          verification: `بررسی سلامت و آزمایش ثبت سفارش هر دو موفق بودند. زمان پاسخ ${last?.latency}ms.`,
        });
        this.move(
          action.incidentId,
          "RESOLVED",
          "فروشگاه دوباره سالم است؛ مسیر ثبت سفارش هم تأیید شد.",
        );
      }
      this.db.audit(
        "verified",
        `${action.title} انجام و بررسی شد`,
        "Health + business check passed",
      );
      this.message(
        "assistant",
        `«${action.title}» انجام شد. سایت پاسخ می‌دهد و مسیر اصلی کسب‌وکار هم با موفقیت بررسی شد.${config.mode === "demo" ? " این نتیجه مربوط به فروشگاه آزمایشی محلی است." : ""}`,
        "system",
      );
    } catch (e) {
      const error = redact((e as Error).message);
      this.db.put("actions", { ...action, status: "failed", error });
      if (action.incidentId) {
        const incident = this.db.get<Incident>("incidents", action.incidentId);
        if (incident && !["ESCALATED", "RESOLVED"].includes(incident.status))
          this.move(action.incidentId, "ESCALATED", error);
      }
      this.db.audit("failed", "نتیجهٔ مطلوب تأیید نشد", error);
      this.message(
        "assistant",
        `عملیات به نتیجهٔ تأییدشده نرسید: ${error} مسیر بعدی: بررسی تنظیمات اتصال دیتابیس و لاگ‌های تازه؛ تغییر دیگری خودکار اجرا نمی‌کنم.`,
        "system",
      );
    } finally {
      this.executing = false;
      await this.loadServices().catch(() => {});
      this.emit();
    }
  }
  async createBackup() {
    if (config.mode === "live") return this.liara.createBackup(this.appId());
    const payload = await this.control("backup");
    const id = randomUUID();
    this.db.set(`backup:${id}`, payload);
    this.db.put("backups", {
      id,
      name: `گل‌بازار · ${new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date())}`,
      at: now(),
      size: `${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)} KB`,
      status: "ready",
      source: "demo",
    } satisfies Backup);
    this.db.audit("backup", "نسخهٔ پشتیبان محلی ذخیره شد", id);
    this.emit();
  }
  async chat(text: string) {
    this.message("user", text, "system");
    if (config.mode === "live" && config.cursorKey) {
      try {
        const answer = await this.brain.send(text);
        this.message("assistant", answer, "cursor");
        return;
      } catch (e) {
        this.message(
          "assistant",
          `اتصال به Cursor کامل نشد: ${redact((e as Error).message)}. درخواست شما در حافظه ذخیره شد.`,
          "system",
        );
        throw e;
      }
    }
    if (config.mode === "live") {
      this.message(
        "assistant",
        "برای تحلیل گفتگو، CURSOR_API_KEY را در فایل .env قرار دهید و سرویس را دوباره اجرا کنید. داده‌ها و تاریخچه حفظ می‌شوند.",
        "system",
      );
      return;
    }
    await wait(600);
    const last = this.db.list<Probe>("probes")[0];
    const active = this.db
      .list<Incident>("incidents")
      .find((i) => !["RESOLVED", "REJECTED"].includes(i.status));
    let answer =
      "من وضعیت سایت، مسیر ثبت سفارش و لاگ‌های فروشگاه محلی را بررسی می‌کنم. برای دیدن توانایی کشف و رفع مشکل، «آزمایش یک اختلال» را بزنید. در حالت نمایشی، پاسخ‌ها با قواعد مشخص تولید می‌شوند؛ پس از اتصال کلید، گفتگو را Cursor انجام می‌دهد.";
    if (/سلام|وضع|سالم|چطور/.test(text))
      answer = last?.healthy
        ? "فروشگاه شما در آخرین بررسی سالم بود و ثبت سفارش هم کار می‌کرد. من به‌صورت مستقل هر چند ثانیه بررسی را تکرار می‌کنم."
        : `آخرین بررسی نیاز به توجه دارد.${active ? ` رخداد «${active.title}» ثبت شده است. ${active.diagnosis || "در حال جمع‌آوری شواهد هستم."}` : " اتصال فروشگاه آزمایشی را بررسی کنید."}`;
    if (/کند|کش|ردیس|redis/i.test(text))
      answer =
        "برای تشخیص کندی، اول زمان پاسخ، الگوی درخواست‌ها و شواهد مصرف منابع را بررسی می‌کنیم. کش همیشه راه‌حل نیست. پیشنهاد Redis در بخش فرصت‌های رشد صرفاً نمایشی است؛ ساخت سرویس، تغییر کد و هزینهٔ واقعی به بررسی بیشتر نیاز دارد.";
    if (/بکاپ|پشتیبان|بازیابی/.test(text))
      answer = `${this.db.list("backups").length} نسخهٔ پشتیبان محلی دارید. از بخش «نسخه‌های پشتیبان» یک نسخه بسازید یا بازیابی کنید. بازیابی فقط بعد از تأیید شما انجام می‌شود و ابتدا یک نسخهٔ ایمنی می‌گیرم.`;
    if (/مموری|حافظه|یادت|گفتگو/.test(text))
      answer = `گفتگوها، رخدادها، شواهد و تأییدهای شما در حافظهٔ SQLite ذخیره شده‌اند؛ اکنون ${this.db.list("messages").length} پیام و ${this.db.auditList().length} رویداد ثبت شده است. در اتصال واقعی، شناسهٔ ایجنت و حافظهٔ Cursor هم برای ادامهٔ گفتگو حفظ می‌شود.`;
    this.message("assistant", answer, "demo");
  }
  async demoFault(kind: "pool" | "persistent" | "none") {
    if (config.mode !== "demo")
      throw new Error("آزمایش اختلال در حالت واقعی در دسترس نیست.");
    if (this.executing) throw new Error("منتظر پایان عملیات فعلی بمانید.");
    if (
      kind !== "none" &&
      this.db
        .list<Incident>("incidents")
        .some((i) => !["RESOLVED", "ESCALATED", "REJECTED"].includes(i.status))
    )
      throw new Error("ابتدا رخداد فعلی را بررسی کنید یا محیط را سالم کنید.");
    await this.control("fault", { fault: kind });
    this.failures = 0;
    this.db.set("outageLatched", false);
    this.db.audit(
      "demo",
      kind === "none"
        ? "فروشگاه آزمایشی به حالت سالم برگشت"
        : "اختلال کنترل‌شده در فروشگاه ایجاد شد",
      `fault=${kind}`,
      "user",
    );
    await this.tick(true);
    this.emit();
  }
  updateSettings(input: Partial<Settings>) {
    const next = { ...this.settings(), ...input };
    this.db.set("settings", next);
    this.db.audit(
      "settings",
      "تنظیمات مراقبت به‌روز شد",
      JSON.stringify(input),
      "user",
    );
    this.emit();
    return next;
  }
  snapshot(): Snapshot {
    return {
      mode: config.mode,
      managedAppId: this.appId(),
      agentProvider:
        config.mode === "demo"
          ? "demo"
          : config.cursorKey
            ? "cursor"
            : "unconfigured",
      services: this.services,
      incidents: this.db.list("incidents"),
      actions: this.db.list("actions"),
      probes: this.db.list<Probe>("probes").slice(0, 120).reverse(),
      messages: this.db.list<Message>("messages").slice(0, 300).reverse(),
      audit: this.db.auditList(),
      backups:
        config.mode === "demo"
          ? this.db.list("backups")
          : this.db.value("backupsCache", []),
      releases:
        config.mode === "demo"
          ? this.db.list("releases")
          : this.db.value("releasesCache", []),
      settings: this.settings(),
      connections: {
        liara: !!config.liaraToken,
        cursor: !!config.cursorKey,
        writable:
          config.mode === "demo" || config.allowedApps.includes(config.appId),
      },
      monitor: {
        running: this.settings().monitoring,
        lastCheck: this.lastCheck,
        intervalMs: config.intervalMs,
        failures: this.failures,
      },
      capabilities: [
        {
          key: "observe",
          label: "پایش سلامت و مسیر سفارش",
          available:
            config.mode === "demo" ||
            !!(config.healthUrl && config.businessUrl),
          reason:
            "آدرس‌های APP_HEALTH_URL و APP_BUSINESS_CHECK_URL را تنظیم کنید.",
        },
        {
          key: "restart",
          label: "راه‌اندازی مجدد با تأیید",
          available:
            config.mode === "demo" || config.allowedApps.includes(config.appId),
        },
        {
          key: "deploy",
          label: "انتشار سورس نمونه با تأیید",
          available:
            config.mode === "demo" || config.allowedApps.includes(config.appId),
        },
        {
          key: "restore",
          label: "بازیابی پشتیبان",
          available: config.mode === "demo",
          reason:
            "بازیابی ابری در OpenAPI بررسی‌شده مستند نیست؛ مسیر دستی لیارا لازم است.",
        },
        {
          key: "billing",
          label: "پرداخت و خرید سرویس",
          available: false,
          reason:
            "درگاه پرداخت یا API خرید یک‌کلیکی متصل نیست؛ هیچ مبلغی برداشت نمی‌شود.",
        },
        {
          key: "code",
          label: "اصلاح خودکار کد کسب‌وکار",
          available: false,
          reason:
            "در این MVP ابزارهای ویرایش و اجرای شل برای ایجنت بسته‌اند؛ تغییر کد به مسیر بررسی جداگانه نیاز دارد.",
        },
      ],
      notices: this.notices,
    };
  }
  start() {
    void this.refresh();
    this.timer = setInterval(() => {
      void this.tick().catch((e) => {
        this.notices = [redact((e as Error).message)];
        this.emit();
      });
    }, config.intervalMs);
    setTimeout(() => void this.tick(), 1500);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
