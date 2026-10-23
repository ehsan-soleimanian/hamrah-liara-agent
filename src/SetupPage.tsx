import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  FileArchive,
  FileCode2,
  Flower2,
  Github,
  Info,
  LoaderCircle,
  Rocket,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { Snapshot, Action } from "./types";
import type { ProjectReport } from "./project-types";
import { api, cn, fa } from "./lib";
import ProvisionFlow from "./ProvisionFlow";

export default function SetupPage({
  state,
  onUpdateReady,
}: {
  state: Snapshot;
  onUpdateReady: (action: Action) => void;
}) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<"github" | "zip">("github");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [root, setRoot] = useState("");
  const [traffic, setTraffic] = useState("low");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [savedProject, setSavedProject] = useState<ProjectReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const canUpdate = !!state.managedAppId && state.connections.writable;
  async function updateCurrent() {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      onUpdateReady(await api<Action>(`/projects/${report.id}/update`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // History is optional: it must never hide the form or advance the wizard.
    fetch("/api/projects/active", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (alive && p) {
          setSavedProject((current) => current || p);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  function go(next: number) {
    setStep(next);
    setError("");
    setTimeout(() => heading.current?.focus(), 0);
  }
  async function analyze() {
    setError("");
    setBusy(true);
    try {
      let result: ProjectReport;
      if (source === "github")
        result = await api<ProjectReport>("/projects/github", {
          url,
          ref,
          root,
          traffic,
        });
      else {
        if (!file) throw new Error("ابتدا فایل ZIP پروژه را انتخاب کنید.");
        if (file.size > 20 * 1024 * 1024)
          throw new Error(
            "فایل باید کمتر از ۲۰ مگابایت باشد؛ پوشهٔ node_modules را حذف کنید.",
          );
        const query = new URLSearchParams({ name: file.name, root, traffic });
        const response = await fetch(`/api/projects/zip?${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/zip",
            "X-Hamrah-Client": "dashboard",
          },
          body: file,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "دریافت پروژه انجام نشد.");
        result = data;
      }
      setReport(result);
      setSavedProject(result);
      go(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="setup-layout project-intake">
      <section className="panel setup-main" aria-busy={busy}>
        <ol className="wizard-steps intake-steps" aria-label="مراحل راه‌اندازی">
          {["پروژهٔ شما", "تحلیل و پیشنهاد", "تأیید و انتشار"].map(
            (label, i) => (
              <li
                key={label}
                className={cn(i <= step && "done")}
                aria-current={i === step ? "step" : undefined}
              >
                <span>{i < step ? <Check size={14} /> : fa(i + 1)}</span>
                <strong>{label}</strong>
                {i < 2 && <i />}
              </li>
            ),
          )}
        </ol>
        <div className="wizard-content">
          {step === 0 && (
            <>
              <span className="eyebrow">از کد شما شروع می‌کنیم</span>
              <h2 ref={heading} tabIndex={-1}>
                پروژه‌تان را به همراه بسپارید.
              </h2>
              <p>
                لینک گیت‌هاب بدهید یا فایل پروژه را انتخاب کنید. همراه کد را
                بررسی می‌کند و می‌گوید برای آنلاین‌شدن به چه چیزهایی نیاز دارید.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void analyze();
                }}
              >
                <div
                  className="intake-source"
                  role="group"
                  aria-label="روش دریافت پروژه"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(source === "github" && "selected")}
                    aria-pressed={source === "github"}
                    onClick={() => {
                      setSource("github");
                      setError("");
                    }}
                  >
                    <Github size={22} />
                    <strong>لینک گیت‌هاب</strong>
                    <small>بدون دانلود دستی</small>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(source === "zip" && "selected")}
                    aria-pressed={source === "zip"}
                    onClick={() => {
                      setSource("zip");
                      setError("");
                    }}
                  >
                    <FileArchive size={22} />
                    <strong>فایل ZIP</strong>
                    <small>از کامپیوتر شما</small>
                  </button>
                </div>
                <fieldset disabled={busy} className="intake-fields">
                  {source === "github" ? (
                    <label htmlFor="project-url">
                      آدرس مخزن گیت‌هاب
                      <input
                        id="project-url"
                        type="url"
                        dir="ltr"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://github.com/you/your-project"
                        required
                        aria-describedby="repo-help intake-error"
                      />
                      <small id="repo-help">
                        لینک مخزن عمومی گیت‌هاب را وارد کنید. برای پروژهٔ خصوصی،
                        فایل ZIP را بارگذاری کنید.
                      </small>
                    </label>
                  ) : (
                    <label className="intake-upload" htmlFor="project-zip">
                      <UploadCloud size={32} />
                      <strong>
                        {file?.name || "فایل پروژه را انتخاب کنید"}
                      </strong>
                      <span>
                        ZIP تا ۲۰ مگابایت · بدون node_modules و فایل‌های کلید
                      </span>
                      <input
                        id="project-zip"
                        type="file"
                        accept=".zip,application/zip"
                        required
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        aria-describedby="intake-error"
                      />
                    </label>
                  )}
                  <label htmlFor="project-traffic">
                    در شروع چقدر بازدید دارید؟
                    <select
                      id="project-traffic"
                      value={traffic}
                      onChange={(e) => setTraffic(e.target.value)}
                    >
                      <option value="low">
                        تازه شروع می‌کنم یا بازدید کمی دارم
                      </option>
                      <option value="high">
                        کاربر فعال زیاد دارم یا انتظار رشد سریع دارم
                      </option>
                    </select>
                  </label>
                  <details className="intake-advanced">
                    <summary>تنظیمات اختیاری پروژه</summary>
                    <p>
                      اگر برنامه در پوشه‌ای داخل مخزن قرار دارد، نام آن را وارد
                      کنید.
                    </p>
                    <label htmlFor="project-root">
                      پوشهٔ برنامه
                      <input
                        id="project-root"
                        dir="ltr"
                        placeholder="apps/web"
                        value={root}
                        onChange={(e) => setRoot(e.target.value)}
                      />
                    </label>
                    {source === "github" && (
                      <label htmlFor="project-ref">
                        شاخه، تگ یا نسخه
                        <input
                          id="project-ref"
                          dir="ltr"
                          placeholder="پیش‌فرض مخزن"
                          value={ref}
                          onChange={(e) => setRef(e.target.value)}
                        />
                      </label>
                    )}
                  </details>
                </fieldset>
                <div className="notice-banner">
                  <ShieldCheck size={18} />
                  <span>
                    برای تحلیل، کد اجرا نمی‌شود. فایل‌های env و کلیدهای
                    شناخته‌شده از انتشار حذف می‌شوند. تنها پروژه‌ای را منتشر
                    کنید که به کدش اعتماد دارید.
                  </span>
                </div>
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <ArrowLeft size={17} />
                  )}{" "}
                  {busy
                    ? "در حال دریافت و بررسی پروژه…"
                    : "پروژه‌ام را بررسی کن"}
                </button>
                {busy && (
                  <p role="status">
                    دریافت سورس، بررسی وابستگی‌ها و آماده‌سازی پیشنهاد؛ ممکن است
                    یک دقیقه طول بکشد.
                  </p>
                )}
              </form>
              {savedProject && (
                <aside className="intake-resume" aria-label="پروژهٔ قبلی">
                  <div>
                    <strong>می‌خواهید پروژهٔ قبلی را ادامه دهید؟</strong>
                    <span dir="auto">{savedProject.name}</span>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setReport(savedProject);
                      go(1);
                    }}
                  >
                    ادامهٔ پروژهٔ قبلی
                    <ArrowLeft size={16} />
                  </button>
                </aside>
              )}
            </>
          )}
          {step === 1 && report && (
            <>
              <div className="intake-result-heading">
                <div>
                  <span className="eyebrow">
                    پیشنهاد بر اساس فایل‌های واقعی
                  </span>
                  <h2 ref={heading} tabIndex={-1}>
                    پروژه‌تان را شناختیم.
                  </h2>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => go(0)}
                >
                  واردکردن پروژهٔ جدید
                </button>
              </div>
              <p>
                برای «{report.name}» این مسیر را پیشنهاد می‌کنم. میزان دقیق
                منابع پس از اجرا مشخص می‌شود.
              </p>
              <div className="intake-project-summary">
                <span className="icon-tile green">
                  <FileCode2 size={26} />
                </span>
                <div>
                  <strong dir="auto">{report.stack}</strong>
                  <small>
                    {fa(report.fileCount)} فایل ·{" "}
                    {report.source === "github" ? "GitHub" : "ZIP"} · پوشهٔ{" "}
                    {report.root}
                  </small>
                </div>
                <span className="badge green">تحلیل واقعی</span>
              </div>
              <div className="recommended-stack">
                <div>
                  <span className="icon-tile green">
                    <Rocket size={22} />
                  </span>
                  <div>
                    <strong>میزبانی {report.stack}</strong>
                    <p>{report.resources}</p>
                    <small>
                      روش انتشار: {report.platform || "نیاز به تکمیل"} · پورت{" "}
                      {fa(report.port)}
                    </small>
                  </div>
                </div>
                {report.services.map((s) => (
                  <div key={s.name}>
                    <span className="icon-tile gray">
                      <Check size={21} />
                    </span>
                    <div>
                      <strong>{s.name}</strong>
                      <p>{s.reason}</p>
                    </div>
                    <span className="badge amber">بررسی اتصال</span>
                  </div>
                ))}
              </div>
              {report.agentReview && (
                <details
                  className="intake-review"
                  open={report.agentReview.length < 1000}
                >
                  <summary>توضیح همراه دربارهٔ این پروژه</summary>
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {report.agentReview.replace(/<[^>]*>/g, "")}
                  </p>
                </details>
              )}
              {!!report.blockers.length && (
                <div className="intake-blockers" role="alert">
                  <strong>پیش از انتشار این موارد را کامل کنید</strong>
                  <ul>
                    {report.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  {report.candidates.length > 1 && (
                    <p>
                      پوشه‌های پیدا‌شده:{" "}
                      <bdi>{report.candidates.join("، ")}</bdi>
                    </p>
                  )}
                  <button className="text-button" onClick={() => go(0)}>
                    انتخاب پوشه یا دریافت نسخهٔ اصلاح‌شده{" "}
                    <ArrowLeft size={15} />
                  </button>
                </div>
              )}
              <details className="intake-evidence">
                <summary>
                  همراه از کجا فهمید؟{" "}
                  <span>{fa(report.evidence.length)} شاهد</span>
                </summary>
                <ul>
                  {report.evidence.map((e, i) => (
                    <li key={i}>
                      <code dir="ltr">{e.file}</code>
                      <span>{e.finding}</span>
                    </li>
                  ))}
                </ul>
                <p>
                  نسخهٔ سورس: <code>{report.hash.slice(0, 16)}</code>
                  {report.revision && (
                    <>
                      {" "}
                      · Git commit: <code>{report.revision.slice(0, 12)}</code>
                    </>
                  )}
                </p>
                <p>
                  محیط اجرا: {report.runtime} · ساخت:{" "}
                  <bdi>{report.build || "طبق تنظیمات پروژه"}</bdi> · شروع:{" "}
                  <bdi>{report.start || "نیاز به تکمیل"}</bdi>
                </p>
              </details>
              {!!report.warnings.length && (
                <details className="intake-evidence">
                  <summary>نکات پیش از انتشار</summary>
                  <ul>
                    {report.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="wizard-buttons">
                {canUpdate && (
                  <button
                    className="button primary"
                    disabled={busy || !!report.blockers.length}
                    onClick={() => void updateCurrent()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Rocket size={17} />
                    )}{" "}
                    انتشار روی فروشگاه فعلی
                  </button>
                )}
                <button
                  className={cn("button", canUpdate ? "secondary" : "primary")}
                  disabled={busy || !!report.blockers.length}
                  onClick={() => go(2)}
                >
                  {canUpdate
                    ? "ساخت فروشگاه جداگانه"
                    : "ادامه به تنظیمات و انتشار"}{" "}
                  <ArrowLeft size={17} />
                </button>
                <button className="text-button" onClick={() => go(0)}>
                  تغییر پروژه
                </button>
              </div>
            </>
          )}
          {step === 2 && report && (
            <>
              <ProvisionFlow state={state} report={report} />
              <button className="text-button wizard-back" onClick={() => go(1)}>
                بازگشت به تحلیل پروژه
              </button>
            </>
          )}
          {error && (
            <p id="intake-error" className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
      <aside className="setup-aside">
        <div className="panel">
          <span className="agent-symbol">
            <Flower2 size={25} />
          </span>
          <h3>یک پروژه، یک مسیر روشن.</h3>
          <p>
            لازم نیست از سرور بدانید. همراه فایل‌ها را می‌خواند، نیازها را توضیح
            می‌دهد و پیش از تغییر از شما اجازه می‌گیرد.
          </p>
          <div className="intake-journey">
            {[
              "دریافت نسخهٔ مشخص از پروژه",
              "تحلیل وابستگی‌ها و روش اجرا",
              "پیشنهاد زیرساخت با شواهد",
              "تأیید شما و بررسی نتیجه",
            ].map((t, i) => (
              <div key={t}>
                <span>{fa(i + 1)}</span>
                <p>{t}</p>
              </div>
            ))}
          </div>
          <div className="setup-assurance">
            <ShieldCheck size={18} /> کنترل همیشه دست شماست.
          </div>
        </div>
        <div className="panel domain-guide">
          <Info size={23} />
          <h3>چه چیزهایی بررسی می‌شوند؟</h3>
          <p>
            فریم‌ورک، وابستگی‌ها، Dockerfile، نام تنظیمات و نشانه‌های دیتابیس و
            کش. تحلیل ایستا تضمین اجرای بی‌خطا نیست؛ نتیجه پس از انتشار سنجیده
            می‌شود.
          </p>
          <p>در حالت دمو هم کد واقعی بررسی می‌شود؛ بدون نیاز به کلید API.</p>
        </div>
      </aside>
    </div>
  );
}
