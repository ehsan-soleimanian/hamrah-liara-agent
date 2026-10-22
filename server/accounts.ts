import { Liara } from "./liara.ts";
import { config } from "./config.ts";
import { liaraFetch } from "./liara-transport.ts";
export async function accountChoices() {
  const personal = new Liara(undefined, liaraFetch, "");
  const [teams, billing] = await Promise.all([
    personal.call("/v2/teams"),
    personal.call("/v1/billing"),
  ]);
  if (!Array.isArray(teams.teams))
    throw new Error("فهرست تیم‌ها قابل تأیید نیست.");
  const choices = [
    {
      id: "",
      name: "حساب شخصی",
      balance:
        typeof billing.user?.balance === "number" ? billing.user.balance : null,
    },
  ];
  for (const team of teams.teams.slice(0, 20)) {
    if (typeof team._id !== "string" || typeof team.name !== "string") continue;
    let balance: number | null = null;
    try {
      const b = await new Liara(undefined, liaraFetch, team._id).call(
        "/v1/billing",
      );
      if (typeof b.team?.balance === "number") balance = b.team.balance;
    } catch {
      /* Unknown balance must never become zero or another account's balance. */
    }
    choices.push({ id: team._id, name: team.name, balance });
  }
  return {
    selectedId: config.teamId,
    accounts: choices,
    checkedAt: new Date().toISOString(),
    currency: "تومان",
  };
}
