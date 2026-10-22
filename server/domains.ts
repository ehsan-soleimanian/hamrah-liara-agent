import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.ts";
import { Store } from "./store.ts";
import { Vault } from "./vault.ts";
import { Liara } from "./liara.ts";
import { LiaraDns } from "./liara-dns.ts";
import { getDomain } from "tldts";
import { digest, registerSecrets } from "./security.ts";
import { domainProbe, normalizeDomain } from "./domain-probe.ts";
import type { DomainJob, DnsRecord, DnsChange } from "../src/domain-types.ts";
import type { ProvisionJob } from "../src/provision-types.ts";

const stamp = () => new Date().toISOString();
const inputSchema = z
  .object({
    jobId: z.string().uuid(),
    name: z.string().max(300),
    provider: z.enum(["liara", "manual", "cloudflare"]),
    cloudflareToken: z.string().trim().max(4096).optional(),
  })
  .strict();
export function requiredRecords(
  name: string,
  details: { target?: string; verificationCode?: string },
): DnsRecord[] {
  if (!details.target || !details.verificationCode)
    throw Error(
      "رکوردهای کامل از لیارا دریافت نشد؛ تغییری در DNS انجام نمی‌شود.",
    );
  const target = normalizeDomain(details.target);
  if (!/(^|\.)liara\.(cloud|ir|run|zone|site|space)$/.test(target))
    throw Error("مقصد DNS لیارا تأیید نشد؛ بررسی دستی لازم است.");
  return [
    { type: "CNAME", name, content: target },
    {
      type: "TXT",
      name: "liara-challenge." + name,
      content: details.verificationCode,
    },
    {
      type: "CNAME",
      name: "_acme-challenge." + name,
      content: name.replaceAll(".", "-") + "._acme-challenge.liara.cloud",
    },
  ];
}
export function dnsDiff(records: DnsRecord[], existing: any[]): DnsChange[] {
  return records.map((record) => {
    const relevant = existing.filter(
      (x) =>
        x.name.toLowerCase() === record.name &&
        (record.type === "ALIAS"
          ? ["A", "AAAA", "ALIAS", "CNAME"].includes(x.type)
          : record.type === "CNAME" ||
            x.type === "CNAME" ||
            x.type === "ALIAS" ||
            x.type === "TXT"),
    );
    if (
      relevant.some(
        (x) =>
          x.multiple ||
          !["A", "AAAA", "ALIAS", "CNAME", "TXT"].includes(x.type),
      ) ||
      (["CNAME", "ALIAS"].includes(record.type) &&
        relevant.some((x) => x.type === "TXT"))
    )
      throw Error(
        "رکورد دیگری روی همین نام وجود دارد؛ برای حفظ ایمیل یا تنظیمات فعلی، تغییر خودکار متوقف شد.",
      );
    const before = relevant.map(({ id, type, name, content, proxied }) => ({
      id,
      type,
      name,
      content,
      proxied,
    }));
    const same =
      before.length === 1 &&
      before[0].type === record.type &&
      before[0].content.replace(/\.$/, "") === record.content &&
      before[0].proxied !== true;
    return {
      record,
      action: same ? "keep" : before.length ? "replace" : "create",
      before,
    };
  });
}
export class Domains {
  busy = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private db: Store,
    private vault: Vault,
    private liara = new Liara(),
    private probe = domainProbe,
    private request: typeof fetch = fetch,
    private dns = new LiaraDns(),
  ) {
    for (const j of this.list())
      if (["attaching", "applying_dns"].includes(j.status)) {
        j.status = "attention";
        this.save(
          j,
          "سرور در میانهٔ تغییر بسته شد؛ نتیجه نامشخص است. بررسی مجدد فقط وضعیت را می‌خواند و تغییر را تکرار نمی‌کند.",
        );
      }
  }
  private scope() {
    return digest({
      mode: config.mode,
      team: config.teamId,
      token: config.liaraToken,
    });
  }
  list(jobId?: string) {
    return this.db
      .list<DomainJob>("domainJobs")
      .filter((j) => j.scope === this.scope() && (!jobId || j.jobId === jobId));
  }
  get(id: string) {
    const j = this.db.get<DomainJob>("domainJobs", id);
    if (!j || j.scope !== this.scope())
      throw Error("درخواست دامنه در این حساب پیدا نشد.");
    return j;
  }
  private deployment(j: Pick<DomainJob, "jobId" | "appName">) {
    const p = this.db.get<ProvisionJob>("provisionJobs", j.jobId);
    if (
      !p ||
      p.retiredAt ||
      p.status !== "completed" ||
      p.appName !== j.appName ||
      p.mode !== config.mode ||
      (config.mode === "live" && !config.allowedApps.includes(j.appName))
    )
      throw Error("ابتدا انتشار موفق و فعال همین برنامه را تأیید کنید.");
    return p;
  }
  private save(j: DomainJob, message?: string) {
    j.updatedAt = stamp();
    if (message) {
      j.message = message;
      j.events.push({ at: j.updatedAt, text: message });
      j.events = j.events.slice(-100);
      this.db.audit("domain", j.name, message);
    }
    this.db.put("domainJobs", j);
    return j;
  }
  private async locked<T>(f: () => Promise<T>) {
    if (this.busy) throw Error("بررسی دامنه در حال اجراست؛ کمی صبر کنید.");
    this.busy = true;
    try {
      return await f();
    } finally {
      this.busy = false;
    }
  }
  async plan(raw: unknown) {
    return this.locked(async () => {
      const input = inputSchema.parse(raw),
        name = normalizeDomain(input.name);
      const p = this.db.get<ProvisionJob>("provisionJobs", input.jobId);
      if (!p) throw Error("ابتدا برنامه را منتشر کنید.");
      this.deployment({ jobId: p.id, appName: p.appName });
      if (
        this.list().some(
          (x) =>
            x.name === name && !["cancelled", "attention"].includes(x.status),
        )
      )
        throw Error(
          "این دامنه قبلاً در جریان اتصال است؛ وضعیت همان درخواست را بررسی کنید.",
        );
      const createdAt = stamp();
      const j: DomainJob = {
        id: randomUUID(),
        jobId: p.id,
        appName: p.appName,
        name,
        mode: config.mode,
        provider: input.provider,
        status: "approval",
        createdAt,
        updatedAt: createdAt,
        scope: this.scope(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        fingerprint: "",
        records: [],
        changes: [],
        checks: { dns: false, tls: false, https: false, redirect: false },
        message:
          "پس از تأیید، دامنه به همین برنامه متصل و رکوردهای دقیق دریافت می‌شوند. هنوز تغییری انجام نشده است.",
        events: [],
      };
      if (j.provider === "liara") {
        const root = getDomain(j.name, { allowPrivateDomains: false });
        if (!root) throw Error("دامنهٔ اصلی قابل تشخیص نیست.");
        j.zone = {
          id: root,
          name: root,
          nameservers: [],
          status: "NOT_CREATED",
        };
        if (j.mode === "live") {
          const zones = (await this.dns.call("/zones")).data;
          if (!Array.isArray(zones))
            throw Error("دسترسی سامانه DNS لیارا تأیید نشد.");
          if (zones.some((z: any) => z.name === root))
            j.zone = await this.dns.zone(root);
        }
      }
      if (j.mode === "live") {
        const all = await this.liara.call("/v1/domains");
        const existing = all.domains?.find((x: any) => x.name === name);
        if (existing && existing.project?.project_id !== p.appName)
          throw Error(
            "این دامنه به سرویس دیگری متصل است؛ انتقال خودکار انجام نمی‌شود.",
          );
        if (input.provider === "cloudflare") {
          const token = input.cloudflareToken;
          if (!token || !/^[\x21-\x7e]+$/.test(token))
            throw Error(
              "کلید محدود Cloudflare با Zone:Read و DNS:Edit را وارد کنید.",
            );
          registerSecrets([token]);
          this.vault.put("domain-key:" + j.id, { token });
          const zones = await this.cf(j, "/zones?status=active&per_page=50");
          const zone = zones.result
            ?.filter((x: any) => name === x.name || name.endsWith("." + x.name))
            .sort((a: any, b: any) => b.name.length - a.name.length)[0];
          if (!zone)
            throw Error(
              "دامنهٔ فعال در دسترسی این کلید Cloudflare پیدا نشد؛ ابتدا نیم‌سرورها را در ثبت‌کننده فعال کنید.",
            );
          j.zone = {
            id: zone.id,
            name: zone.name,
            nameservers: zone.name_servers || [],
            status: zone.status,
          };
        }
      }
      j.fingerprint = digest({
        id: j.id,
        name,
        app: j.appName,
        provider: j.provider,
        zone: j.zone,
        scope: j.scope,
        expires: j.expiresAt,
      });
      return this.save(j, j.message);
    });
  }
  private async cf(j: DomainJob, path: string, method = "GET", body?: unknown) {
    if (!/^\/(zones)([/?]|$)/.test(path)) throw Error("مسیر DNS مجاز نیست.");
    const token = this.vault.get<{ token: string }>(
      "domain-key:" + j.id,
    )?.token;
    if (!token) throw Error("اتصال DNS در مخزن امن پیدا نشد.");
    registerSecrets([token]);
    const response = await this.request(
      "https://api.cloudflare.com/client/v4" + path,
      {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw Error(
        "Cloudflare درخواست را نپذیرفت (HTTP " +
          response.status +
          "). دسترسی کلید و وضعیت رکورد را بررسی کنید.",
      );
    const data = await response.json();
    if (!data.success)
      throw Error("عملیات DNS تأیید نشد؛ وضعیت واقعی را دوباره بررسی کنید.");
    return data;
  }
  private async remote(j: DomainJob) {
    const d = (
      await this.liara.call("/v1/domains/" + encodeURIComponent(j.name))
    ).domain;
    if (!d || d.name !== j.name || d.project?.project_id !== j.appName)
      throw Error("اتصال دامنه به برنامهٔ تأییدشده قابل تأیید نیست.");
    return d;
  }
  private recordsFor(
    j: DomainJob,
    details: { target?: string; verificationCode?: string },
  ) {
    const records = requiredRecords(j.name, details);
    if (j.provider === "liara" && j.zone?.name === j.name)
      records[0].type = "ALIAS";
    return records;
  }
  private async changes(j: DomainJob) {
    if (j.provider === "liara")
      return dnsDiff(j.records, await this.dns.records(j.zone!.name));
    if (j.provider === "manual")
      return j.records.map((record) => ({
        record,
        action: "create" as const,
        before: [],
      }));
    const existing: any[] = [];
    for (const record of j.records) {
      const r = await this.cf(
        j,
        "/zones/" +
          j.zone!.id +
          "/dns_records?name=" +
          encodeURIComponent(record.name) +
          "&per_page=100",
      );
      if (r.result_info?.total_pages > 1)
        throw Error("تعداد رکوردهای هم‌نام زیاد است؛ بررسی دستی لازم است.");
      existing.push(...r.result);
    }
    return dnsDiff(j.records, existing);
  }
  async decide(id: string, fingerprint: string, approve: boolean) {
    return this.locked(async () => {
      const j = this.get(id);
      this.deployment(j);
      if (
        !["approval", "dns_approval"].includes(j.status) ||
        j.fingerprint !== fingerprint ||
        Date.parse(j.expiresAt) < Date.now()
      )
        throw Error("تأیید معتبر نیست یا منقضی شده؛ پیشنهاد را دوباره بسازید.");
      if (!approve) {
        j.status = "cancelled";
        return this.save(
          j,
          "درخواست لغو شد. تغییرهای قبلی بازگردانی یا حذف نشدند؛ فقط ادامهٔ خودکار متوقف شد.",
        );
      }
      this.db.audit(
        "domain_approval",
        "تأیید عملیات دامنه",
        JSON.stringify({
          id: j.id,
          name: j.name,
          stage: j.status,
          fingerprint,
        }),
        "user",
      );
      j.approvedUntil = new Date(Date.now() + 86400000).toISOString();
      if (j.status === "approval") {
        j.status = "attaching";
        this.save(j, "اتصال دقیق دامنه پس از تأیید شما شروع شد.");
        try {
          if (j.provider === "liara") {
            if (j.mode === "demo")
              j.zone = {
                ...j.zone!,
                nameservers: ["ns1.liara.ir", "ns2.liara.ir"],
                status: "PENDING",
              };
            else {
              const zones = (await this.dns.call("/zones")).data;
              if (!Array.isArray(zones))
                throw Error("فهرست دامنه‌های DNS معتبر نیست.");
              if (!zones.some((z: any) => z.name === j.zone!.name))
                await this.dns.call("/zones", "POST", { name: j.zone!.name });
              j.zone = await this.dns.zone(j.zone!.name);
            }
            this.save(
              j,
              "سامانهٔ DNS آماده شد؛ نیم‌سرورهای واقعی همین دامنه دریافت شدند.",
            );
          }
          if (j.mode === "demo") {
            j.domainId = "demo-" + j.id;
            j.records = this.recordsFor(j, {
              target: j.appName + ".liara.run",
              verificationCode: "demo-ownership-code",
            });
          } else {
            const existing = (
              await this.liara.call("/v1/domains")
            ).domains?.find((x: any) => x.name === j.name);
            if (!existing)
              await this.liara.call("/v1/domains", "POST", {
                name: j.name,
                project: j.appName,
                type: "PROJECT",
              });
            const d = await this.remote(j);
            j.domainId = d._id;
            j.records = this.recordsFor(j, d);
          }
          j.changes =
            j.mode === "demo"
              ? j.records.map((record) => ({
                  record,
                  action: "create",
                  before: [],
                }))
              : await this.changes(j);
          j.status = "dns_approval";
          j.expiresAt = new Date(Date.now() + 600000).toISOString();
          j.fingerprint = digest({
            id: j.id,
            scope: j.scope,
            records: j.records,
            changes: j.changes,
            expires: j.expiresAt,
          });
          return this.save(
            j,
            "رکوردهای دقیق آماده‌اند. تغییر DNS و درخواست SSL نیاز به تأیید شما دارد؛ رکوردهای ایمیل تغییر نمی‌کنند.",
          );
        } catch (e) {
          j.status = "attention";
          return this.save(
            j,
            (e as Error).message + " نتیجهٔ نامشخص دوباره اجرا نمی‌شود.",
          );
        }
      }
      // Re-read both provider target and DNS state immediately before the approved write.
      if (j.mode === "live") {
        const d = await this.remote(j);
        const records = this.recordsFor(j, d);
        const changes = await this.changes(j);
        if (
          digest(records) !== digest(j.records) ||
          digest(changes) !== digest(j.changes)
        )
          throw Error(
            "رکوردها از زمان پیشنهاد تغییر کرده‌اند؛ بدون تغییر جدید، درخواست تازه بسازید.",
          );
      }
      if (j.provider === "liara") {
        j.status = "waiting_ns";
        j.nextCheckAt = stamp();
        return this.save(
          j,
          "اکنون فقط نیم‌سرورهای نمایش‌داده‌شده را در ثبت‌کنندهٔ دامنه تنظیم کنید. پس از تأیید NS، همراه رکوردهای اتصال و SSL را خودکار ثبت و بررسی می‌کند.",
        );
      }
      j.status = "applying_dns";
      this.save(j, "تأیید تغییر رکوردها و صدور SSL ثبت شد.");
      try {
        if (j.provider === "cloudflare" && j.mode === "live")
          for (const c of j.changes) {
            if (c.action === "keep") continue;
            // Exact approved records only. MX, NS, CAA, email TXT and unrelated names are never touched.
            for (const old of c.before)
              await this.cf(
                j,
                "/zones/" + j.zone!.id + "/dns_records/" + old.id,
                "DELETE",
              );
            await this.cf(j, "/zones/" + j.zone!.id + "/dns_records", "POST", {
              ...c.record,
              ttl: 300,
              ...(c.record.type === "CNAME" ? { proxied: false } : {}),
            });
          }
        j.status = "waiting_dns";
        j.nextCheckAt = stamp();
        this.save(
          j,
          j.provider === "manual"
            ? "فقط رکوردهای نمایش‌داده‌شده را در سرویس DNS ثبت کنید؛ همراه انتشار و SSL را پیگیری می‌کند."
            : "رکوردهای تأییدشده ثبت شدند؛ منتظر انتشار DNS هستیم.",
        );
      } catch (e) {
        j.status = "attention";
        this.save(
          j,
          (e as Error).message +
            " ممکن است بخشی از رکوردها ثبت شده باشد؛ تغییرها خودکار تکرار نمی‌شوند.",
        );
      }
      return j;
    });
  }
  async check(id: string) {
    return this.locked(async () => this.inspect(this.get(id)));
  }
  async confirmNameservers(id: string) {
    return this.locked(async () => {
      const j = this.get(id);
      this.deployment(j);
      if (j.provider !== "liara" || j.status !== "waiting_ns")
        throw Error("این مرحله منتظر تغییر نیم‌سرورها نیست.");
      j.registrarConfirmedAt = stamp();
      this.save(
        j,
        "کاربر اعلام کرد نیم‌سرورها را تغییر داده است؛ وضعیت واقعی همچنان مستقل بررسی می‌شود.",
      );
      this.db.audit(
        "nameservers_confirmed",
        "اعلام تغییر NS توسط کاربر",
        j.id,
        "user",
      );
      return this.inspect(j);
    });
  }
  private async inspect(j: DomainJob) {
    try {
      this.deployment(j);
    } catch (error) {
      j.status = "attention";
      j.checks = { dns: false, tls: false, https: false, redirect: false };
      return this.save(
        j,
        (error as Error).message +
          " اتصال و رکوردهای دامنه خودکار حذف نمی‌شوند.",
      );
    }
    if (["approval", "dns_approval", "cancelled"].includes(j.status)) return j;
    j.lastCheckedAt = stamp();
    j.nextCheckAt = new Date(
      Date.now() + (j.status === "active" ? 21600000 : 60000),
    ).toISOString();
    try {
      if (j.mode === "demo") {
        if (j.provider === "liara" && !j.registrarConfirmedAt) {
          j.status = "waiting_ns";
          return this.save(
            j,
            "در این پیش‌نمایش، مرحلهٔ ضروری ثبت‌کننده را با دکمهٔ «نیم‌سرورها را تغییر دادم» ادامه دهید؛ تغییر واقعی انجام نمی‌شود.",
          );
        }
        j.checks = {
          dns: true,
          tls: true,
          https: true,
          redirect: false,
          certificateExpiresAt: new Date(Date.now() + 7776000000).toISOString(),
        };
        j.status = "active";
        return this.save(
          j,
          "پیش‌نمایش موفق است؛ هیچ DNS یا SSL واقعی تغییر نکرده است. انتقال HTTP به HTTPS نیازمند تنظیم برنامه است.",
        );
      }
      if (j.provider === "liara" && !j.dnsAppliedAt) {
        if (j.status === "attention")
          return this.save(
            j,
            "نتیجهٔ تغییر قبلی نامشخص است؛ برای تغییر تازه پیشنهاد و تأیید جدید لازم است.",
          );
        const delegation = await this.dns.delegated(j.zone!);
        j.zone = delegation.zone;
        if (!delegation.valid) {
          j.status = "waiting_ns";
          return this.save(
            j,
            "نیم‌سرورهای عمومی هنوز دقیقاً با NS لیارا برابر نیستند؛ پس از ذخیره در ثبت‌کننده ممکن است تا ۲۴ ساعت زمان لازم باشد.",
          );
        }
        if (!j.approvedUntil || Date.parse(j.approvedUntil) < Date.now()) {
          j.status = "attention";
          return this.save(j, "مجوز تغییر DNS منقضی شده؛ تأیید تازه لازم است.");
        }
        const fresh = await this.changes(j);
        if (digest(fresh) !== digest(j.changes)) {
          j.changes = fresh;
          j.status = "dns_approval";
          j.expiresAt = new Date(Date.now() + 600000).toISOString();
          j.fingerprint = digest({
            id: j.id,
            scope: j.scope,
            changes: fresh,
            records: j.records,
            expires: j.expiresAt,
          });
          return this.save(
            j,
            "رکوردها از زمان تأیید تغییر کرده‌اند؛ پیش‌نمایش تازه را پیش از تغییر تأیید کنید.",
          );
        }
        j.status = "applying_dns";
        this.save(
          j,
          "NS تأیید شد؛ ثبت رکوردهای دقیق اتصال و SSL در DNS لیارا شروع شد.",
        );
        try {
          for (const c of j.changes) {
            if (c.action === "keep") continue;
            for (const old of c.before) {
              if (!old.id) throw Error("شناسهٔ رکورد قابل تأیید نیست.");
              await this.dns.call(
                "/zones/" +
                  encodeURIComponent(j.zone!.name) +
                  "/dns-records/" +
                  encodeURIComponent(old.id),
                "DELETE",
              );
            }
            await this.dns.call(
              "/zones/" + encodeURIComponent(j.zone!.name) + "/dns-records",
              "POST",
              {
                type: c.record.type,
                name: c.record.name,
                ttl: 3600,
                contents: [
                  c.record.type === "TXT"
                    ? { text: c.record.content }
                    : { host: c.record.content },
                ],
              },
            );
          }
          j.dnsAppliedAt = stamp();
          j.status = "waiting_dns";
          this.save(
            j,
            "رکوردهای اتصال، مالکیت و ACME ثبت شدند؛ تأیید لیارا و SSL در حال پیگیری است.",
          );
        } catch (e) {
          j.status = "attention";
          return this.save(
            j,
            (e as Error).message +
              " نتیجهٔ نوشتن نامشخص است و خودکار تکرار نمی‌شود.",
          );
        }
      }
      const details = await this.remote(j);
      j.domainId = details._id;
      const d = (
        await this.liara.call(
          "/v1/domains/" + encodeURIComponent(j.domainId!) + "/check",
        )
      ).domain;
      j.checks.dns =
        d?.status === "ACTIVE" &&
        d?.CNameRecord === "VALID" &&
        d?.acmeRecord === "VALID";
      if (!j.checks.dns) {
        j.checks = { dns: false, tls: false, https: false, redirect: false };
        if (j.status !== "attention") j.status = "waiting_dns";
        return this.save(
          j,
          "هنوز همهٔ رکوردها توسط لیارا تأیید نشده‌اند؛ انتشار DNS، رکورد مالکیت، ACME و CAA را بررسی می‌کنیم. ممکن است تا ۲۴ ساعت طول بکشد.",
        );
      }
      if (details.certificatesStatus !== "ACTIVE") {
        if (
          ["REQUESTING", "PENDING"].includes(details.certificatesStatus) ||
          j.sslRequestedAt
        ) {
          if (j.status !== "attention") j.status = "waiting_ssl";
          return this.save(
            j,
            "درخواست گواهی در حال بررسی است؛ برای جلوگیری از درخواست تکراری منتظر پاسخ لیارا می‌مانیم.",
          );
        }
        if (
          j.status === "attention" ||
          !j.approvedUntil ||
          Date.parse(j.approvedUntil) < Date.now()
        ) {
          j.status = "attention";
          return this.save(
            j,
            "برای درخواست گواهی، تأیید تازه لازم است؛ اختیار قبلی منقضی شده یا نتیجهٔ تغییر نامشخص است.",
          );
        }
        // Persist intent before dispatch; an unknown write is never blindly retried.
        j.sslRequestedAt = stamp();
        j.status = "waiting_ssl";
        this.save(j, "درخواست گواهی SSL در حال ارسال است.");
        await this.liara.call("/v1/domains/provision-ssl-certs", "POST", {
          domain: j.name,
        });
        return this.save(
          j,
          "درخواست SSL به لیارا ارسال شد؛ هنوز موفقیت HTTPS تأیید نشده است.",
        );
      }
      j.status = j.status === "attention" ? "attention" : "verifying";
      this.save(j);
      j.checks = { dns: true, tls: false, https: false, redirect: false };
      this.save(j);
      const probe = await this.probe(j.name);
      j.checks = { dns: true, ...probe };
      if (probe.tls && probe.https) {
        j.status = "active";
        const nearExpiry =
          probe.certificateExpiresAt &&
          Date.parse(probe.certificateExpiresAt) - Date.now() < 14 * 86400000;
        return this.save(
          j,
          nearExpiry
            ? "گواهی معتبر است اما کمتر از ۱۴ روز اعتبار دارد؛ تمدید خودکار لیارا باید بررسی شود."
            : probe.redirect
              ? "دامنه، رکوردها، گواهی معتبر، پاسخ HTTPS و انتقال HTTP به HTTPS تأیید شدند."
              : "دامنه و HTTPS معتبر تأیید شدند؛ انتقال HTTP به HTTPS فعال نیست. این تنظیم باید در برنامه انجام شود؛ هدایت دامنه به خودش می‌تواند حلقه بسازد و انجام نمی‌شود.",
        );
      }
      return this.save(
        j,
        "گواهی یا پاسخ موفق سایت هنوز تأیید نشده؛ سایت نیاز به بررسی دارد.",
      );
    } catch (e) {
      return this.save(j, (e as Error).message);
    }
  }
  async cancel(id: string) {
    return this.locked(async () => {
      const j = this.get(id);
      j.status = "cancelled";
      return this.save(
        j,
        "پیگیری متوقف شد؛ رکوردهای DNS و اتصال‌های قبلی حذف نشدند.",
      );
    });
  }
  async tick() {
    if (this.busy) return;
    const j = this.list().find(
      (j) =>
        [
          "waiting_ns",
          "waiting_dns",
          "waiting_ssl",
          "verifying",
          "active",
        ].includes(j.status) &&
        (!j.nextCheckAt || Date.parse(j.nextCheckAt) <= Date.now()),
    );
    if (
      j &&
      j.status !== "active" &&
      j.approvedUntil &&
      Date.parse(j.approvedUntil) < Date.now()
    ) {
      j.status = "attention";
      this.save(
        j,
        "مهلت ۲۴ ساعتهٔ پیگیری تمام شد؛ برای ادامه، درخواست تازه و تأیید شما لازم است.",
      );
      return;
    }
    if (j) await this.check(j.id).catch(() => {});
  }
  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 15000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
