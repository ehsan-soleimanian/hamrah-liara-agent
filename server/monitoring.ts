import { randomUUID } from "node:crypto";
import type {
  MonitorPolicy,
  ResourceSample,
  Hypothesis,
} from "../src/monitoring-types.ts";
export const defaultMonitorPolicy: MonitorPolicy = {
  cpuPercent: 80,
  memoryPercent: 85,
  latencyMs: 1500,
  consecutive: 3,
  cpuUnit: "unknown",
  memoryUnit: "unknown",
};

// The public summary schema defines timestamp/value pairs but no units.
// Never infer units from a value's magnitude; the operator explicitly selects them.
export function normalizeMetrics(
  raw: any,
  capacity: { cpu?: number; ram?: number },
  policy: MonitorPolicy,
  now = Date.now(),
  maxAgeMs = 180000,
) {
  const errors: string[] = [];
  function metric(key: string, unit: string, limit?: number) {
    if (unit === "unknown") {
      errors.push(`${key}: واحد داده مشخص نشده است`);
      return undefined;
    }
    if (!Array.isArray(raw?.[key]) || !raw[key].length) {
      errors.push(`${key}: داده موجود نیست`);
      return undefined;
    }
    const values: number[] = [];
    for (const point of raw[key]) {
      const pair = point?.value;
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((v) => v === "" || v === null || typeof v === "boolean")
      ) {
        errors.push(`${key}: قالب نامعتبر`);
        return undefined;
      }
      const stamp = Number(pair[0]) * 1000,
        value = Number(pair[1]);
      if (
        !Number.isFinite(stamp) ||
        now - stamp > maxAgeMs ||
        stamp > now + 30000 ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        errors.push(`${key}: داده قدیمی یا نامعتبر`);
        return undefined;
      }
      let percent = value;
      if (unit !== "percent") {
        if (!limit || !Number.isFinite(limit)) {
          errors.push(`${key}: ظرفیت پلن قابل تأیید نیست`);
          return undefined;
        }
        percent =
          (value /
            (unit === "nanocores" ? 1e9 : unit === "bytes" ? 1024 ** 3 : 1) /
            limit) *
          100;
      }
      values.push(percent);
    }
    // Alert on the busiest replica; averaging can hide a saturated replica.
    return Math.round(Math.max(...values) * 10) / 10;
  }
  const cpuPercent = metric("cpuUsage", policy.cpuUnit, capacity.cpu);
  const memoryPercent = metric("memoryUsage", policy.memoryUnit, capacity.ram);
  return {
    cpuPercent,
    memoryPercent,
    metricsError: errors.length ? errors.join("؛ ") : undefined,
  };
}
export function makeSample(
  scope: string,
  source: "demo" | "live",
  healthy: boolean,
  latencyMs?: number,
): ResourceSample {
  return {
    id: randomUUID(),
    scope,
    source,
    at: new Date().toISOString(),
    healthy,
    latencyMs,
  };
}
export function breaches(s: ResourceSample, p: MonitorPolicy): string[] {
  return [
    s.cpuPercent !== undefined && s.cpuPercent >= p.cpuPercent && "CPU",
    s.memoryPercent !== undefined &&
      s.memoryPercent >= p.memoryPercent &&
      "RAM",
    s.latencyMs !== undefined && s.latencyMs >= p.latencyMs && "کندی",
  ].filter(Boolean) as string[];
}
export function sustained(
  samples: ResourceSample[],
  p: MonitorPolicy,
  intervalMs: number,
): string[] {
  const recent = samples.slice(-p.consecutive);
  if (
    recent.length < p.consecutive ||
    Date.now() - Date.parse(recent.at(-1)!.at) > intervalMs * 3 ||
    recent.some(
      (s, i) =>
        i > 0 &&
        Date.parse(s.at) - Date.parse(recent[i - 1].at) > intervalMs * 3,
    )
  )
    return [];
  return breaches(recent[0], p).filter((key) =>
    recent.every((s) => breaches(s, p).includes(key)),
  );
}
export function p95(samples: ResourceSample[]) {
  const values = samples
    .slice(-20)
    .map((s) => s.latencyMs)
    .filter((v): v is number => v !== undefined && Number.isFinite(v))
    .sort((a, b) => a - b);
  return values.length >= 5
    ? values[Math.ceil(values.length * 0.95) - 1]
    : undefined;
}
export function diagnose(
  sample: ResourceSample | undefined,
  logs: string,
  policy: MonitorPolicy,
): Hypothesis[] {
  const result: Hypothesis[] = [];
  if (/out of memory|heap out of memory|oomkill|oom-kill/i.test(logs))
    result.push({
      cause: "کمبود حافظه یا نشت حافظه",
      confidence: "high",
      evidence: ["نشانهٔ اتمام حافظه در لاگ"],
      next: "مصرف حافظه و رشد آن را بررسی کنید؛ افزایش RAM موقتاً کمک می‌کند، اما نشت حافظه به اصلاح کد نیاز دارد.",
    });
  if (
    sample?.memoryPercent !== undefined &&
    sample.memoryPercent >= policy.memoryPercent
  )
    result.push({
      cause: "فشار حافظه",
      confidence: "medium",
      evidence: [`RAM: ${sample.memoryPercent}%`],
      next: "مصرف پایدار را بررسی کنید؛ در صورت نیاز پلن با RAM بیشتر را برای تأیید انتخاب کنید.",
    });
  if (
    sample?.cpuPercent !== undefined &&
    sample.cpuPercent >= policy.cpuPercent
  )
    result.push({
      cause: "اشباع پردازنده",
      confidence: "medium",
      evidence: [`CPU: ${sample.cpuPercent}%`],
      next: "بار درخواست و کارهای سنگین را بررسی کنید؛ افزایش CPU نیازمند تأیید هزینه است.",
    });
  if (
    /connection pool exhausted|too many connections|ECONNREFUSED|ETIMEDOUT|database.*timeout/i.test(
      logs,
    )
  )
    result.push({
      cause: "اتصال دیتابیس یا سرویس وابسته",
      confidence: "medium",
      evidence: ["خطای اتصال یا مهلت انتظار در لاگ"],
      next: "وضعیت دیتابیس، سقف اتصال و تنظیمات اتصال را بررسی کنید؛ افزایش منابع برنامه الزاماً این مشکل را حل نمی‌کند.",
    });
  if (
    /TypeError|ReferenceError|SyntaxError|uncaught|unhandled rejection/i.test(
      logs,
    )
  )
    result.push({
      cause: "خطای کد برنامه",
      confidence: "medium",
      evidence: ["استثنای برنامه در لاگ"],
      next: "stack trace و آخرین انتشار را بررسی و نسخهٔ اصلاح‌شده را با تأیید منتشر کنید.",
    });
  if (sample?.latencyMs !== undefined && sample.latencyMs >= policy.latencyMs)
    result.push({
      cause: "پاسخ کند برنامه یا وابستگی‌ها",
      confidence: "low",
      evidence: [`زمان پاسخ سلامت از محل سرور همراه: ${sample.latencyMs} ms`],
      next: "زمان کوئری، سرویس‌های بیرونی و مسیر شبکه را بررسی کنید؛ این اندازه‌گیری زمان همهٔ کاربران نیست.",
    });
  if (!result.length)
    result.push({
      cause: "علت هنوز مشخص نیست",
      confidence: "low",
      evidence: [
        sample?.metricsError || "شواهد کافی برای تعیین علت وجود ندارد",
      ],
      next: "لاگ تازه، وضعیت انتشار و متریک معتبر را دریافت کنید؛ تغییری بدون شواهد پیشنهاد نمی‌شود.",
    });
  return result.sort(
    (a, b) =>
      ["high", "medium", "low"].indexOf(a.confidence) -
      ["high", "medium", "low"].indexOf(b.confidence),
  );
}
