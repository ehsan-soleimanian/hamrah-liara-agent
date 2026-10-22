import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  Database,
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, fa } from "./lib";
import LiaraAccount from "./LiaraAccount";
import type { Snapshot } from "./types";
import type { ProjectReport } from "./project-types";
import type {
  CloudCatalog,
  DatabaseSelection,
  DatabaseType,
  ProvisionJob,
} from "./provision-types";

const labels: Record<DatabaseType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  redis: "Redis",
};
const partLabels: Record<string, string> = {
  url: "آدرس اتصال کامل",
  host: "میزبان",
  port: "پورت",
  username: "نام کاربری",
  password: "رمز اتصال",
  database: "نام دیتابیس",
};
const money = (value: number) =>
  new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(value);
function suggestedType(name: string): DatabaseType | undefined {
  return (
    {
      PostgreSQL: "postgres",
      MySQL: "mysql",
      MongoDB: "mongodb",
      Redis: "redis",
    } as Record<string, DatabaseType>
  )[name];
}
function suggestBinding(env: string, dbs: DatabaseSelection[]) {
  let type: DatabaseType | undefined;
  if (/REDIS/i.test(env)) type = "redis";
  else if (/MONGO/i.test(env)) type = "mongodb";
  else if (/MYSQL/i.test(env)) type = "mysql";
  else if (/POSTGRES|^PG_/i.test(env)) type = "postgres";
  else if (/^(DATABASE|DB)_/.test(env))
    type = dbs.find((d) => d.type !== "redis")?.type;
  const index = dbs.findIndex((d) => d.type === type);
  if (index < 0 || /^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(env)) return "manual";
  const part = /URL|URI/.test(env)
    ? "url"
    : /HOST/.test(env)
      ? "host"
      : /PORT/.test(env)
        ? "port"
        : /PASSWORD|PASS/.test(env)
          ? "password"
          : /USER/.test(env)
            ? "username"
            : /NAME|DATABASE|^PG_DATABASE$/.test(env)
              ? "database"
              : "";
  return part ? `${index}:${part}` : "manual";
}
function envHelp(name: string) {
  if (/PASSWORD|SECRET/.test(name))
    return "مقدار محرمانه؛ در گزارش‌ها نمایش داده نمی‌شود.";
  if (/KEY|TOKEN/.test(name))
    return "کلید اتصال سرویسی که پروژه از آن استفاده می‌کند.";
  return "مقداری که این برنامه برای اجرا نیاز دارد.";
}

