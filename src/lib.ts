import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const fa = (n: number | string) =>
  typeof n === "number"
    ? new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(n)
    : n.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
export const time = (at: string) => {
  if (!at || Number.isNaN(Date.parse(at))) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(new Date(at));
};
export const date = (at: string) => {
  if (!at || Number.isNaN(Date.parse(at))) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Tehran",
  }).format(new Date(at));
};
export async function api<T = unknown>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Hamrah-Client": "dashboard",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "ارتباط با همراه برقرار نشد.");
  return data;
}
