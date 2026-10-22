import { Resolver } from "node:dns/promises";
import { config } from "./config.ts";
import { normalizeDomain } from "./domain-probe.ts";
export class LiaraDns {
  constructor(
    private request: typeof fetch = fetch,
    private resolveNs = async (name: string) => {
      const resolver = new Resolver({ timeout: 3000, tries: 1 });
      return resolver.resolveNs(name);
    },
  ) {}
  async call(endpoint: string, method = "GET", body?: unknown) {
    if (!/^\/zones(?:\/|\?|$)/.test(endpoint) || endpoint.includes(".."))
      throw Error("مسیر DNS مجاز نیست.");
    const url = new URL("https://dns-service.liara.ir/api/v1" + endpoint);
    if (
      url.origin !== "https://dns-service.liara.ir" ||
      !url.pathname.startsWith("/api/v1/zones")
    )
      throw Error("مقصد DNS مجاز نیست.");
    if (config.teamId) url.searchParams.set("teamID", config.teamId);
    const r = await this.request(url, {
      method,
      headers: {
        Authorization: "Bearer " + config.liaraToken,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw Error(
        "سرویس DNS لیارا درخواست را نپذیرفت (HTTP " + r.status + ").",
      );
    if (r.status === 204) return {};
    const result = await r.json();
    if (result.status === "error") throw Error("عملیات DNS لیارا تأیید نشد.");
    return result;
  }
  async zone(name: string) {
    const d = (await this.call("/zones/" + encodeURIComponent(name))).data;
    if (
      !d ||
      d.name !== name ||
      !Array.isArray(d.nameServers) ||
      d.nameServers.length < 2
    )
      throw Error("مشخصات و نیم‌سرورهای واقعی لیارا دریافت نشد.");
    return {
      id: name,
      name,
      nameservers: d.nameServers.map((x: string) => normalizeDomain(x)),
      status: String(d.status),
    };
  }
  async delegated(zone: { name: string; nameservers: string[] }) {
    // The check endpoint requests provider-side revalidation; it does not change DNS records.
    await this.call(
      "/zones/" + encodeURIComponent(zone.name) + "/check",
      "PUT",
    );
    const current = await this.zone(zone.name);
    const actual = (await this.resolveNs(zone.name))
      .map((x) => normalizeDomain(x))
      .sort();
    const expected = current.nameservers.slice().sort();
    return {
      zone: current,
      valid:
        current.status === "ACTIVE" &&
        actual.length === expected.length &&
        actual.every((x, i) => x === expected[i]),
    };
  }
  async records(name: string) {
    const d = (
      await this.call("/zones/" + encodeURIComponent(name) + "/dns-records")
    ).data;
    const rows = Array.isArray(d)
      ? d
      : Array.isArray(d?.records)
        ? d.records
        : undefined;
    if (!rows) throw Error("فهرست رکوردهای DNS لیارا قابل تأیید نیست.");
    return rows.map((r: any) => ({
      id: String(r.id || r._id || ""),
      type: String(r.type),
      name: String(r.name).replace(/\.$/, "").toLowerCase(),
      content:
        r.contents?.length === 1
          ? String(
              r.contents[0].host ??
                r.contents[0].text ??
                r.contents[0].ip ??
                "",
            )
          : "",
      multiple: (r.contents?.length || 0) > 1,
    }));
  }
}
