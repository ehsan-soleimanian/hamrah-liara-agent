import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Flower2,
  Globe,
  HardDrive,
  HeartPulse,
  LoaderCircle,
  RefreshCw,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { api, date, fa, time } from "./lib";
import type { Action, ActionKind, Incident, Snapshot } from "./types";
type Props = {
  state: Snapshot;
  online: boolean;
  busy: boolean;
  navigate: (page: any) => void;
  approve: (action: Action) => void;
  incident: (incident: Incident) => void;
  propose: (kind: ActionKind, id?: string) => void;
  run: (
    key: string,
    task: () => Promise<unknown>,
    message?: string,
  ) => Promise<void>;
};
const when = (at?: string) =>
  at ? `${date(at)}، ${time(at)}` : "هنوز بررسی نشده";

export function ActionProgress({ action }: { action: Action }) {
  const status = {
    pending: "منتظر تأیید شما",
    executing: "در حال انجام",
    completed: "انجام شد",
    failed: "نیاز به پیگیری",
    rejected: "اجرا نشد",
    expired: "مهلت تمام شد",
    cancelled: "لغو شد",
  }[action.status];
  return (
    <article className="care-operation">
      <div className="care-row">
        <div>
          <h3>{action.title}</h3>
          <small>{when(action.createdAt)}</small>
        </div>
        <span
          className={`care-tag ${action.status === "failed" ? "attention" : ""}`}
        >
          {status}
        </span>
      </div>
      {action.steps?.length ? (
        <ol className="care-steps">
          {action.steps.map((step, i) => (
            <li key={i} className={step.status}>
              <span>
                {step.status === "running" ? (
                  <Clock3 size={15} />
                ) : step.status === "failed" ? (
                  <TriangleAlert size={15} />
                ) : (
                  <Check size={15} />
                )}
              </span>
              <p>{step.label}</p>
              <time>{time(step.at)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p>{action.description}</p>
      )}
      {action.error && <p className="care-error">{action.error}</p>}
    </article>
  );
}

export default function CareDashboard(p: Props) {
  const { state, online } = p;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const care = state.care,
    last = state.probes.at(-1);
  const stale =
    !last ||
    clock - Date.parse(last.at) > Math.max(state.monitor.intervalMs * 3, 20000);
  const healthy =
    online && !stale && state.settings.monitoring && last?.healthy;
  const needsHelp = online && !stale && !last?.healthy;
  const pending = state.actions.filter(
    (a) => a.status === "pending" && Date.parse(a.expiresAt) > clock,
  );
  const active = state.incidents.filter(
    (i) => !["RESOLVED", "REJECTED"].includes(i.status),
  );
  const attention = pending[0];
  const title = !online
    ? "ارتباط همراه قطع شده"
    : !state.settings.monitoring
      ? "مراقبت خودکار متوقف است"
      : stale
        ? "سلامت فروشگاه هنوز تأیید نشده"
        : healthy
          ? "مشتری می‌تواند سفارش بدهد."
          : "ثبت سفارش نیاز به بررسی دارد.";
  const description = !online
    ? "پس از اتصال دوباره، وضعیت تازه را بررسی می‌کنیم."
    : !state.settings.monitoring
      ? "برای باخبرشدن از اختلال‌ها، پایش را دوباره فعال کنید."
      : stale
        ? "همراه باید سایت و مسیر ثبت سفارش را دوباره آزمایش کند."
        : healthy
          ? "بازشدن سایت و نوشتن و خواندن سفارش آزمایشی بررسی شد؛ سفارش آزمایشی ذخیره نشد."
          : last?.healthOk
            ? "سایت باز می‌شود، اما آزمایش ثبت سفارش موفق نبود. همراه در حال پیگیری است."
            : "سایت پاسخ سالم نمی‌دهد. شواهد و مسیر اصلاح در حال بررسی است.";
  return (
    <div className="care-dashboard">
      <section
        className={`care-health ${needsHelp ? "needs-help" : ""}`}
        aria-label="وضعیت ثبت سفارش"
      >
        <div className="care-health-top">
          <span className={`care-tag ${healthy ? "good" : "attention"}`}>
            <i />
            {healthy
              ? "سفارش‌گیری برقرار است"
              : !state.settings.monitoring
                ? "پایش متوقف است"
                : "نیاز به بررسی"}
          </span>
          <small>
            {state.mode === "demo"
              ? "فروشگاه آزمایشی محلی"
              : "فروشگاه متصل به لیارا"}
          </small>
        </div>
        <div className="care-health-body">
          <div className="care-health-symbol">
            {healthy ? (
              <CheckCircle2 size={34} strokeWidth={1.4} />
            ) : (
              <HeartPulse size={34} strokeWidth={1.4} />
            )}
          </div>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="care-health-foot">
          <span>
            <Clock3 size={15} />
            آخرین بررسی: {when(last?.at)}
          </span>
          <button
            className="button ghost"
            disabled={p.busy || !online}
            onClick={() =>
              void p.run("check", () => api("/check"), "بررسی تازه انجام شد.")
            }
          >
            <RefreshCw size={15} />
            بررسی دوباره
          </button>
        </div>
      </section>

      {attention ? (
        <section className="care-next">
          <span className="care-next-icon">
            <ShieldCheck size={23} />
          </span>
          <div>
            <small>قدم بعدی · تصمیم با شماست</small>
            <h2>{attention.title}</h2>
            <p>{attention.impact}</p>
          </div>
          <button
            className="button primary"
            disabled={p.busy}
            onClick={() => p.approve(attention)}
          >
            بررسی و تأیید
            <ArrowLeft size={16} />
          </button>
        </section>
      ) : active[0] ? (
        <section className="care-next">
          <TriangleAlert size={23} />
          <div>
            <small>در حال پیگیری</small>
            <h2>{active[0].title}</h2>
            <p>{active[0].verification || active[0].summary}</p>
          </div>
          <button
            className="button secondary"
            onClick={() => p.incident(active[0])}
          >
            مشاهدهٔ پیگیری
            <ArrowLeft size={16} />
          </button>
        </section>
      ) : !state.settings.monitoring ? (
        <section className="care-next">
          <HeartPulse size={23} />
          <div>
            <h2>همراه را دوباره بیدار کنید</h2>
            <p>
              پایش به‌صورت مستقل از گفتگو انجام می‌شود؛ تغییرات همچنان تأیید
              می‌خواهند.
            </p>
          </div>
          <button
            className="button primary"
            disabled={p.busy}
            onClick={() =>
              void p.run("monitor", () =>
                api("/settings", { monitoring: true }, "PATCH"),
              )
            }
          >
            فعال‌کردن مراقبت
          </button>
        </section>
      ) : (
        <div className="care-reassurance">
          <ShieldCheck size={17} />
          <span>
            همراه مشکل را پیدا می‌کند؛ هر تغییر با تأیید شما انجام می‌شود.
          </span>
        </div>
      )}

      <section className="care-summary" aria-label="مراقبت از فروشگاه">
        <div className="care-summary-heading">
          <h2>سه کار مهم، زیر نظر همراه</h2>
          <span>شما به گل‌ها برسید.</span>
        </div>
        <div className="care-columns">
          <article>
            <ShoppingBag size={23} />
            <h3>سفارش‌های مشتری</h3>
            <strong>
              {healthy ? "مسیر سفارش آزمایش شد" : "نیاز به بررسی تازه"}
            </strong>
            <p>
              تنها بازشدن صفحه کافی نیست. ثبت و خواندن سفارش هم باید کار کند.
            </p>
            <button
              className="care-link"
              onClick={() => p.navigate("incidents")}
            >
              سلامت و پیگیری‌ها
              <ArrowLeft size={15} />
            </button>
          </article>
          <article>
            <HardDrive size={23} />
            <h3>اطلاعات فروشگاه</h3>
            <strong>
              {care?.lastBackup
                ? `آخرین پشتیبان: ${time(care.lastBackup.at)}`
                : "هنوز پشتیبانی ندارید"}
            </strong>
            <p>
              {care?.policy.enabled
                ? "پشتیبان‌گیری هر ۶ ساعت فعال است."
                : "یک نسخهٔ پشتیبان، راه برگشت سفارش‌های شماست."}
              {care?.backupError
                ? " آخرین پشتیبان‌گیری نیاز به پیگیری دارد."
                : ""}
            </p>
            <button className="care-link" onClick={() => p.navigate("backups")}>
              پشتیبان و بازیابی
              <ArrowLeft size={15} />
            </button>
          </article>
          <article>
            <Rocket size={23} />
            <h3>نسخهٔ تازهٔ فروشگاه</h3>
            <strong>اول نسخهٔ ایمنی، بعد انتشار</strong>
            <p>
              همان کد تأییدشده منتشر می‌شود؛ در پایان، سفارش‌گیری دوباره آزمایش
              می‌شود.
            </p>
            <button
              className="care-link"
              onClick={() => p.navigate("deployments")}
            >
              انتشار امن
              <ArrowLeft size={15} />
            </button>
          </article>
        </div>
      </section>
      <section className="care-recent">
        <div className="care-summary-heading">
          <h2>آخرین پیگیری‌ها</h2>
          <button className="care-link" onClick={() => p.navigate("memory")}>
            همهٔ فعالیت‌ها
            <ArrowLeft size={15} />
          </button>
        </div>
        {state.actions.length ? (
          state.actions.slice(0, 3).map((a) => (
            <div className="care-activity" key={a.id}>
              <span className="care-activity-icon">
                {a.status === "completed" ? (
                  <Check size={17} />
                ) : a.status === "failed" ? (
                  <TriangleAlert size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
              </span>
              <div>
                <h3>{a.title}</h3>
                <p>
                  {a.status === "completed"
                    ? "انجام شد؛ نتیجه در جزئیات ثبت شده است."
                    : a.status === "pending"
                      ? "بدون تأیید شما اجرا نمی‌شود."
                      : a.status === "failed"
                        ? "نتیجهٔ مطلوب تأیید نشد؛ به پیگیری نیاز دارد."
                        : "جزئیات در تاریخچه ثبت شده است."}
                </p>
              </div>
              <small>{time(a.createdAt)}</small>
              {a.status === "pending" && (
                <button className="care-link" onClick={() => p.approve(a)}>
                  بررسی
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="care-empty">
            <Flower2 size={24} />
            <p>
              اولین پیگیری از همین‌جا شروع می‌شود.
              <br />
              <small>هر بررسی، پیشنهاد و نتیجه در حافظهٔ همراه می‌ماند.</small>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function ProtectionPanel({
  state,
  busy,
  run,
}: Pick<Props, "state" | "busy" | "run">) {
  const [agreed, setAgreed] = useState(false),
    policy = state.care?.policy;
  return (
    <section className="care-protection">
      <div className="care-row">
        <div>
          <h2>پشتیبان خودکار از سفارش‌ها</h2>
          <p>
            {policy?.enabled
              ? "فعال · هر ۶ ساعت"
              : "با یک تأیید، پشتیبان‌گیری منظم را به همراه بسپارید."}
          </p>
        </div>
        <ShieldCheck size={25} />
      </div>
      <p>
        هر نسخهٔ گل‌بازار ذخیره، بازخوانی و در جدولی جداگانه آزمایش می‌شود.
        بازیابی همیشه تأیید جداگانه می‌خواهد.
      </p>
      {state.care?.restoreAvailable && (
        <p className="care-detail">
          نسخهٔ رمز‌شده روی دستگاه اجرای همراه نگهداری می‌شود؛ برای بازیابی، این
          دستگاه و کلید مخزن آن باید محفوظ بمانند.
        </p>
      )}
      {policy?.enabled ? (
        <>
          <p className="care-detail">
            نوبت بعد: {when(state.care?.nextBackupAt)}
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(
                "protection",
                () =>
                  api("/care/protection", { enabled: false, confirm: false }),
                "پشتیبان خودکار متوقف شد.",
              )
            }
          >
            توقف پشتیبان خودکار
          </button>
        </>
      ) : (
        <>
          <label className="care-consent">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              پشتیبان‌گیری هر ۶ ساعت را تأیید می‌کنم؛ حداکثر ۲۸ نسخهٔ
              زمان‌بندی‌شده، بدون حذف خودکار.
              {state.mode === "live"
                ? state.care?.restoreAvailable
                  ? " نگهداری رمز‌شده روی دستگاه همراه؛ بدون ساخت سرویس جدید در لیارا."
                  : " هزینهٔ فضای نگهداری و پشتیبان مطابق تعرفهٔ حساب لیارا است."
                : " این محیط محلی هزینه‌ای ندارد."}
            </span>
          </label>
          <button
            className="button primary"
            disabled={busy || !agreed || !state.connections.writable}
            onClick={() =>
              void run(
                "protection",
                () => api("/care/protection", { enabled: true, confirm: true }),
                "پشتیبان خودکار فعال شد.",
              )
            }
          >
            فعال‌کردن پشتیبان خودکار
            <ArrowLeft size={16} />
          </button>
        </>
      )}
      {state.care?.backupError && (
        <p className="care-error" role="alert">
          {state.care.backupError}
        </p>
      )}
      {state.mode === "live" && !state.care?.restoreAvailable && (
        <p className="care-detail">
          برای این برنامه فقط فایل‌های پشتیبان لیارا قابل دریافت‌اند؛ آزمایش
          بازیابی و بازیابی خودکار به قرارداد امن گل‌بازار نیاز دارد.
        </p>
      )}
    </section>
  );
}
