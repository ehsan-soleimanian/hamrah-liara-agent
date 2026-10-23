import {
  ArrowLeft,
  Check,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { ProjectReport } from "./project-types";
import { fa, time } from "./lib";
export default function ProjectAdvicePanel({
  report,
  loading,
  selected,
  onSelect,
  onRetry,
  demo,
}: {
  report: ProjectReport;
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
  demo: boolean;
}) {
  const advice = report.advice,
    ready = advice?.status === "ready",
    working = loading || advice?.status === "analyzing";
  const stage = advice?.stage;
  if (working)
    return (
      <section
        className="project-advice working"
        role="status"
        aria-live="polite"
      >
        <div className="advice-heading">
          <LoaderCircle className="spin" size={24} />
          <div>
            <h3>کرسر دارد نیازهای پروژه را بررسی می‌کند</h3>
            <p>کد شما و پلن‌های موجود لیارا؛ هنوز هیچ سرویسی ساخته نمی‌شود.</p>
          </div>
        </div>
        <ol className="advice-progress">
          <li className="complete">
            <Check size={16} />
            دریافت نسخهٔ مشخص از پروژه
          </li>
          <li
            className={
              stage === "source" ||
              stage === "catalog" ||
              stage === "validating"
                ? "complete"
                : ""
            }
          >
            خواندن سورس با ابزار ایجنت
          </li>
          <li
            className={
              stage === "catalog" || stage === "validating" ? "complete" : ""
            }
          >
            بررسی پلن‌ها و قیمت واقعی
          </li>
          <li>انتخاب پکیج و اعتبارسنجی پیشنهاد</li>
        </ol>
        <small>
          ممکن است تا دو دقیقه طول بکشد. اگر صفحه بسته شود، نتیجهٔ بررسی در
          سابقهٔ همین پروژه می‌ماند.
        </small>
      </section>
    );
  if (!ready)
    return (
      <section
        className={`project-advice ${advice?.status === "failed" ? "failed" : ""}`}
        aria-label="وضعیت پیشنهاد Cursor"
      >
        <div className="advice-heading">
          {advice?.status === "failed" ? (
            <TriangleAlert size={24} />
          ) : (
            <Sparkles size={24} />
          )}
          <div>
            <h3>
              {advice?.status === "failed"
                ? "پیشنهاد کرسر هنوز آماده نیست"
                : "پکیج مناسب را از کرسر بپرسیم"}
            </h3>
            <p>
              {advice?.error?.message ||
                (demo
                  ? "در این حالت می‌توانید جریان نمایشی را امتحان کنید. پیشنهاد واقعی نیاز به اجرای Cursor دارد."
                  : "کد دریافت شده است؛ برای انتخاب پکیج، کرسر باید سورس و پلن‌های موجود را بررسی کند.")}
            </p>
          </div>
        </div>
        <div className="advice-actions">
          <button type="button" className="button primary" onClick={onRetry}>
            <RefreshCw size={16} />
            {advice?.status === "failed"
              ? "بررسی دوباره با کرسر"
              : "تحلیل و پیشنهاد با کرسر"}
          </button>
          <a className="button secondary" href="#settings">
            بررسی اتصال‌ها
            <ArrowLeft size={16} />
          </a>
        </div>
        <small>
          تا پیش از پیشنهاد معتبر و تأیید هزینه، این مسیر در حالت واقعی ادامه
          پیدا نمی‌کند.
        </small>
      </section>
    );
  return (
    <section
      className="project-advice ready"
      aria-label="پکیج‌های پیشنهادی Cursor"
    >
      <div className="advice-heading">
        <Sparkles size={24} />
        <div>
          <h3>پیشنهاد کرسر برای پروژهٔ شما</h3>
          <p>{advice.summary}</p>
        </div>
        <span className="badge green">
          {advice.catalogMode === "demo"
            ? "Cursor · قیمت نمایشی"
            : "Cursor واقعی"}
        </span>
      </div>
      <div className="advice-packages" role="group" aria-label="انتخاب پکیج">
        {advice.packages?.map((p) => (
          <button
            type="button"
            className={`advice-package ${selected === p.id ? "selected" : ""}`}
            aria-pressed={selected === p.id}
            key={p.id}
            onClick={() => onSelect(p.id)}
          >
            <span className="advice-package-title">
              <strong>{p.title}</strong>
              {p.id === advice.recommendedId && (
                <span className="badge green">پیشنهاد کرسر</span>
              )}
            </span>
            <p>{p.reason}</p>
            <span className="advice-resources">
              برنامه: {fa(p.app.ram)} گیگابایت حافظه · {fa(p.app.cpu)} پردازنده
            </span>
            <span className="advice-resources">
              {p.databases.length
                ? p.databases
                    .map((d) => `${d.type} · ${fa(d.plan.ram)} GB`)
                    .join(" + ")
                : "بدون دیتابیس اضافه"}
            </span>
            <span className="advice-price">
              <strong>{fa(Math.round(p.monthly))}</strong> تومان برای ۳۰ روز
              روشن‌بودن
            </span>
            <small>
              میانگین برآوردی هر ساعت: {fa(Math.round(p.hourlyEstimate))} تومان
            </small>
            <span className="advice-selection">
              {selected === p.id ? (
                <>
                  <Check size={16} />
                  بستهٔ انتخاب‌شده
                </>
              ) : (
                "انتخاب این بسته"
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="advice-assumptions">
        <ShieldCheck size={17} />
        <p>
          قیمت از فهرست لیارا محاسبه شده؛ هزینهٔ نهایی پیش از اجرا دوباره بررسی
          می‌شود. انتخاب پکیج، اجازهٔ ساخت سرویس نیست.
        </p>
      </div>
      <details>
        <summary>دلایل و محدودیت‌های این پیشنهاد</summary>
        <ul>
          {advice.assumptions?.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <p>
          شواهد کد:{" "}
          <bdi>
            {advice.packages
              ?.find((p) => p.id === selected)
              ?.evidence.join("، ")}
          </bdi>
        </p>
        <small>
          مدل {advice.model} · بررسی {time(advice.at)} · سورس{" "}
          <bdi>{advice.projectHash.slice(0, 12)}</bdi>
        </small>
      </details>
    </section>
  );
}
