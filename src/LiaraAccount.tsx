import { useEffect, useState } from "react";
import { api } from "./lib";
export default function LiaraAccount({
  teamId,
  enabled,
}: {
  teamId?: string;
  enabled: boolean;
}) {
  const [data, setData] = useState<{
    accounts: { id: string; name: string; balance: number | null }[];
  } | null>(null);
  const [selected, setSelected] = useState(teamId || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (enabled)
      void api<typeof data>("/connection/accounts", undefined, "GET")
        .then(setData)
        .catch((e) => setError(e.message));
  }, [enabled, teamId]);
  useEffect(() => setSelected(teamId || ""), [teamId]);
  if (!enabled) return null;
  return (
    <form
      className="intake-config intake-fields"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api("/connection", { mode: "live", teamId: selected });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        هزینه از کدام حساب پرداخت شود؟
        <select
          value={selected}
          disabled={busy || !data}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} —{" "}
              {a.balance === null
                ? "موجودی نامشخص"
                : Math.floor(a.balance).toLocaleString("fa-IR") + " تومان"}
            </option>
          ))}
        </select>
      </label>
      <p>
        اعتبار تیم و حساب شخصی جداست. پیشنهادهای قبلی پس از تغییر حساب، اجازهٔ
        هزینه‌کرد ندارند.
      </p>
      <button
        className="button secondary"
        disabled={busy || !data || selected === (teamId || "")}
      >
        {busy ? "در حال بررسی حساب…" : "انتخاب این حساب"}
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </form>
  );
}
