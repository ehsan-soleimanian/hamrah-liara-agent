import { createHash, timingSafeEqual } from "node:crypto";
const runtimeSecrets = new Set<string>();
export function registerSecrets(values: string[]) {
  for (const value of values) if (value.length > 3) runtimeSecrets.add(value);
}
export function redact(value: unknown): string {
  let text =
    (typeof value === "string"
      ? value
      : JSON.stringify(value, (key, val) =>
          /password|secret|token|authorization|envs|credential/i.test(key)
            ? "[REDACTED]"
            : val,
        )) || "";
  for (const key of [
    "LIARA_API_TOKEN",
    "CURSOR_API_KEY",
    "DASHBOARD_PASSWORD",
    "DEMO_CONTROL_TOKEN",
  ]) {
    const secret = process.env[key];
    if (secret && secret.length > 5)
      text = text.split(secret).join("[REDACTED]");
  }
  for (const value of runtimeSecrets)
    text = text.split(value).join("[REDACTED]");
  return text
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(
      /((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(\w+:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
    .slice(0, 24000);
}
export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function secureEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
