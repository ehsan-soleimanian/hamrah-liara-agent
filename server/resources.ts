import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { digest } from "./security.ts";
import { demoCatalog, parseCatalog } from "./provision.ts";
import type { Liara } from "./liara.ts";
import type { Store } from "./store.ts";
import type { Action } from "../src/types.ts";
import type { CloudPlan } from "../src/provision-types.ts";

export class Resources {
  constructor(
    private db: Store,
    private liara: Liara,
    private scope: () => string,
    private appId: () => string,
  ) {}
  async options() {
    const scope = this.scope(),
      target = this.appId();
    if (!target) throw new Error("ابتدا برنامهٔ مقصد را متصل کنید.");
    const [me, details] =
      config.mode === "demo"
        ? [
            null,
            {
              project: this.db.value(`demo-resources:${scope}`, {
                planID: "demo-small",
                bundlePlanID: "free",
                type: "node",
              }),
            },
          ]
        : await Promise.all([
            this.liara.call("/v1/me"),
            this.liara.call(`/v1/projects/${encodeURIComponent(target)}`),
          ]);
    if (scope !== this.scope() || target !== this.appId())
      throw new Error("اتصال تغییر کرده است؛ دوباره تلاش کنید.");
    if (
      config.mode === "live" &&
      config.teamId &&
      me?.team?._id !== config.teamId
    )
      throw new Error("حساب تیمی برای دریافت قیمت تأیید نشد.");
    const catalog =
      config.mode === "demo"
        ? demoCatalog()
        : parseCatalog(me, { networks: [] });
    const project = details?.project;
    if (!project?.planID || !project?.bundlePlanID || !project?.type)
      throw new Error("پلن، بستهٔ امکانات یا پلتفرم فعلی قابل تأیید نیست.");
    const current = catalog.appPlans.find(
      (p) => p.planId === project.planID && p.bundleId === project.bundlePlanID,
    );
    if (!current)
      throw new Error("قیمت و ظرفیت پلن فعلی در فهرست قابل تأیید نیست.");
    // Documented resize accepts planID only. Preserve the existing bundle and disk capacity.
    const plans = catalog.appPlans.filter(
      (p) =>
        p.bundleId === current.bundleId &&
        p.disk >= current.disk &&
        (!p.supports.length || p.supports.includes(project.type)),
    );
    return {
      scope,
      target,
      mode: config.mode,
      current,
      plans,
      currency: catalog.currency,
      platform: project.type,
      fetchedAt: catalog.fetchedAt,
    };
  }
  async quote(planId: string) {
    const options = await this.options();
    if (config.mode === "live") this.liara.assertWritable(options.target);
    const next = options.plans.find((p) => p.id === planId);
    if (!next || next.id === options.current.id)
      throw new Error("پلن متفاوت و معتبر را انتخاب کنید.");
    const params = {
      scope: options.scope,
      current: JSON.stringify(options.current),
      next: JSON.stringify(next),
      platform: options.platform,
    };
    const existing = this.db
      .list<Action>("actions")
      .find(
        (a) =>
          a.kind === "resize_app" &&
          a.status === "pending" &&
          a.target === options.target &&
          digest(a.params) === digest(params) &&
          Date.parse(a.expiresAt) > Date.now(),
      );
    if (existing) return existing;
    const action: Action = {
      id: randomUUID(),
      kind: "resize_app",
      target: options.target,
      title: "تغییر منابع برنامه",
      description: `CPU: ${options.current.cpu} → ${next.cpu}؛ RAM: ${options.current.ram} → ${next.ram} GB. بستهٔ امکانات فعلی حفظ می‌شود.`,
      impact: `ممکن است برنامه بازراه‌اندازی و موقتاً قطع شود.${next.cpu < options.current.cpu || next.ram < options.current.ram ? " کاهش منابع ممکن است باعث کندی یا کمبود حافظه شود." : " افزایش منابع تضمین رفع خطای کد یا دیتابیس نیست."}`,
      cost: `${config.mode === "demo" ? "نمایشی؛ بدون پرداخت. " : "برآورد ۳۰ روز روشن‌بودن، بدون مالیات و مصرف متغیر: "}${options.current.monthly.toLocaleString("fa-IR")} → ${next.monthly.toLocaleString("fa-IR")} ${options.currency}؛ اختلاف ${(next.monthly - options.current.monthly).toLocaleString("fa-IR")}`,
      params,
      fingerprint: digest({
        kind: "resize_app",
        target: options.target,
        params,
      }),
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    };
    this.db.put("actions", action);
    this.db.audit(
      "approval_requested",
      action.title,
      `${action.id}; fingerprint=${action.fingerprint}`,
    );
    return action;
  }
  async execute(action: Action) {
    const fresh = await this.options();
    const next = JSON.parse(action.params.next) as CloudPlan;
    const selected = fresh.plans.find((p) => p.id === next.id);
    if (
      !selected ||
      fresh.scope !== action.params.scope ||
      fresh.target !== action.target ||
      fresh.platform !== action.params.platform ||
      digest(fresh.current) !== digest(JSON.parse(action.params.current)) ||
      digest(selected) !== digest(next)
    )
      throw new Error(
        "حساب، پلن فعلی، ظرفیت یا تعرفه تغییر کرده است؛ تأیید تازه لازم است.",
      );
    // Recheck expiry after asynchronous reads, before any write. Never retry mutation.
    if (Date.parse(action.expiresAt) <= Date.now())
      throw new Error("مهلت تأیید تغییر منابع تمام شده است.");
    if (config.mode === "demo")
      this.db.set(`demo-resources:${fresh.scope}`, {
        planID: next.planId,
        bundlePlanID: next.bundleId,
        type: fresh.platform,
      });
    else {
      this.liara.assertWritable(action.target);
      await this.liara.call(
        `/v1/projects/${encodeURIComponent(action.target)}/resize`,
        "POST",
        { planID: next.planId },
      );
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      if (fresh.scope !== this.scope())
        throw new Error(
          "اتصال هنگام بررسی نتیجه تغییر کرد؛ نتیجه نیازمند بررسی است.",
        );
      const details =
        config.mode === "demo"
          ? { project: this.db.value<any>(`demo-resources:${fresh.scope}`, {}) }
          : await this.liara.call(
              `/v1/projects/${encodeURIComponent(action.target)}`,
            );
      if (
        details?.project?.planID === next.planId &&
        details.project.bundlePlanID === next.bundleId
      )
        return;
      if (attempt < 5) await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      "درخواست تغییر ارسال شد، اما پلن نهایی تأیید نشد؛ پیش از هر تلاش تازه وضعیت لیارا را بررسی کنید.",
    );
  }
}
