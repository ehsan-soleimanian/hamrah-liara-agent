export type ConnectionProvider = "liara" | "cursor";
import { liaraFetch } from "./liara-transport.ts";
import { cursorFailure } from "./cursor-errors.ts";
import { config } from "./config.ts";
import { configureCursorNetwork, cursorProxyFetch } from "./cursor-network.ts";

export class ConnectionTestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Account metadata only: no agent, model inference, or cloud mutation.
export async function testConnection(
  provider: ConnectionProvider,
  token: string,
  teamId = "",
  request: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  const label = provider === "liara" ? "لیارا" : "Cursor";
  if (!token)
    throw new ConnectionTestError(
      `ابتدا کلید ${label} را وارد یا ذخیره کنید.`,
      400,
    );
  let response: Response;
  let data: unknown;
  try {
    if (provider === "cursor" && request === fetch && config.cursorProxyUrl)
      configureCursorNetwork(config.cursorProxyUrl);
    response = await (
      provider === "liara" && request === fetch ? liaraFetch : provider === "cursor" && request === fetch && config.cursorProxyUrl ? cursorProxyFetch : request
    )(
      provider === "liara"
        ? `https://api.liara.ir/v1/projects${teamId ? `?teamID=${encodeURIComponent(teamId)}` : ""}`
        : "https://api.cursor.com/v1/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      // Never reflect an upstream body: it may contain credentials or account data.
      if (response.status === 401)
        throw new ConnectionTestError(
          `کلید ${label} پذیرفته نشد؛ کلید اشتباه، منقضی یا لغو شده است.`,
          422,
        );
      if (response.status === 403 && provider === "cursor") {
        const failure = cursorFailure(
          new Error((await response.text()).slice(0, 4096)),
        );
        if (failure.code === "region_blocked")
          throw new ConnectionTestError(failure.message, failure.httpStatus);
      }
      if (response.status === 403)
        throw new ConnectionTestError(
          `دسترسی این کلید در ${label} کافی نیست؛ مجوزهای حساب${provider === "liara" ? " و تیم" : ""} را بررسی کنید.`,
          422,
        );
      if (response.status === 429)
        throw new ConnectionTestError(
          `محدودیت درخواست‌های ${label} فعال است؛ کمی بعد دوباره تست کنید.`,
          429,
        );
      throw new ConnectionTestError(
        `سرویس ${label} پاسخ موفق نداد (HTTP ${response.status})؛ کمی بعد دوباره تست کنید.`,
        502,
      );
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ConnectionTestError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      throw new ConnectionTestError(
        `پاسخ ${label} در مهلت ۱۵ ثانیه دریافت نشد؛ اتصال شبکه را بررسی و دوباره تست کنید.`,
        504,
      );
    if (error instanceof SyntaxError)
      throw new ConnectionTestError(
        `پاسخ ${label} قابل تأیید نیست؛ دوباره تست کنید.`,
        502,
      );
    throw new ConnectionTestError(
      `ارتباط با ${label} برقرار نشد؛ اینترنت سرور و دسترسی شبکه را بررسی کنید.`,
      502,
    );
  }
  const valid =
    typeof data === "object" &&
    data !== null &&
    (provider === "liara"
      ? Array.isArray((data as { projects?: unknown }).projects)
      : typeof (data as { apiKeyName?: unknown }).apiKeyName === "string" &&
        typeof (data as { createdAt?: unknown }).createdAt === "string");
  if (!valid)
    throw new ConnectionTestError(
      `پاسخ ${label} با قالب مورد انتظار هم‌خوانی ندارد؛ اتصال تأیید نشد.`,
      502,
    );
  return {
    ok: true as const,
    checkedAt: new Date().toISOString(),
    message: `کلید ${label} معتبر است و اتصال برقرار شد.`,
  };
}
