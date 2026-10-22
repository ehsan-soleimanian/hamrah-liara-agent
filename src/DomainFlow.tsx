import { useEffect, useRef, useState } from "react";
import {
  Globe,
  LockKeyhole,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
  Copy,
  Info,
} from "lucide-react";
import { api, time } from "./lib";
import type { DomainJob } from "./domain-types";

const titles: Record<DomainJob["status"], string> = {
  approval: "اجازهٔ اتصال دامنه",
  attaching: "در حال اتصال دامنه",
  dns_approval: "تأیید تنظیمات آدرس",
  applying_dns: "در حال ثبت تنظیمات",
  waiting_ns: "منتظر تغییر نیم‌سرورهای دامنه",
  waiting_dns: "منتظر انتشار آدرس",
  waiting_ssl: "در حال آماده‌سازی اتصال امن",
  verifying: "در حال بررسی سایت",
  active: "سایت با دامنهٔ شما در دسترس است",
  attention: "نیاز به بررسی بیشتر",
  cancelled: "پیگیری متوقف شد",
};
export default function DomainFlow({ jobId }: { jobId: string }) {
  const [jobs, setJobs] = useState<DomainJob[]>([]),
    [name, setName] = useState(""),
    [provider, setProvider] = useState<"liara" | "manual" | "cloudflare">(
      "liara",
    ),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [agreed, setAgreed] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null),
    mounted = useRef(true);
  async function load() {
    const j = await api<DomainJob[]>(
      "/domains?jobId=" + jobId,
      undefined,
      "GET",
    );
    if (mounted.current) setJobs(j);
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [jobId]);
  async function run(f: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await f();
      await load();
      setAgreed("");
    } catch (e) {
      setError((e as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  const current = jobs.find((j) => j.status !== "cancelled");
  const pending =
    current && ["approval", "dns_approval"].includes(current.status);
  return (
    <section
      className="domain-flow"
      aria-labelledby="domain-title"
      aria-busy={busy}
    >
      <div className="domain-heading">
        <span className="domain-icon">
          <Globe size={24} />
        </span>
        <div>
          <h3 id="domain-title">یک آدرس، به نام کسب‌وکار شما</h3>
          <p>
            دامنه‌تان را وارد کنید؛ همراه اتصال، امنیت و نتیجه را پیگیری می‌کند.
          </p>
        </div>
      </div>
      {!current || ["attention", "cancelled"].includes(current.status) ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/domains/plan", {
                jobId,
                name,
                provider,
                ...(token ? { cloudflareToken: token } : {}),
              });
              setToken("");
            });
          }}
        >
          <label htmlFor={"domain-" + jobId}>دامنه‌ای که قبلاً خریده‌اید</label>
          <div className="domain-input-row">
            <input
              id={"domain-" + jobId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="ltr"
              placeholder="yourbusiness.ir"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={"domain-help-" + jobId}
            />
            <button className="button primary" disabled={busy}>
              {busy ? "در حال بررسی…" : "بررسی و ادامه"}
              <ArrowLeft size={16} />
            </button>
          </div>
          <p id={"domain-help-" + jobId} className="domain-note">
            بدون https یا مسیر صفحه. خرید دامنه در این مرحله انجام نمی‌شود.
          </p>
          <p className="domain-note">
            مسیر پیشنهادی: DNS رایگان لیارا. فقط نیم‌سرورها را در ثبت‌کننده
            تغییر می‌دهید؛ ثبت رکوردها و SSL با همراه است.
          </p>
          <details>
            <summary>استفاده از سرویس DNS دیگر (اختیاری)</summary>
            <fieldset className="domain-provider">
              <legend>تنظیمات دامنه کجا مدیریت می‌شود؟</legend>
              <label>
                <input
                  type="radio"
                  name={"dns-" + jobId}
                  checked={provider === "liara"}
                  onChange={() => setProvider("liara")}
                />{" "}
                DNS لیارا — پیشنهاد همراه
              </label>
              <label>
                <input
                  type="radio"
                  name={"dns-" + jobId}
                  checked={provider === "manual"}
                  onChange={() => setProvider("manual")}
                />{" "}
                سرویس دیگر یا مطمئن نیستم{" "}
                <small>
                  همراه فقط مرحله‌ای را که به دسترسی شما نیاز دارد نشان می‌دهد.
                </small>
              </label>
              <label>
                <input
                  type="radio"
                  name={"dns-" + jobId}
                  checked={provider === "cloudflare"}
                  onChange={() => setProvider("cloudflare")}
                />{" "}
                Cloudflare{" "}
                <small>ثبت تنظیمات به‌صورت خودکار، پس از تأیید شما.</small>
              </label>
            </fieldset>
          </details>
          {provider === "cloudflare" && (
            <div className="domain-credential">
              <label htmlFor={"cf-" + jobId}>
                کلید دسترسی محدود Cloudflare
              </label>
              <input
                id={"cf-" + jobId}
                type="password"
                dir="ltr"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                required
                aria-describedby={"cf-help-" + jobId}
              />
              <small id={"cf-help-" + jobId}>
                دسترسی Zone:Read و DNS:Edit فقط برای همین دامنه. کلید رمزگذاری
                می‌شود و به ایجنت ارسال نمی‌شود. دامنه باید در Cloudflare فعال
                باشد.
              </small>
              <a
                href="https://dash.cloudflare.com/profile/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                ساخت کلید در Cloudflare
              </a>
            </div>
          )}
        </form>
      ) : null}
      {current && (
        <div className="domain-result">
          <div className="domain-state">
            <bdi>{current.name}</bdi>
            <span
              className={
                "domain-status " + (current.status === "active" ? "good" : "")
              }
            >
              {titles[current.status]}
            </span>
          </div>
          {current.mode === "demo" && (
            <p className="domain-notice">
              <Info size={17} /> حالت نمایشی؛ هیچ دامنه، رکورد یا گواهی واقعی
              تغییر نمی‌کند.
            </p>
          )}
          <p role="status">{current.message}</p>
          {current.status === "approval" && (
            <div className="domain-notice">
              <LockKeyhole size={19} />
              <p>
                این دامنه به برنامهٔ <bdi>{current.appName}</bdi> متصل می‌شود.
                {current.provider === "liara"
                  ? "سامانهٔ رایگان DNS لیارا نیز در همین حساب آماده می‌شود؛ نیم‌سرورهای ثبت‌کننده را فقط خودتان تغییر می‌دهید."
                  : "فعلاً DNS تغییر نمی‌کند."}
                پس از دریافت رکوردهای واقعی، پیش از تغییر دوباره تأیید می‌گیریم.
                SSL لیارا رایگان است؛ هزینهٔ خرید یا تمدید دامنه جداست.
              </p>
            </div>
          )}
          {current.provider === "liara" &&
            ["dns_approval", "waiting_ns", "attention"].includes(
              current.status,
            ) &&
            !!current.zone?.nameservers.length && (
              <div className="domain-nameservers">
                <h4>فقط این دو نیم‌سرور را وارد کنید</h4>
                <p>
                  در سایت ثبت‌کنندهٔ <bdi>{current.zone.name}</bdi>، نیم‌سرورهای
                  فعلی را با این دو مقدار جایگزین کنید. برای دامنهٔ ir این کار
                  در ایرنیک انجام می‌شود.
                </p>
                {current.zone.nameservers.map((ns) => (
                  <div className="domain-ns" key={ns}>
                    <code dir="ltr">{ns}</code>
                    <button
                      className="text-button"
                      aria-label={"کپی نیم‌سرور " + ns}
                      onClick={() =>
                        void run(() => navigator.clipboard.writeText(ns))
                      }
                    >
                      <Copy size={15} /> کپی
                    </button>
                  </div>
                ))}
                <details>
                  <summary>دامنه‌ام سایت یا ایمیل فعال دارد</summary>
                  <p className="domain-note">
                    تغییر NS مدیریت کل دامنه را منتقل می‌کند. اگر سایت، ایمیل یا
                    سرویس فعالی دارید، رکوردهای قبلی را پیش از تغییر NS به DNS
                    لیارا منتقل کنید؛ همراه امکان کشف تمام رکوردهای خصوصی
                    ارائه‌دهندهٔ قبلی را ندارد. تغییر DS/DNSSEC نیز باید با
                    ثبت‌کننده بررسی شود.
                  </p>
                </details>
                <p>
                  بعد از تأیید NS، همراه رکوردهای اتصال، اثبات مالکیت و تمدید
                  SSL را خودکار ثبت می‌کند. هیچ کلید DNS جداگانه‌ای لازم نیست.
                </p>
                {current.status === "waiting_ns" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api("/domains/" + current.id + "/nameservers", {}),
                      )
                    }
                  >
                    نیم‌سرورها را تغییر دادم؛ بررسی کن
                  </button>
                )}
                <a href="https://nic.ir/" target="_blank" rel="noreferrer">
                  بازکردن ایرنیک برای دامنه‌های ir
                </a>
              </div>
            )}
          {!!current.records.length && (
            <details
              className="domain-records"
              open={current.provider !== "liara" && current.status !== "active"}
            >
              <summary>
                {current.provider === "liara"
                  ? "جزئیات تنظیمات خودکار همراه"
                  : current.provider === "manual"
                    ? "این تنظیمات را در سرویس دامنه ثبت کنید"
                    : "تغییرات دقیق پیش از اجرا"}
              </summary>
              {current.changes.map((c, i) => (
                <div className="domain-record" key={c.record.name}>
                  <div>
                    <span className="domain-record-type">{c.record.type}</span>
                    <span>
                      {c.action === "keep"
                        ? "از قبل درست است"
                        : c.action === "replace"
                          ? "جایگزینی رکورد فعلی"
                          : "رکورد جدید"}
                    </span>
                  </div>
                  <label>
                    نام رکورد<code dir="ltr">{c.record.name}</code>
                  </label>
                  <label>
                    مقدار<code dir="ltr">{c.record.content}</code>
                  </label>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      void run(() =>
                        navigator.clipboard.writeText(c.record.content),
                      )
                    }
                    aria-label={"کپی مقدار رکورد " + c.record.name}
                  >
                    <Copy size={14} /> کپی مقدار
                  </button>
                  {c.before.length > 0 && (
                    <details>
                      <summary>مقادیر قبلی که جایگزین می‌شوند</summary>
                      {c.before.map((x) => (
                        <code dir="ltr" key={x.id}>
                          {x.type} {x.content}
                          {x.proxied ? " · Proxy on" : ""}
                        </code>
                      ))}
                    </details>
                  )}
                  {i === 0 && (
                    <small>
                      برای دامنهٔ اصلی از ALIAS یا CNAME Flattening استفاده
                      کنید. در Cloudflare رکوردها DNS Only ثبت می‌شوند؛ ایمیل و
                      نیم‌سرورها تغییر نمی‌کنند.
                    </small>
                  )}
                </div>
              ))}
            </details>
          )}
          {pending && (
            <>
              <label className="domain-consent">
                <input
                  type="checkbox"
                  checked={agreed === current.fingerprint}
                  onChange={(e) =>
                    setAgreed(e.target.checked ? current.fingerprint : "")
                  }
                />
                {current.status === "approval"
                  ? "اتصال همین دامنه به همین برنامه را تأیید می‌کنم."
                  : current.provider === "liara"
                    ? "رکوردهای سرویس‌های قبلی را منتقل کرده‌ام یا سرویس فعالی ندارم؛ ثبت خودکار رکوردها و درخواست SSL پس از تأیید NS را تا ۲۴ ساعت اجازه می‌دهم."
                    : current.provider === "cloudflare"
                      ? "تغییرات بالا و درخواست SSL و پیگیری آن تا ۲۴ ساعت را تأیید می‌کنم."
                      : "رکوردهای بالا و درخواست SSL پس از تأیید DNS، با پیگیری تا ۲۴ ساعت را تأیید می‌کنم."}
              </label>
              <div className="domain-actions">
                <button
                  className="button primary"
                  disabled={busy || agreed !== current.fingerprint}
                  onClick={() =>
                    void run(() =>
                      api("/domains/" + current.id + "/decision", {
                        fingerprint: current.fingerprint,
                        approve: true,
                      }),
                    )
                  }
                >
                  {busy
                    ? "در حال انجام…"
                    : current.status === "approval"
                      ? "تأیید و دریافت تنظیمات"
                      : current.provider === "liara"
                        ? "تأیید و ادامه با DNS لیارا"
                        : current.provider === "cloudflare"
                          ? "تأیید و تنظیم خودکار"
                          : "تأیید و شروع پیگیری"}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api("/domains/" + current.id + "/decision", {
                        fingerprint: current.fingerprint,
                        approve: false,
                      }),
                    )
                  }
                >
                  انصراف از ادامه
                </button>
              </div>
              <small>
                تأیید برای همین تغییرات و تا ۱۰ دقیقه معتبر است. برای ادامهٔ
                پیشنهاد منقضی‌شده، پیگیری را متوقف و دوباره شروع کنید.
              </small>
            </>
          )}
          {!pending && current.status !== "cancelled" && (
            <>
              <div className="domain-checks">
                {[
                  ["dns", "اتصال آدرس"],
                  ["tls", "گواهی معتبر"],
                  ["https", "پاسخ موفق سایت"],
                  ["redirect", "انتقال به HTTPS"],
                ].map(([k, label]) => (
                  <div
                    key={k}
                    className={current.checks[k as "dns"] ? "done" : ""}
                  >
                    <CheckCircle2 size={17} />
                    <span>{label}</span>
                    <small>
                      {current.checks[k as "dns"]
                        ? "تأیید شد"
                        : "هنوز تأیید نشده"}
                    </small>
                  </div>
                ))}
              </div>
              {current.checks.certificateExpiresAt && (
                <p>
                  اعتبار گواهی تا{" "}
                  <bdi>
                    {new Date(
                      current.checks.certificateExpiresAt,
                    ).toLocaleDateString("fa-IR")}
                  </bdi>
                  ؛ تمدید توسط لیارا انجام می‌شود و همراه اعتبار را بررسی
                  می‌کند.
                </p>
              )}
              <div className="domain-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api("/domains/" + current.id + "/check", {}))
                  }
                >
                  <RefreshCw size={16} /> بررسی دوبارهٔ نتیجه
                </button>
                {current.status === "active" && current.mode === "live" && (
                  <a
                    className="button primary"
                    href={"https://" + current.name}
                    rel="noreferrer"
                    target="_blank"
                  >
                    بازکردن سایت
                    <ArrowLeft size={16} />
                  </a>
                )}
              </div>
            </>
          )}
          <details className="domain-history">
            <summary>چه کارهایی انجام شده؟</summary>
            <ol>
              {current.events.map((e, i) => (
                <li key={i}>
                  <time>{time(e.at)}</time> {e.text}
                </li>
              ))}
            </ol>
          </details>
          {current.status !== "cancelled" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(() => api("/domains/" + current.id + "/cancel", {}))
              }
            >
              توقف پیگیری این دامنه
            </button>
          )}
        </div>
      )}
      {error && (
        <p ref={errorRef} tabIndex={-1} className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
