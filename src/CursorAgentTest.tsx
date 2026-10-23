import { useState } from "react";
import { Activity, LoaderCircle } from "lucide-react";
import { api, time } from "./lib";
import type { Snapshot } from "./types";
export default function CursorAgentTest({
  configured,
  status,
}: {
  configured: boolean;
  status?: Snapshot["connections"]["cursorStatus"];
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ ok: boolean; message: string } | null>(
      null,
    );
  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ message: string; checkedAt: string }>(
        "/settings/cursor/agent-test",
        {},
      );
      setResult({ ok: true, message: `${r.message} · ${time(r.checkedAt)}` });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cursor-runtime-test">
      <h3>آیا خود ایجنت واقعاً کار می‌کند؟</h3>
      <p>
        این آزمایش با کلید ذخیره‌شده، مدل Cursor و یک ابزار بی‌خطر را اجرا
        می‌کند؛ مصرف مدل دارد و زیرساختی را تغییر نمی‌دهد.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={!configured || busy}
        onClick={() => void test()}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Activity size={17} />
        )}{" "}
        {busy ? "در حال اجرای واقعی مدل و ابزار…" : "آزمایش واقعی ایجنت Cursor"}
      </button>
      <p
        role="status"
        className={
          (result?.ok ?? status?.ok) ? "liara-key-status" : "liara-key-error"
        }
      >
        {busy
          ? "منتظر پاسخ مدل و فراخوانی ابزار هستیم."
          : result?.message ||
            (status
              ? `${status.ok ? "آخرین اجرای مدل موفق بود." : status.message} · ${time(status.checkedAt)}`
              : "ذخیره‌شدن کلید، به‌معنی تأیید اجرای ایجنت نیست.")}
      </p>
    </section>
  );
}
