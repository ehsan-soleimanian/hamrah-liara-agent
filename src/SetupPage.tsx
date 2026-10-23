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
import ProjectAdvicePanel from "./ProjectAdvice";

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
  const [reviewing, setReviewing] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const canUpdate = !!state.managedAppId && state.connections.writable;
  const adviceReady = report?.advice?.status === "ready";
  const canContinue = state.mode === "demo" || adviceReady;
  const packageId = selectedPackage || report?.advice?.recommendedId || "";
  async function reviewProject(project: ProjectReport) {
    setReviewing(true);
    setError("");
    setReport({
      ...project,
      advice: {
        ...project.advice,
        provider: "cursor",
        projectHash: project.hash,
        status: "analyzing",
        stage: "connecting",
        at: new Date().toISOString(),
      },
    });
    try {
      const result = await api<ProjectReport>(
        `/projects/${project.id}/advice`,
        {},
      );
      setReport(result);
      setSavedProject(result);
      setSelectedPackage("");
    } catch (e) {
      setError((e as Error).message);
      setReport(
        (current) =>
          current && {
            ...current,
            advice: {
              provider: "cursor",
              projectHash: current.hash,
              status: "failed",
              at: new Date().toISOString(),
              error: { code: "request_failed", message: (e as Error).message },
            },
          },
      );
    } finally {
      setReviewing(false);
    }
  }
  useEffect(() => {
    if (step !== 1 || report?.advice?.status !== "analyzing") return;
    const id = report.id;
    let alive = true;
    const poll = setInterval(() => {
      fetch(`/api/projects/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (alive && p)
            setReport((current) => (current?.id === id ? p : current));
        })
        .catch(() => {});
    }, 1800);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [step, report?.id, report?.advice?.status]);
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
      setSelectedPackage("");
      setBusy(false);
      go(1);
      if (state.mode === "live" || state.connections.cursor)
        await reviewProject(result);
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
              <h2 ref={heading} tabIndex={-1}>
                انتخاب پروژه
              </h2>

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
                    دریافت سورس از فایل‌های واقعی تأیید شد
                  </span>
                  <h2 ref={heading} tabIndex={-1}>
                    {adviceReady
                      ? "پیشنهاد کرسر آماده است."
                      : reviewing || report.advice?.status === "analyzing"
                        ? "از کد شما تا پیشنهاد مناسب."
                        : "سورس پروژه دریافت شد."}
                  </h2>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    busy || reviewing || report.advice?.status === "analyzing"
                  }
                  onClick={() => go(0)}
                >
                  واردکردن پروژهٔ جدید
                </button>
              </div>
              <p>
                نسخهٔ «{report.name}» دریافت و فایل‌ها بررسی شده‌اند. پیشنهاد
                پکیج را جداگانه از Cursor می‌گیریم.
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
              <ProjectAdvicePanel
                report={report}
                loading={reviewing}
                selected={packageId}
                onSelect={setSelectedPackage}
                onRetry={() => void reviewProject(report)}
                demo={state.mode === "demo"}
              />
              <details className="intake-evidence">
                <summary>جزئیات فنی شناخته‌شده از کد</summary>
                <div className="recommended-stack">
                  <div>
                    <span className="icon-tile green">
                      <Rocket size={22} />
                    </span>
                    <div>
                      <strong>آنچه از فایل‌ها پیدا شد: {report.stack}</strong>
                      <p>
                        {report.runtime} · شروع برنامه:{" "}
                        <bdi>{report.start || "نیاز به بررسی بیشتر"}</bdi>
                      </p>
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
              </details>
              {report.agentReview && !report.advice && (
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
                    disabled={
                      busy ||
                      reviewing ||
                      !canContinue ||
                      !!report.blockers.length
                    }
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
                  disabled={
                    busy ||
                    reviewing ||
                    !canContinue ||
                    !!report.blockers.length
                  }
                  onClick={() => go(2)}
                >
                  {!canContinue
                    ? "ابتدا پیشنهاد کرسر را کامل کنید"
                    : canUpdate
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
              <ProvisionFlow
                key={report.id}
                state={state}
                report={report}
                packageId={packageId}
              />
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
    </div>
  );
}
