import { useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Settings2 } from "lucide-react";
import { api, fa, time } from "./lib";
import type { Action, Snapshot } from "./types";
import type { MonitorPolicy } from "./monitoring-types";
import type { CloudPlan } from "./provision-types";

type Options = {
  current: CloudPlan;
  plans: CloudPlan[];
  currency: string;
  target: string;
};
export default function MonitoringPanel({
  state,
  approve,
  online = true,
}: {
  state: Snapshot;
  approve: (action: Action) => void;
  online?: boolean;
}) {
  const monitoring = state.monitoring;
  const [policy, setPolicy] = useState<MonitorPolicy | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const changing = state.actions.find(
    (a) =>
      a.kind === "resize_app" &&
      a.target === state.managedAppId &&
      a.status !== "pending",
  );
  useEffect(() => {
    setOptions(null);
    setSelected("");
  }, [state.managedAppId, state.mode, changing?.id, changing?.status]);
  if (!monitoring) return null;
  const latest = monitoring.samples.at(-1);
  const stale =
    monitoring.stale ||
    !online ||
    !latest ||
    Date.now() - Date.parse(latest.at) >
      Math.max(20000, state.monitor.intervalMs * 3);
  const thresholds = policy || monitoring.policy;
  const change = <K extends keyof MonitorPolicy>(
    key: K,
    value: MonitorPolicy[K],
  ) => setPolicy({ ...thresholds, [key]: value });
  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel resource-monitor"
      aria-label="پایش منابع و زمان پاسخ"
    >
      <div className="care-summary-heading">
        <h2>
          <Activity size={18} /> منابع و زمان پاسخ
        </h2>
        <span>
          {state.mode === "demo"
            ? "CPU و RAM نمایشی · زمان پاسخ اندازه‌گیری‌شده"
            : "Liara · اندازه‌گیری از سرور همراه"}
        </span>
      </div>
      <div className="resource-readings">
        {[
          {
            label: "CPU",
            value: latest?.cpuPercent,
            unit: "٪",
            limit: monitoring.policy.cpuPercent,
          },
          {
            label: "RAM",
            value: latest?.memoryPercent,
            unit: "٪",
            limit: monitoring.policy.memoryPercent,
          },
          {
            label: "زمان پاسخ سلامت",
            value: latest?.latencyMs,
            unit: "ms",
            limit: monitoring.policy.latencyMs,
          },
        ].map((item) => (
          <div
            key={item.label}
            className={
              !stale && item.value !== undefined && item.value >= item.limit
                ? "resource-warning"
                : ""
            }
          >
            <span>{item.label}</span>
            <strong dir="ltr">
              {stale || item.value === undefined
                ? "—"
                : `${fa(item.value)} ${item.unit}`}
            </strong>
            <small>
              آستانه: {fa(item.limit)} {item.unit}
            </small>
          </div>
        ))}
      </div>
      <div className="resource-meta" role="status">
        <span>
          {stale
            ? "پایش متوقف است یا دادهٔ تازه نداریم"
            : `آخرین نمونه: ${time(latest!.at)}`}
        </span>
        <span>
          P95 زمان پاسخ:{" "}
          {monitoring.p95Ms === undefined
            ? "نیازمند حداقل ۵ نمونه"
            : `${fa(monitoring.p95Ms)} ms`}
        </span>
      </div>
      {latest?.metricsError && (
        <p className="resource-warning" role="status">
          CPU/RAM: {latest.metricsError}
        </p>
      )}
      <div className="resource-charts">
        <div role="img" aria-label="روند مصرف CPU و RAM به درصد">
          <span>CPU / RAM · درصد</span>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart
              data={monitoring.samples}
              margin={{ top: 10, right: 5, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#ffffff0b" />
              <XAxis hide dataKey="at" />
              <YAxis
                width={35}
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#aaa" }}
              />
              <Tooltip
                labelFormatter={(v) => time(String(v))}
                contentStyle={{
                  background: "#252527",
                  border: "1px solid #555",
                }}
              />
              <Area
                name="CPU %"
                dataKey="cpuPercent"
                stroke="#ddd"
                fill="#ffffff08"
                isAnimationActive={false}
              />
              <Area
                name="RAM %"
                dataKey="memoryPercent"
                stroke="#b3a5e0"
                fill="#b3a5e008"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div role="img" aria-label="روند زمان پاسخ سلامت به میلی‌ثانیه">
          <span>زمان پاسخ سلامت · ms</span>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart
              data={monitoring.samples}
              margin={{ top: 10, right: 5, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#ffffff0b" />
              <XAxis hide dataKey="at" />
              <YAxis width={45} tick={{ fontSize: 10, fill: "#aaa" }} />
              <Tooltip
                labelFormatter={(v) => time(String(v))}
                contentStyle={{
                  background: "#252527",
                  border: "1px solid #555",
                }}
              />
              <Area
                name="ms"
                dataKey="latencyMs"
                stroke="#ddd"
                fill="#ffffff08"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <details className="resource-controls">
        <summary>
          <Settings2 size={16} /> آستانه‌ها و واحد متریک
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await api("/settings", { resourcePolicy: thresholds }, "PATCH");
              setSaved(
                "تنظیمات ذخیره شد؛ هشدارها با نمونه‌های تازه بررسی می‌شوند.",
              );
              setPolicy(null);
            });
          }}
        >
          <div className="resource-fields">
            {(
              [
                ["cpuPercent", "آستانه CPU (%)", 1, 100],
                ["memoryPercent", "آستانه RAM (%)", 1, 100],
                ["latencyMs", "آستانه کندی (ms)", 100, 60000],
                ["consecutive", "تعداد بررسی پیاپی", 2, 10],
              ] as const
            ).map(([key, label, min, max]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={thresholds[key]}
                  onChange={(e) => change(key, Number(e.target.value))}
                />
              </label>
            ))}
            <label className="field">
              <span>واحد CPU در API</span>
              <select
                value={thresholds.cpuUnit}
                onChange={(e) =>
                  change("cpuUnit", e.target.value as MonitorPolicy["cpuUnit"])
                }
              >
                <option value="unknown">نامشخص</option>
                <option value="percent">درصد ظرفیت هر نمونه</option>
                <option value="cores">هسته (cores)</option>
                <option value="nanocores">نانو هسته (nanocores)</option>
              </select>
            </label>
            <label className="field">
              <span>واحد RAM در API</span>
              <select
                value={thresholds.memoryUnit}
                onChange={(e) =>
                  change(
                    "memoryUnit",
                    e.target.value as MonitorPolicy["memoryUnit"],
                  )
                }
              >
                <option value="unknown">نامشخص</option>
                <option value="percent">درصد ظرفیت هر نمونه</option>
                <option value="bytes">بایت (bytes)</option>
              </select>
            </label>
          </div>
          <p className="resource-meta">
            واحد را مطابق قرارداد دادهٔ حساب تنظیم کنید؛ API عمومی واحد را مشخص
            نکرده است. واحد نامشخص به درصد فرضی تبدیل نمی‌شود. زمان پاسخ از محل
            سرور همراه است.
          </p>
          <button className="button secondary" disabled={busy}>
            ذخیرهٔ آستانه‌ها
          </button>
        </form>
      </details>
      <div className="resource-resize">
        <button
          type="button"
          className="button secondary"
          disabled={busy || !state.connections.writable || !state.managedAppId}
          onClick={() =>
            void perform(async () => {
              const result = await api<Options>(
                "/resources/options",
                undefined,
                "GET",
              );
              setOptions(result);
              setSelected("");
            })
          }
        >
          بررسی تغییر منابع
        </button>
        {options && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const action = await api<Action>("/resources/quote", {
                  planId: selected,
                });
                approve(action);
              });
            }}
          >
            <p>
              منابع فعلی {options.target}: {fa(options.current.cpu)} CPU ·{" "}
              {fa(options.current.ram)} GB RAM · برآورد ماهانه{" "}
              {fa(options.current.monthly)} {options.currency}
            </p>
            <label className="field">
              <span>پلن جدید</span>
              <select
                required
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">انتخاب کنید</option>
                {options.plans
                  .filter((p) => p.id !== options.current.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {fa(p.monthly)} {options.currency} / ماه
                    </option>
                  ))}
              </select>
            </label>
            {!options.plans.some((p) => p.id !== options.current.id) && (
              <p>
                پلن سازگار دیگری با بستهٔ امکانات و فضای فعلی در دسترس نیست.
              </p>
            )}
            <button className="button primary" disabled={busy || !selected}>
              مشاهدهٔ هزینه و تأیید تغییر
            </button>
          </form>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      <details className="resource-controls">
        <summary>نمونه‌های ثبت‌شده</summary>
        <div className="resource-table">
          <table>
            <thead>
              <tr>
                <th>زمان</th>
                <th>CPU %</th>
                <th>RAM %</th>
                <th>پاسخ ms</th>
              </tr>
            </thead>
            <tbody>
              {monitoring.samples
                .slice(-20)
                .reverse()
                .map((s) => (
                  <tr key={s.id}>
                    <td>{time(s.at)}</td>
                    <td>
                      {s.cpuPercent === undefined ? "—" : fa(s.cpuPercent)}
                    </td>
                    <td>
                      {s.memoryPercent === undefined
                        ? "—"
                        : fa(s.memoryPercent)}
                    </td>
                    <td>{s.latencyMs === undefined ? "—" : fa(s.latencyMs)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
