export type CursorFailureCode =
  | "region_blocked"
  | "invalid_key"
  | "forbidden"
  | "rate_limited"
  | "network"
  | "timeout"
  | "invalid_response"
  | "catalog_unavailable"
  | "unavailable";
export class CursorFailure extends Error {
  constructor(
    public code: CursorFailureCode,
    message: string,
    public httpStatus = 502,
  ) {
    super(message);
    this.name = "CursorFailure";
  }
}
export function cursorFailure(error: unknown): CursorFailure {
  if (error instanceof CursorFailure) return error;
  const text = error instanceof Error ? error.message : String(error);
  if (
    /not available in your region|unsupported.{0,20}(region|country)|region.{0,20}(not supported|blocked)/i.test(
      text,
    )
  )
    return new CursorFailure(
      "region_blocked",
      "Cursor دسترسی از منطقهٔ فعلی اتصال سرور را نمی‌پذیرد. اتصال مجاز از منطقهٔ پشتیبانی‌شده را فراهم کنید و دوباره بررسی کنید؛ تغییر کلید به‌تنهایی این خطا را رفع نمی‌کند.",
      403,
    );
  if (/unauthenticated|invalid.{0,10}(api.key|token)|401/i.test(text))
    return new CursorFailure(
      "invalid_key",
      "کلید Cursor پذیرفته نشد؛ کلید معتبر را در تنظیمات ذخیره کنید.",
      422,
    );
  if (/resource_exhausted|rate.limit|429/i.test(text))
    return new CursorFailure(
      "rate_limited",
      "محدودیت استفادهٔ Cursor فعال است؛ سهمیهٔ حساب را بررسی و کمی بعد دوباره تلاش کنید.",
      429,
    );
  if (/permission_denied|forbidden|403/i.test(text))
    return new CursorFailure(
      "forbidden",
      "حساب Cursor اجازهٔ اجرای ایجنت را نمی‌دهد؛ دسترسی و نوع کلید را بررسی کنید.",
      403,
    );
  if (/timed? ?out|timeout|deadline|cancelled|زمان مجاز/i.test(text))
    return new CursorFailure(
      "timeout",
      "بررسی Cursor در مهلت مقرر کامل نشد. سورس شما ذخیره است؛ بدون آپلود دوباره، بررسی را تکرار کنید.",
      504,
    );
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(text))
    return new CursorFailure(
      "network",
      "ارتباط سرور با Cursor برقرار نشد؛ اتصال شبکه را بررسی و دوباره تلاش کنید.",
      502,
    );
  return new CursorFailure(
    "unavailable",
    "اجرای Cursor کامل نشد. پروژه ذخیره است؛ اتصال واقعی ایجنت را در تنظیمات بررسی و تحلیل را دوباره اجرا کنید.",
    502,
  );
}