export default function ProvisionFlow({
  state,
  report,
}: {
  state: Snapshot;
  report: ProjectReport;
}) {
  const [catalog, setCatalog] = useState<CloudCatalog | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [appName, setAppName] = useState(() => {
    const n = report.name
      .replace(/\.zip$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
    return /^[a-z]/.test(n) && n.length >= 3
      ? n
      : `my-app-${report.id.slice(0, 6)}`;
  });
  const [appPlan, setAppPlan] = useState(""),
    [networkId, setNetworkId] = useState("");
  const [databases, setDatabases] = useState<DatabaseSelection[]>([]),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [env, setEnv] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<{ name: string; value: string }[]>([]);
  const [healthPath, setHealthPath] = useState(
      report.checks?.healthPath || "/",
    ),
    [businessPath, setBusinessPath] = useState(
      report.checks?.businessPath || "",
    );
  const [quote, setQuote] = useState<ProvisionJob | null>(null),
    [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false);
  const [showConnection, setShowConnection] = useState(false),
    [token, setToken] = useState(""),
    [cursorKey, setCursorKey] = useState(""),
    [teamId, setTeamId] = useState(state.connections.teamId || "");
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  async function loadCatalog() {
    setError("");
    setLoading(true);
    try {
      setCatalog(
        await api<CloudCatalog>("/provision/catalog", undefined, "GET"),
      );
    } catch (e) {
      setCatalog(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadCatalog();
    setQuote(null);
    setSelectedJob(null);
  }, [state.mode, state.connections.liara, state.connections.teamId]);
  useEffect(() => {
    if (!catalog) return;
    setAppPlan((current) =>
      catalog.appPlans.some((p) => p.id === current)
        ? current
        : (
            catalog.appPlans.find(
              (p) => p.ram >= (/Next|Nuxt/.test(report.stack) ? 1 : 0.5),
            ) || catalog.appPlans[0]
          )?.id || "",
    );
    const list = report.services
      .map((s) => suggestedType(s.name))
      .filter((t): t is DatabaseType => !!t)
      .map((type, i) => ({
        type,
        name: `${appName.slice(0, 28)}-${type === "redis" ? "cache" : `db${i + 1}`}`,
        plan:
          catalog.databasePlans.find((p) => p.supports.includes(type))?.id ||
          "",
        version: catalog.versions[type]?.[0] || "",
        bindings: {},
      }));
    setDatabases(list);
    setBindings(
      Object.fromEntries(
        report.envNames.map((n) => [n, suggestBinding(n, list)]),
      ),
    );
    setNetworkId("");
  }, [catalog]);
  const jobs = (state.provisionJobs || []).filter(
    (j) => j.projectId === report.id,
  );
  const job =
    selectedJob === null
      ? jobs.find((j) => j.status === "running") || jobs[0]
      : jobs.find((j) => j.id === selectedJob);
  useEffect(() => {
    if (selectedJob === null && job?.status === "pending") {
      setQuote(job);
      setAgreed(false);
    }
  }, [job?.id, job?.status, selectedJob]);
  useEffect(() => {
    if (
      quote &&
      jobs.some((j) => j.id === quote.id && j.status !== "pending")
    ) {
      setQuote(null);
      setAgreed(false);
    }
  }, [jobs, quote]);
  async function connect(mode: "demo" | "live") {
    setBusy(true);
    setError("");
    try {
      await api("/connection", {
        mode,
        ...(mode === "live" && token ? { liaraToken: token } : {}),
        ...(mode === "live" && cursorKey ? { cursorKey } : {}),
        ...(mode === "live" ? { teamId } : {}),
      });
      setToken("");
      setCursorKey("");
      setShowConnection(false);
      setQuote(null);
      await loadCatalog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setError("");
    setBusy(true);
    try {
      const selections = databases.map((d) => ({
        ...d,
        bindings: {} as Record<string, string>,
      }));
      const values: Record<string, string> = {};
      for (const name of report.envNames) {
        const selected = bindings[name] || "manual";
        if (selected === "manual") {
          if (env[name]) values[name] = env[name];
        } else {
          const [index, part] = selected.split(":");
          if (!selections[Number(index)])
            throw new Error("اتصال دیتابیس را دوباره انتخاب کنید.");
          selections[Number(index)].bindings[name] = part;
        }
      }
      for (const row of extra)
        if (row.name) {
          if (values[row.name] || report.envNames.includes(row.name))
            throw new Error("نام تنظیم تکراری است.");
          values[row.name] = row.value;
        }
      const result = await api<ProvisionJob>("/provision/quote", {
        projectId: report.id,
        appName,
        appPlan,
        networkId,
        databases: selections,
        env: values,
        healthPath,
        businessPath,
      });
      setQuote(result);
      setAgreed(false);
      setSelectedJob(result.id);
      setTimeout(() => reviewHeading.current?.focus(), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decision(approve: boolean) {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      await api(`/provision/${quote.id}/decision`, {
        fingerprint: quote.fingerprint,
        approve,
      });
      setSelectedJob(quote.id);
      setQuote(null);
      setEnv({});
      setExtra([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeDb(index: number, change: Partial<DatabaseSelection>) {
    setDatabases((current) =>
      current.map((d, i) => (i === index ? { ...d, ...change } : d)),
    );
  }
  const active = job && job.status !== "pending";
  return (
    <div className="provision-flow">
      <h2>زیرساخت را با هم آماده کنیم.</h2>
      <div className="provision-connection">
        <span className="icon-tile green">
          <Cloud size={21} />
        </span>
        <div>
          <strong>
            {state.mode === "demo"
              ? "اول، بدون هزینه امتحان کنید"
              : "به حساب لیارای شما متصل است"}
          </strong>
          <p>
            {state.mode === "demo"
              ? "ساخت سرویس‌ها و قیمت‌ها نمایشی‌اند؛ سورس واقعاً بسته‌بندی می‌شود."
              : "ساخت و تنظیم سرویس‌ها در همین صفحه انجام می‌شود؛ نیازی به پنل لیارا ندارید."}
          </p>
        </div>
        <button
          className="text-button"
          disabled={busy || job?.status === "running"}
          onClick={() => setShowConnection((v) => !v)}
        >
          {state.mode === "demo" ? "اتصال به حساب واقعی" : "تغییر اتصال"}
        </button>
      </div>
      <LiaraAccount
        teamId={state.connections.teamId}
        enabled={
          state.connections.liara &&
          state.mode === "live" &&
          job?.status !== "running"
        }
      />
      {showConnection && (
        <form
          className="intake-config intake-fields"
          onSubmit={(e) => {
            e.preventDefault();
            void connect("live");
          }}
        >
          <h3>یک بار اتصال؛ بقیه با همراه</h3>
          <p>
            کلید دسترسی حساب لیارا را وارد کنید. روی همین دستگاه رمزگذاری و
            نگهداری می‌شود و به ایجنت یا مرورگر برگردانده نمی‌شود.
          </p>
          <label htmlFor="liara-connect-token">
            کلید اتصال لیارا
            <input
              id="liara-connect-token"
              type="password"
              autoComplete="off"
              required={!state.connections.liara}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              dir="ltr"
              placeholder={
                state.connections.liara
                  ? "کلید ذخیره‌شده استفاده می‌شود؛ برای تعویض، کلید تازه وارد کنید"
                  : ""
              }
            />
          </label>
          <details>
            <summary>اتصال اختیاری Cursor و تیم</summary>
            <label htmlFor="cursor-connect-key">
              کلید Cursor
              <input
                id="cursor-connect-key"
                type="password"
                autoComplete="off"
                value={cursorKey}
                onChange={(e) => setCursorKey(e.target.value)}
                dir="ltr"
              />
            </label>
            <label htmlFor="liara-team-id">
              شناسهٔ تیم، اگر حساب تیمی دارید
              <input
                id="liara-team-id"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                dir="ltr"
              />
            </label>
          </details>
          <div className="wizard-buttons">
            <button className="button primary" disabled={busy}>
              <KeyRound size={17} />
              {busy ? "در حال بررسی اتصال…" : "بررسی و ذخیرهٔ اتصال"}
            </button>
            {state.mode === "live" && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void connect("demo")}
              >
                بازگشت به حالت نمایشی
              </button>
            )}
          </div>
        </form>
      )}
      {!active && !quote && (
        <>
          <h3>فقط چند انتخاب ساده مانده.</h3>
          <p className="provision-intro">
            نام سایت و نیازهای پیشنهادی را ببینید. همراه دیتابیس‌ها را می‌سازد،
            رمز اتصال را دریافت می‌کند و تنظیمات برنامه را خودش انجام می‌دهد.
          </p>
          {loading ? (
            <p role="status">
              <LoaderCircle className="spin" size={18} /> در حال دریافت پلن‌ها و
              هزینه‌ها…
            </p>
          ) : (
            catalog && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void prepare();
                }}
              >
                <fieldset className="intake-fields" disabled={busy}>
                  <label htmlFor="cloud-app-name">
                    نام سایت شما{" "}
                    <input
                      id="cloud-app-name"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value.toLowerCase())}
                      dir="ltr"
                      pattern="[a-z][a-z0-9-]{2,39}"
                      required
                      minLength={3}
                      maxLength={40}
                      aria-describedby="cloud-name-help"
                    />
                    <small id="cloud-name-help">
                      حروف انگلیسی، عدد و خط تیره؛ آدرس اولیه:{" "}
                      <bdi>{appName}.liara.run</bdi>
                    </small>
                  </label>
                  <label htmlFor="cloud-app-plan">
                    اندازهٔ شروع سایت
                    <select
                      id="cloud-app-plan"
                      value={appPlan}
                      onChange={(e) => setAppPlan(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        پلن را انتخاب کنید
                      </option>
                      {catalog.appPlans.map((p, i) => (
                        <option key={p.id} value={p.id}>
                          {i === 0 ? "شروع اقتصادی · " : ""}
                          {p.label} · حدود {money(p.monthly)} تومان در ماه
                        </option>
                      ))}
                    </select>
                  </label>
                  {!!databases.length && (
                    <div className="provision-db-list">
                      <div className="provision-section-title">
                        <Database size={19} />
                        <h3>فضای اطلاعات و اتصال‌ها</h3>
                      </div>
                      {databases.map((d, i) => (
                        <div className="provision-db" key={i}>
                          <div className="provision-db-heading">
                            <strong>{labels[d.type]}</strong>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`حذف ${labels[d.type]} از پیشنهاد`}
                              onClick={() => {
                                setDatabases((current) =>
                                  current.filter((_, index) => index !== i),
                                );
                                setBindings({});
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div className="provision-db-grid">
                            <label htmlFor={`db-name-${i}`}>
                              نام سرویس
                              <input
                                id={`db-name-${i}`}
                                value={d.name}
                                onChange={(e) =>
                                  changeDb(i, {
                                    name: e.target.value.toLowerCase(),
                                  })
                                }
                                dir="ltr"
                                pattern="[a-z][a-z0-9-]{2,39}"
                                required
                              />
                            </label>
                            <label htmlFor={`db-plan-${i}`}>
                              اندازهٔ پیشنهادی
                              <select
                                id={`db-plan-${i}`}
                                value={d.plan}
                                required
                                onChange={(e) =>
                                  changeDb(i, { plan: e.target.value })
                                }
                              >
                                <option value="" disabled>
                                  پلن در دسترس را انتخاب کنید
                                </option>
                                {catalog.databasePlans
                                  .filter((p) => p.supports.includes(d.type))
                                  .map((p) => (
                                    <option value={p.id} key={p.id}>
                                      {p.label} · {money(p.monthly)} تومان در
                                      ماه
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </div>
                          <details>
                            <summary>نسخهٔ دیتابیس</summary>
                            <label htmlFor={`db-version-${i}`}>
                              نسخه
                              <select
                                id={`db-version-${i}`}
                                value={d.version}
                                required
                                onChange={(e) =>
                                  changeDb(i, { version: e.target.value })
                                }
                              >
                                {(catalog.versions[d.type] || []).map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </details>
                          <small>
                            <ShieldCheck size={13} /> دیتابیس عمومی نمی‌شود؛ فقط
                            در شبکهٔ خصوصی همین پروژه قرار می‌گیرد.
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                  {databases.length < 4 && (
                    <details className="intake-advanced">
                      <summary>نیاز به دیتابیس یا کش دیگری دارید؟</summary>
                      <div className="provision-add-db">
                        {(Object.keys(labels) as DatabaseType[]).map((type) => (
                          <button
                            type="button"
                            key={type}
                            className="button secondary"
                            onClick={() => {
                              const d = {
                                type,
                                name: `${appName.slice(0, 25)}-${type}-${databases.length + 1}`,
                                plan:
                                  catalog.databasePlans.find((p) =>
                                    p.supports.includes(type),
                                  )?.id || "",
                                version: catalog.versions[type]?.[0] || "",
                                bindings: {},
                              };
                              setDatabases((current) => [...current, d]);
                            }}
                          >
                            <Plus size={14} />
                            {labels[type]}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                  {!!report.envNames.length && (
                    <section className="provision-env">
                      <div className="provision-section-title">
                        <KeyRound size={19} />
                        <h3>تنظیمات موردنیاز پروژه</h3>
                      </div>
                      <p>
                        اتصال‌های دیتابیس خودکار پر می‌شوند. فقط اطلاعات
                        سرویس‌های دیگر را وارد کنید.
                      </p>
                      {report.envNames.map((n) => (
                        <div className="provision-env-field" key={n}>
                          <label htmlFor={`env-source-${n}`}>
                            <bdi>{n}</bdi>
                            <select
                              id={`env-source-${n}`}
                              value={bindings[n] || "manual"}
                              onChange={(e) =>
                                setBindings((current) => ({
                                  ...current,
                                  [n]: e.target.value,
                                }))
                              }
                            >
                              <option value="manual">
                                خودم مقدارش را وارد می‌کنم
                              </option>
                              {!/^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(n) &&
                                databases.flatMap((d, i) =>
                                  Object.entries(partLabels).map(
                                    ([part, label]) => (
                                      <option
                                        key={`${i}:${part}`}
                                        value={`${i}:${part}`}
                                      >
                                        {labels[d.type]} · {label}
                                      </option>
                                    ),
                                  ),
                                )}
                            </select>
                          </label>
                          {!bindings[n] || bindings[n] === "manual" ? (
                            <label htmlFor={`env-value-${n}`}>
                              <span className="sr-only">مقدار {n}</span>
                              <input
                                id={`env-value-${n}`}
                                type="password"
                                dir="ltr"
                                autoComplete="off"
                                required
                                value={env[n] || ""}
                                onChange={(e) =>
                                  setEnv((current) => ({
                                    ...current,
                                    [n]: e.target.value,
                                  }))
                                }
                              />
                              <small>
                                {envHelp(n)}
                                {/^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(n) &&
                                  " این متغیر در مرورگر کاربران قابل مشاهده است؛ رمز محرمانه وارد نکنید."}
                              </small>
                            </label>
                          ) : (
                            <div className="provision-auto">
                              <CheckCircle2 size={16} /> همراه بعد از ساخت سرویس
                              این مقدار را امن وارد می‌کند.
                            </div>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                  <details className="intake-advanced">
                    <summary>تنظیمات بیشتر، در صورت نیاز</summary>
                    <label htmlFor="cloud-network">
                      شبکهٔ خصوصی
                      <select
                        id="cloud-network"
                        value={networkId}
                        onChange={(e) => setNetworkId(e.target.value)}
                      >
                        <option value="">ساخت شبکهٔ مخصوص همین پروژه</option>
                        {catalog.networks.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label htmlFor="cloud-health">
                      مسیر بررسی بازبودن سایت
                      <input
                        id="cloud-health"
                        value={healthPath}
                        onChange={(e) => setHealthPath(e.target.value)}
                        dir="ltr"
                        required
                      />
                      <small>
                        پیش‌فرض از کد پروژه تشخیص داده می‌شود؛ در غیر این صورت
                        صفحهٔ اصلی بررسی می‌شود.
                      </small>
                    </label>
                    <label htmlFor="cloud-business">
                      مسیر آزمایش عملیات اصلی، اگر در پروژه دارید
                      <input
                        id="cloud-business"
                        value={businessPath}
                        onChange={(e) => setBusinessPath(e.target.value)}
                        dir="ltr"
                        placeholder="/api/checkout/check"
                      />
                      <small>
                        اختیاری؛ باید آزمایش امن و بدون اثر دائمی انجام دهد و
                        JSON شامل ok: true برگرداند. بدون آن، فقط انتشار و پاسخ
                        سایت تأیید می‌شود.
                      </small>
                    </label>
                    {extra.map((row, i) => (
                      <div className="provision-extra" key={i}>
                        <label htmlFor={`extra-name-${i}`}>
                          نام تنظیم
                          <input
                            id={`extra-name-${i}`}
                            dir="ltr"
                            value={row.name}
                            onChange={(e) =>
                              setExtra((rows) =>
                                rows.map((r, j) =>
                                  j === i ? { ...r, name: e.target.value } : r,
                                ),
                              )
                            }
                            required
                            pattern="[A-Z][A-Z0-9_]{0,79}"
                          />
                        </label>
                        <label htmlFor={`extra-value-${i}`}>
                          مقدار
                          <input
                            id={`extra-value-${i}`}
                            type="password"
                            dir="ltr"
                            autoComplete="off"
                            value={row.value}
                            onChange={(e) =>
                              setExtra((rows) =>
                                rows.map((r, j) =>
                                  j === i ? { ...r, value: e.target.value } : r,
                                ),
                              )
                            }
                            required
                          />
                        </label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`حذف تنظیم اضافی ${i + 1}`}
                          onClick={() =>
                            setExtra((rows) => rows.filter((_, j) => i !== j))
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setExtra((rows) => [...rows, { name: "", value: "" }])
                      }
                    >
                      <Plus size={15} /> افزودن تنظیم دیگر
                    </button>
                  </details>
                </fieldset>
                <div className="notice-banner">
                  <ShieldCheck size={18} />
                  <span>
                    تا زمانی که هزینه و مراحل را در صفحهٔ بعد تأیید نکنید، هیچ
                    سرویسی ساخته و هیچ هزینه‌ای ایجاد نمی‌شود.
                  </span>
                </div>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || !appPlan}
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowLeft size={17} />
                  )}{" "}
                  هزینه و مراحل را ببینم
                </button>
              </form>
            )
          )}
        </>
      )}
      {quote && (
        <section
          className="provision-review"
          aria-labelledby="provision-review-title"
        >
          <span className="eyebrow">پیش از هر هزینه، تصمیم با شماست</span>
          <h3 id="provision-review-title" ref={reviewHeading} tabIndex={-1}>
            {quote.mode === "demo"
              ? "مرور یک راه‌اندازی نمایشی"
              : "این زیرساخت را برایتان می‌سازم"}
          </h3>
          <div className="provision-price">
            {quote.items.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{money(item.monthly / 720)} تومان / ساعت</strong>
              </div>
            ))}
            <div className="provision-price-total">
              <span>برآورد هر ساعت استفاده</span>
              <strong>
                {money(quote.monthly / 720)} <small>تومان / ساعت</small>
              </strong>
            </div>
          </div>
          <p className="provision-price-note">
            برآورد یک روز: {money(quote.monthly / 30)} تومان · ۳۰ روز:{" "}
            {money(quote.monthly)} تومان. این اعداد پیش‌پرداخت یک ماه نیستند؛
            سرویس تا زمان حذف یا تغییر وضعیت می‌تواند هزینه داشته باشد.
          </p>
          <p className="provision-price-note">
            {quote.mode === "demo"
              ? "این اعداد نمونه‌اند و تعرفهٔ واقعی لیارا نیستند؛ هیچ مبلغی پرداخت نمی‌شود."
              : "منبع تعرفه: حساب فعلی شما در لیارا؛ منابع و بستهٔ امکانات با هم محاسبه شده‌اند. نرخ ساعتی از برآورد ۷۲۰ ساعته به دست آمده است. مبلغ نهایی به زمان استفاده و هزینه‌های متغیر مثل ترافیک و مالیات بستگی دارد. مصرف از اعتبار حساب لیارا خواهد بود؛ پرداخت بانکی خودکار انجام نمی‌شود."}
          </p>
          <ol className="provision-review-steps">
            {quote.steps.map((s) => (
              <li key={s.key}>
                <Check size={15} />
                {s.label}
              </li>
            ))}
          </ol>
          <p>
            نام تنظیمات:{" "}
            <bdi>{quote.envNames.join("، ") || "تنظیم اضافی ندارد"}</bdi>؛
            مقادیر محرمانه نمایش داده نمی‌شوند.
          </p>
          <p className="provision-warning">
            اگر مرحله‌ای ناموفق شود، سرویس‌های ساخته‌شده خودکار حذف یا دوباره
            ساخته نمی‌شوند و ممکن است تا زمان توقف همچنان هزینه داشته باشند.
            ساخت برنامه شامل فعال‌شدن آدرس عمومی سایت است؛ دیتابیس‌ها خصوصی
            می‌مانند.
          </p>
          <label className="intake-ready">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              {quote.mode === "demo"
                ? "با اجرای پیش‌نمایش و شبیه‌سازی این مراحل موافقم."
                : "ساخت سرویس‌های بالا، تنظیم متغیرها، انتشار سورس و هزینهٔ برآوردی را تأیید می‌کنم."}
            </span>
          </label>
          <div className="wizard-buttons">
            <button
              className="button primary"
              disabled={!agreed || busy}
              onClick={() => void decision(true)}
            >
              <Rocket size={17} />
              {busy
                ? "در حال ثبت تأیید…"
                : quote.mode === "demo"
                  ? "تأیید و اجرای پیش‌نمایش"
                  : "تأیید هزینه و راه‌اندازی"}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void decision(false)}
            >
              انصراف؛ چیزی ساخته نشود
            </button>
          </div>
          <small>
            اعتبار پیشنهاد: ۱۰ دقیقه. تغییر تعرفه یا سورس، تأیید تازه می‌خواهد.
          </small>
        </section>
      )}
      {active && (
        <section className="provision-progress" aria-live="polite">
          <h3>
            {job.retiredAt
              ? "آزمون تمام شد؛ برنامه و دیتابیس آزمایشی حذف شدند"
              : job.status === "running"
                ? "همراه مشغول راه‌اندازی است…"
                : job.status === "completed"
                  ? job.mode === "demo"
                    ? "پیش‌نمایش راه‌اندازی کامل شد"
                    : "سایت شما آماده است"
                  : job.status === "needs_verification"
                    ? "سایت منتشر شد؛ بررسی عمیق‌تر باقی است"
                    : job.status === "rejected"
                      ? "با تصمیم شما اجرا نشد"
                      : "راه‌اندازی نیاز به بررسی دارد"}
          </h3>
          <ol>
            {job.steps.map((s) => (
              <li key={s.key} data-status={s.status}>
                <span>
                  {s.status === "running" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : s.status === "done" ? (
                    <CheckCircle2 size={17} />
                  ) : s.status === "failed" ? (
                    <Info size={17} />
                  ) : (
                    <span className="provision-waiting-dot" />
                  )}
                </span>
                <div>
                  <strong>{s.label}</strong>
                  {s.detail && <p>{s.detail}</p>}
                </div>
                <small>
                  {
                    {
                      waiting: "در نوبت",
                      running: "در حال انجام",
                      done: "انجام شد",
                      failed: "نیاز به بررسی",
                    }[s.status]
                  }
                </small>
              </li>
            ))}
          </ol>
          {job.verification && (
            <p className="provision-result">
              {job.retiredAt ? "تأیید ثبت‌شده هنگام آزمون: " : ""}
              {job.verification}
            </p>
          )}
          {job.error && (
            <p className="inline-error" role="alert">
              {job.error}
            </p>
          )}
          {job.nextStep && <p className="provision-warning">{job.nextStep}</p>}
          {job.releaseId && !job.retiredAt && (
            <div className="wizard-buttons">
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api<{ text: string }>(
                      `/provision/${job.id}/build-logs`,
                      undefined,
                      "GET",
                    );
                    setLogs(result.text);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                دیدن لاگ ساخت نسخه
              </button>
              {job.status === "failed" && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/provision/${job.id}/recheck`, {});
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  بررسی دوبارهٔ نتیجه؛ بدون انتشار مجدد
                </button>
              )}
            </div>
          )}
          {job.status === "failed" &&
            job.errorCode === "source_rejected" &&
            !job.releaseId &&
            job.steps.find((s) => s.status === "failed")?.key === "deploy" &&
            job.steps.find((s) => s.key === "env")?.status === "done" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const fresh = await api<ProvisionJob>(
                      `/provision/${job.id}/continue`,
                      {},
                    );
                    setSelectedJob(fresh.id);
                    setQuote(fresh);
                    setAgreed(false);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ادامه از انتشار؛ بدون ساخت مجدد
              </button>
            )}
          {job.status === "failed" &&
            (job.errorCode === "payment_required" ||
              job.error?.includes("HTTP 402")) &&
            !job.resources.some((r) => r.kind !== "network") && (
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const fresh = await api<ProvisionJob>(
                      `/provision/${job.id}/requote`,
                      {},
                    );
                    setSelectedJob(fresh.id);
                    setQuote(fresh);
                    setAgreed(false);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={17} />
                بررسی دوبارهٔ هزینه پس از شارژ
              </button>
            )}
          {!job.retiredAt && job.resources.some((r) => r.kind === "app") && (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const data = await api<{ text: string }>(
                      `/provision/${job.id}/logs`,
                      undefined,
                      "GET",
                    );
                    setLogs(data.text);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                بررسی لاگ همین برنامه
              </button>
              {logs && (
                <pre className="provision-logs" dir="ltr">
                  {logs}
                </pre>
              )}
            </>
          )}
          {job.url && !job.retiredAt && (
            <a
              className="button primary"
              href={job.url}
              rel="noreferrer"
              target="_blank"
            >
              دیدن سایت <ArrowLeft size={17} />
            </a>
          )}
          {!!job.resources.length && (
            <details>
              <summary>سرویس‌ها و شناسه‌های ثبت‌شده</summary>
              <ul>
                {job.resources.map((r) => (
                  <li key={r.id}>
                    <bdi>{r.name}</bdi> · {r.kind} · <code>{r.id}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {job.status !== "running" && (
            <button
              className="text-button"
              onClick={() => {
                setSelectedJob("");
                setQuote(null);
              }}
            >
              بازگشت به تنظیمات
            </button>
          )}
        </section>
      )}
      {!loading && !catalog && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void loadCatalog()}
        >
          <RefreshCw size={16} />
          دریافت دوبارهٔ پلن‌ها
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {jobs.length > 0 && !quote && (
        <details className="provision-history">
          <summary>
            تاریخچهٔ راه‌اندازی‌های این پروژه ({fa(jobs.length)})
          </summary>
          {jobs.map((j) => (
            <button
              className="text-button"
              key={j.id}
              onClick={() => {
                setSelectedJob(j.id);
                if (j.status === "pending") {
                  setQuote(j);
                  setAgreed(false);
                }
              }}
            >
              <bdi>{j.appName}</bdi> ·{" "}
              {j.status === "completed"
                ? "تکمیل‌شده"
                : j.status === "running"
                  ? "در حال اجرا"
                  : j.status === "pending"
                    ? "منتظر تأیید"
                    : "نیاز به بررسی"}
            </button>
          ))}
        </details>
      )}
    </div>
  );
}
