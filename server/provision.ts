import { randomUUID, createHmac } from "node:crypto";
import { z } from "zod";
import { config } from "./config.ts";
import { Liara, LiaraError } from "./liara.ts";
import { Projects } from "./projects.ts";
import { Vault } from "./vault.ts";
import { digest, registerSecrets } from "./security.ts";
import type { Store } from "./store.ts";
import type { Engine } from "./engine.ts";
import type {
  CloudCatalog,
  CloudPlan,
  DatabaseSelection,
  ProvisionInput,
  ProvisionJob,
} from "../src/provision-types.ts";

class ProvisionError extends Error {}
const name = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{2,39}$/,
    "نام باید با حرف انگلیسی شروع شود و ۳ تا ۴۰ حرف، عدد یا خط تیره داشته باشد.",
  );
const key = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const route = z
  .string()
  .max(180)
  .regex(/^\/(?!\/)[a-zA-Z0-9_\-/]*$/, "مسیر باید مانند /health باشد.");
export const provisionSchema = z
  .object({
    projectId: z.string().uuid(),
    appName: name,
    appPlan: z.string().max(120),
    networkId: z.string().max(100),
    databases: z
      .array(
        z
          .object({
            type: z.enum(["postgres", "mysql", "mongodb", "redis"]),
            name,
            plan: z.string().max(120),
            version: z.string().max(30),
            bindings: z.record(
              key,
              z.enum([
                "url",
                "host",
                "port",
                "username",
                "password",
                "database",
              ]),
            ),
          })
          .strict(),
      )
      .max(4),
    env: z
      .record(key, z.string().max(8000))
      .refine((v) => Object.keys(v).length <= 80),
    healthPath: route,
    businessPath: z.union([route, z.literal("")]),
  })
  .strict();
type PrivateQuote = {
  resumeDeployment?: boolean;
  scopeDigest: string;
  input: ProvisionInput;
  account: string;
  fingerprint: string;
  catalog: CloudCatalog;
};
const scope = (job: ProvisionJob) =>
  digest({
    id: job.id,
    projectId: job.projectId,
    appName: job.appName,
    sourceHash: job.sourceHash,
    mode: job.mode,
    fingerprint: job.fingerprint,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    monthly: job.monthly,
    currency: job.currency,
    items: job.items,
    envNames: job.envNames,
    continuationOf: job.continuationOf,
  });
const databaseTypes = ["postgres", "mysql", "mongodb", "redis"];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const numeric = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

export function parseCatalog(me: any, networkData: any): CloudCatalog {
  if (
    !me?.plans?.projects ||
    !me?.plans?.databases ||
    !Array.isArray(networkData?.networks)
  )
    throw new ProvisionError(
      "قالب فهرست پلن‌ها یا شبکه‌های لیارا قابل تأیید نیست؛ ساخت سرویس متوقف است.",
    );
  function plans(kind: "projects" | "databases"): CloudPlan[] {
    const bundles =
      kind === "projects"
        ? me.plans.projectBundlePlans
        : me.plans.databaseBundlePlans;
    const result: CloudPlan[] = [];
    for (const [id, raw] of Object.entries(me.plans[kind])) {
      const p = raw as any;
      if (
        !p.available ||
        (p.region && p.region !== "iran") ||
        !numeric(p.price) ||
        !numeric(p.CPU?.amount) ||
        !numeric(p.RAM?.amount) ||
        !numeric(p.volume)
      )
        continue;
      // Bundle charges are distinct from resource hourly prices in the official CLI.
      const choices =
        bundles?.[id] ||
        (id === "free" ? { free: { available: true, displayPrice: 0 } } : {});
      for (const [bundleId, b] of Object.entries(choices)) {
        const bundle = b as any;
        if (!bundle.available || !numeric(bundle.displayPrice)) continue;
        result.push({
          id: `${id}/${bundleId}`,
          planId: id,
          bundleId,
          label: `${p.RAM.amount} GB · ${p.CPU.amount} CPU · ${p.volume} GB`,
          cpu: p.CPU.amount,
          ram: p.RAM.amount,
          disk: p.volume,
          hourly: p.price,
          bundleMonthly: bundle.displayPrice,
          monthly: p.price * 720 + bundle.displayPrice,
          supports: Array.isArray(p.supports) ? p.supports : [],
        });
      }
    }
    return result.sort((a, b) => a.monthly - b.monthly);
  }
  const versions: Record<string, string[]> = {};
  for (const type of databaseTypes)
    versions[type] = (
      Array.isArray(me.databaseVersions?.[type])
        ? me.databaseVersions[type]
        : []
    )
      .map((v: any) => v.value)
      .filter((v: unknown) => typeof v === "string" && v.length < 30);
  return {
    mode: "live",
    source: "Liara /v1/me + /v1/networks (official CLI contract)",
    fetchedAt: new Date().toISOString(),
    currency: "تومان",
    appPlans: plans("projects"),
    databasePlans: plans("databases"),
    versions,
    networks: networkData.networks
      .map((n: any) => ({ id: String(n._id), name: String(n.name) }))
      .filter((n: any) => n.id && n.id !== "undefined"),
    connected: true,
  };
}
export function demoCatalog(): CloudCatalog {
  const plan = (
    id: string,
    ram: number,
    cpu: number,
    monthly: number,
    supports: string[] = [],
  ): CloudPlan => ({
    id: `${id}/free`,
    planId: id,
    bundleId: "free",
    label: `${ram} GB · ${cpu} CPU`,
    ram,
    cpu,
    disk: 10,
    hourly: monthly / 720,
    bundleMonthly: 0,
    monthly,
    supports,
  });
  return {
    mode: "demo",
    source: "دادهٔ نمایشی؛ تعرفهٔ واقعی لیارا نیست",
    fetchedAt: new Date().toISOString(),
    currency: "تومان",
    connected: false,
    appPlans: [
      plan("demo-small", 0.5, 0.5, 120000),
      plan("demo-medium", 1, 1, 240000),
    ],
    databasePlans: [
      plan("demo-db", 0.5, 0.5, 90000, databaseTypes),
      plan("demo-db-plus", 1, 1, 180000, databaseTypes),
    ],
    versions: {
      postgres: ["16"],
      mysql: ["8.0"],
      mongodb: ["7.0"],
      redis: ["7.2"],
    },
    networks: [],
  };
}
export function connectionValues(
  db: any,
  selection: DatabaseSelection,
): Record<string, string> {
  const password = db.root_password,
    username = db.username || (selection.type === "redis" ? "" : "root");
  const host = selection.name;
  const ports: Record<string, number> = {
    postgres: 5432,
    mysql: 3306,
    mongodb: 27017,
    redis: 6379,
  };
  const port = Number(db.internalPort || ports[selection.type]);
  const database = String(
    db.dbName ||
      (selection.type === "postgres"
        ? "postgres"
        : selection.type === "redis"
          ? "0"
          : "app"),
  );
  if (selection.type === "mysql" && !db.dbName)
    throw new ProvisionError(
      "نام پایگاه دادهٔ MySQL از API دریافت نشد؛ اتصال خودکار با نام حدسی انجام نمی‌شود. سرویس ساخته‌شده در تاریخچه ثبت است و نیاز به بررسی تنظیمات برنامه دارد.",
    );
  if (
    typeof password !== "string" ||
    !password ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new ProvisionError(
      "اطلاعات اتصال دیتابیس هنوز کامل نیست؛ تنظیمات برنامه ارسال نشد.",
    );
  const auth =
    selection.type === "redis"
      ? `:${encodeURIComponent(password)}`
      : `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  const protocol =
    selection.type === "postgres" ? "postgresql" : selection.type;
  const url = `${protocol}://${auth}@${host}:${port}/${encodeURIComponent(database)}${selection.type === "mongodb" ? "?authSource=admin" : ""}`;
  registerSecrets([password, url]);
  return { url, host, port: String(port), username, password, database };
}

export class Provisioner {
  busy = false;
  private liara: Liara;
  constructor(
    private db: Store,
    private engine: Engine,
    private vault: Vault,
    liara?: Liara,
    private sleep = delay,
  ) {
    this.liara = liara || new Liara();
    for (const job of this.db.list<ProvisionJob>("provisionJobs"))
      if (job.status === "running") {
        job.status = "failed";
        job.error =
          "اجرای قبلی قطع شده و نتیجهٔ مرحلهٔ آخر نامشخص است؛ عملیات تکرار نشد.";
        job.nextStep =
          "فهرست منابع و مرحلهٔ آخر را بررسی کنید؛ سرویس‌های ساخته‌شده ممکن است همچنان هزینه داشته باشند.";
        for (const step of job.steps)
          if (step.status === "running") {
            step.status = "failed";
            step.detail = "نتیجه نامشخص؛ نیازمند بررسی";
          }
        this.db.put("provisionJobs", job);
      }
  }
  account() {
    return digest({
      mode: config.mode,
      token: config.liaraToken,
      team: config.teamId,
    });
  }
  async catalog() {
    if (config.mode === "demo") return demoCatalog();
    const [me, networks] = await Promise.all([
      this.liara.call("/v1/me"),
      this.liara.call("/v1/networks"),
    ]);
    if (config.teamId && me.team?._id !== config.teamId)
      throw new ProvisionError(
        "حساب تیمی در پاسخ لیارا تأیید نشد؛ پیشنهاد هزینه ساخته نمی‌شود.",
      );
    return parseCatalog(me, networks);
  }
  list(projectId: string) {
    return this.db
      .list<ProvisionJob>("provisionJobs")
      .filter((j) => j.projectId === projectId);
  }
  get(id: string) {
    const job = this.db.get<ProvisionJob>("provisionJobs", id);
    if (!job) throw new ProvisionError("درخواست راه‌اندازی پیدا نشد.");
    return job;
  }
  async requote(id: string) {
    const previous = this.get(id);
    const quote = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (
      previous.status !== "failed" ||
      !quote ||
      quote.account !== this.account() ||
      quote.scopeDigest !== scope(previous) ||
      previous.mode !== config.mode
    )
      throw new ProvisionError(
        "این درخواست برای بررسی مجدد در حساب فعلی معتبر نیست.",
      );
    // Only a definitive payment rejection before any paid resource is eligible.
    if (
      !(
        previous.errorCode === "payment_required" ||
        previous.error?.includes("HTTP 402")
      ) ||
      previous.resources.some((r) => r.kind !== "network")
    )
      throw new ProvisionError(
        "منابع ایجادشده یا نتیجهٔ نامشخص نیازمند بررسی‌اند؛ ساخت دوباره مجاز نیست.",
      );
    new Projects(this.db).verify(previous.projectId, previous.sourceHash);
    const input = structuredClone(quote.input);
    const network = previous.resources.find((r) => r.kind === "network");
    if (network) {
      const catalog = await this.catalog();
      if (
        !catalog.networks.some(
          (n) => n.id === network.id && n.name === network.name,
        )
      )
        throw new ProvisionError(
          "شبکهٔ قبلی در حساب فعلی تأیید نشد؛ تنظیمات را دوباره بررسی کنید.",
        );
      input.networkId = network.id;
    }
    // Fresh quote, prices and approval. Secret inputs stay encrypted on the server.
    return this.quote(input);
  }
  async logs(id: string) {
    const job = this.get(id),
      quote = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (
      !quote ||
      quote.account !== this.account() ||
      job.mode !== config.mode ||
      !job.resources.some(
        (r) => r.kind === "app" && r.id === quote.input.appName,
      )
    )
      throw new ProvisionError(
        "برنامهٔ ساخته‌شده‌ای برای بررسی این درخواست در حساب فعلی وجود ندارد.",
      );
    if (job.mode === "demo")
      return {
        source: "demo",
        text: "در پیش‌نمایش، برنامهٔ کاربر اجرا نمی‌شود و لاگ اجرای واقعی وجود ندارد.",
      };
    registerSecrets([
      ...Object.values(quote.input.env),
      ...Object.values(
        this.vault.get<Record<string, string>>(`app-env:${id}`) || {},
      ),
    ]);
    return this.liara.logs(quote.input.appName);
  }
  private select(catalog: CloudCatalog, input: ProvisionInput) {
    const app = catalog.appPlans.find((p) => p.id === input.appPlan);
    if (!app)
      throw new ProvisionError(
        "پلن برنامه در فهرست قابل‌خرید نیست؛ قیمت‌ها را تازه کنید.",
      );
    const databases = input.databases.map((d) => {
      const plan = catalog.databasePlans.find(
        (p) => p.id === d.plan && p.supports.includes(d.type),
      );
      if (!plan || !catalog.versions[d.type]?.includes(d.version))
        throw new ProvisionError(
          "پلن یا نسخهٔ دیتابیس در دسترس نیست؛ پیشنهاد را تازه کنید.",
        );
      return plan;
    });
    if (
      input.networkId &&
      !catalog.networks.some((n) => n.id === input.networkId)
    )
      throw new ProvisionError("شبکهٔ انتخاب‌شده موجود نیست.");
    return { app, databases };
  }
  async quote(raw: unknown) {
    if (this.busy || this.engine.executing)
      throw new ProvisionError("عملیات دیگری در حال اجراست.");
    const input = provisionSchema.parse(raw);
    const projects = new Projects(this.db),
      project = projects.get(input.projectId);
    projects.verify(project.id, project.hash);
    const names = new Set([
      input.appName,
      ...input.databases.map((d) => d.name),
    ]);
    if (names.size !== input.databases.length + 1)
      throw new ProvisionError("نام برنامه و دیتابیس‌ها باید متفاوت باشد.");
    const bound = new Set<string>();
    for (const database of input.databases)
      for (const env of Object.keys(database.bindings)) {
        if (
          /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_)/.test(env) ||
          bound.has(env) ||
          Object.hasOwn(input.env, env) ||
          ["PORT", "NODE_ENV"].includes(env)
        )
          throw new ProvisionError("یک تنظیم به چند مقدار متصل شده است.");
        bound.add(env);
      }
    // These credentials belong to the owned sample's machine control contract.
    // Generate server-side; they never need to be copied by a novice user.
    for (const env of project.envNames)
      if (
        ["HAMRAH_CONTROL_TOKEN", "TEST_CONTROL_TOKEN"].includes(env) &&
        !input.env[env]
      )
        input.env[env] = randomUUID() + randomUUID();
    for (const env of project.envNames)
      if (!bound.has(env) && !input.env[env])
        throw new ProvisionError(
          `مقدار «${env}» یا اتصال خودکار آن را مشخص کنید.`,
        );
    const catalog = await this.catalog(),
      selected = this.select(catalog, input);
    if (input.businessPath && input.businessPath === input.healthPath)
      throw new ProvisionError(
        "بررسی سلامت و عملیات اصلی نباید یک مسیر یکسان باشند؛ مسیر کسب‌وکار را خالی بگذارید یا مسیر مستقل بدهید.",
      );
    if (config.mode === "live") {
      const [apps, databases] = await Promise.all([
        this.liara.apps(),
        this.liara.call("/v1/databases"),
      ]);
      if (apps.some((a) => a.id === input.appName))
        throw new ProvisionError(
          "این نام برنامه قبلاً استفاده شده؛ برای جلوگیری از تغییر برنامهٔ موجود، نام تازه‌ای انتخاب کنید.",
        );
      if (!Array.isArray(databases.databases))
        throw new ProvisionError("فهرست دیتابیس‌های موجود قابل تأیید نیست.");
      if (
        input.databases.some((d) =>
          databases.databases.some(
            (existing: any) => existing.hostname === d.name,
          ),
        )
      )
        throw new ProvisionError(
          "نام یکی از دیتابیس‌ها قبلاً استفاده شده؛ نام تازه‌ای انتخاب کنید.",
        );
    }
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    const fingerprint = createHmac("sha256", Buffer.from(randomUUID()))
      .update(
        JSON.stringify({
          input,
          account: this.account(),
          hash: project.hash,
          catalog,
        }),
      )
      .digest("hex");
    const items = [
      {
        label: `برنامهٔ ${input.appName}`,
        monthly: selected.app.monthly,
        plan: input.appPlan,
      },
      ...input.databases.map((d, i) => ({
        label: `${d.type} · ${d.name}`,
        monthly: selected.databases[i].monthly,
        plan: d.plan,
      })),
    ];
    const job: ProvisionJob = {
      id,
      projectId: project.id,
      appName: input.appName,
      sourceHash: project.hash,
      mode: config.mode,
      status: "pending",
      fingerprint,
      createdAt,
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      monthly: items.reduce((sum, i) => sum + i.monthly, 0),
      currency: "تومان",
      items,
      envNames: [...new Set([...Object.keys(input.env), ...bound])],
      steps: [
        {
          key: "network",
          label: input.networkId ? "بررسی شبکهٔ خصوصی" : "ساخت شبکهٔ خصوصی",
          status: "waiting",
        },
        { key: "app", label: "ساخت برنامهٔ شما", status: "waiting" },
        ...input.databases.map((d, i) => ({
          key: `db-${i}`,
          label: `ساخت و آماده‌سازی ${d.type}`,
          status: "waiting" as const,
        })),
        {
          key: "env",
          label: "اتصال امن تنظیمات و دیتابیس‌ها",
          status: "waiting",
        },
        { key: "deploy", label: "انتشار نسخهٔ تأییدشده", status: "waiting" },
        {
          key: "verify",
          label: "بررسی سلامت و کارکرد سایت",
          status: "waiting",
        },
      ],
      resources: [],
    };
    registerSecrets(Object.values(input.env));
    this.vault.put(`quote:${id}`, {
      scopeDigest: scope(job),
      input,
      account: this.account(),
      fingerprint,
      catalog,
    } satisfies PrivateQuote);
    this.db.put("provisionJobs", job);
    this.db.audit(
      "provision_quote",
      "پیشنهاد ساخت زیرساخت آماده شد",
      `${id}; ${input.appName}; estimate=${job.monthly}; sourceHash=${job.sourceHash}`,
    );
    this.engine.emit();
    return job;
  }
  private save(job: ProvisionJob) {
    this.db.put("provisionJobs", job);
    this.engine.emit();
  }
  private step(
    job: ProvisionJob,
    key: string,
    status: "running" | "done",
    detail?: string,
  ) {
    const step = job.steps.find((s) => s.key === key)!;
    step.status = status;
    step.detail = detail;
    this.db.audit("provision_step", step.label, `${job.id}; ${status}`);
    this.save(job);
  }
  async approve(id: string, fingerprint: string, approve: boolean) {
    const job = this.get(id),
      quote = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (job.status !== "pending")
      throw new ProvisionError("این درخواست قبلاً پردازش شده است.");
    if (
      !quote ||
      quote.scopeDigest !== scope(job) ||
      fingerprint !== job.fingerprint ||
      quote.fingerprint !== fingerprint ||
      (approve &&
        (quote.account !== this.account() || job.mode !== config.mode))
    )
      throw new ProvisionError(
        "مشخصات تأیید یا حساب تغییر کرده؛ پیشنهاد تازه بسازید.",
      );
    if (Date.parse(job.expiresAt) < Date.now()) {
      job.status = "expired";
      this.save(job);
      if (!approve) return job;
      throw new ProvisionError(
        "اعتبار پیشنهاد تمام شده؛ هزینه را دوباره بررسی کنید.",
      );
    }
    if (!approve) {
      job.status = "rejected";
      this.save(job);
      this.db.audit(
        "provision_rejected",
        "راه‌اندازی با تصمیم شما اجرا نشد",
        job.id,
        "user",
      );
      return job;
    }
    if (this.busy || this.engine.executing || this.engine.probing)
      throw new ProvisionError(
        "بررسی یا عملیات دیگری در حال اجراست؛ چند ثانیه بعد تلاش کنید.",
      );
    this.busy = true;
    this.engine.executing = true;
    job.status = "running";
    this.save(job);
    this.db.audit(
      "provision_approved",
      "ساخت سرویس‌ها و هزینهٔ برآوردی تأیید شد",
      `${job.id}; fingerprint=${fingerprint}; estimate=${job.monthly}`,
      "user",
    );
    void this.execute(job, quote)
      .finally(() => {
        this.busy = false;
        this.engine.executing = false;
        this.engine.emit();
      })
      .catch(() => {});
    return job;
  }
  private async assertPrices(quote: PrivateQuote) {
    const fresh = await this.catalog(),
      old = this.select(quote.catalog, quote.input),
      current = this.select(fresh, quote.input);
    if (
      digest({ app: old.app, databases: old.databases }) !==
      digest({ app: current.app, databases: current.databases })
    )
      throw new ProvisionError(
        "تعرفه یا مشخصات پلن تغییر کرده؛ پیش از ادامه به تأیید تازه نیاز است.",
      );
    return current;
  }
  private async validateContinuation(job: ProvisionJob, quote: PrivateQuote) {
    if (
      quote.account !== this.account() ||
      job.mode !== "live" ||
      !job.continuationOf
    )
      throw new ProvisionError("حساب ادامهٔ انتشار معتبر نیست.");
    const original = this.get(job.continuationOf);
    if (
      original.status !== "failed" ||
      original.errorCode !== "source_rejected" ||
      original.releaseId ||
      original.steps.find((s) => s.status === "failed")?.key !== "deploy" ||
      original.steps.find((s) => s.key === "env")?.status !== "done" ||
      !original.resources.some(
        (r) => r.kind === "app" && r.id === quote.input.appName,
      )
    )
      throw new ProvisionError(
        "ادامهٔ امن انتشار برای این درخواست قابل تأیید نیست.",
      );
    new Projects(this.db).verify(job.projectId, job.sourceHash);
    const details = await this.liara.call(
      `/v1/projects/${encodeURIComponent(job.appName)}`,
    );
    const expected = this.vault.get<Record<string, string>>(
      `app-env:${original.id}`,
    );
    const actual = details.project?.envs;
    if (
      !expected ||
      !Array.isArray(actual) ||
      Object.entries(expected).some(
        ([k, v]) => !actual.some((e: any) => e.key === k && e.value === v),
      )
    )
      throw new ProvisionError(
        "تنظیمات برنامه با نسخهٔ ثبت‌شده یکسان نیست؛ ادامه متوقف شد.",
      );
    const releases = await this.liara.call(
      `/v1/projects/${encodeURIComponent(job.appName)}/releases?page=1&count=20`,
    );
    if (
      !Array.isArray(releases.releases) ||
      releases.releases.length ||
      releases.currentRelease
    )
      throw new ProvisionError(
        "نسخه‌ای برای برنامه وجود دارد؛ برای جلوگیری از انتشار تکراری، ادامهٔ خودکار متوقف شد.",
      );
    return expected;
  }
  async continueDeployment(id: string) {
    if (this.busy || this.engine.executing)
      throw new ProvisionError("منتظر پایان عملیات جاری بمانید.");
    const original = this.get(id),
      old = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (!old || old.scopeDigest !== scope(original))
      throw new ProvisionError("پیشنهاد اصلی معتبر نیست.");
    const now = new Date().toISOString();
    const job: ProvisionJob = {
      ...structuredClone(original),
      id: randomUUID(),
      continuationOf: id,
      status: "pending",
      createdAt: now,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      fingerprint: digest(randomUUID()),
      error: undefined,
      errorCode: undefined,
      nextStep: undefined,
    };
    job.steps = job.steps.map((s) =>
      ["deploy", "verify"].includes(s.key)
        ? { ...s, status: "waiting", detail: undefined }
        : s,
    );
    const env = await this.validateContinuation(job, old);
    const catalog = await this.catalog();
    this.select(catalog, old.input);
    const pending = this.list(job.projectId).find(
      (j) =>
        j.continuationOf === id &&
        j.status === "pending" &&
        Date.parse(j.expiresAt) > Date.now(),
    );
    if (pending) return pending;
    const fresh = {
      ...old,
      catalog,
      resumeDeployment: true,
      fingerprint: job.fingerprint,
      scopeDigest: scope(job),
    };
    this.vault.put(`quote:${job.id}`, fresh);
    this.vault.put(`app-env:${job.id}`, env);
    this.db.put("provisionJobs", job);
    this.db.audit(
      "deployment_continuation",
      "ادامهٔ انتشار بدون ساخت مجدد آماده شد",
      `${id}; ${job.id}`,
    );
    this.engine.emit();
    return job;
  }
  async recheckDeployment(id: string) {
    const job = this.get(id),
      quote = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (
      !quote ||
      quote.account !== this.account() ||
      quote.scopeDigest !== scope(job) ||
      job.mode !== "live" ||
      !job.releaseId ||
      !["failed", "needs_verification"].includes(job.status)
    )
      throw new ProvisionError("بررسی این انتشار در حساب فعلی مجاز نیست.");
    const r = await this.liara.call(
      `/v1/projects/${encodeURIComponent(job.appName)}/releases?page=1&count=20`,
    );
    if (r.currentRelease !== job.releaseId)
      throw new ProvisionError(
        "نسخهٔ موردنظر هنوز فعال نشده است؛ لاگ ساخت را بررسی و کمی بعد دوباره امتحان کنید.",
      );
    const url = `https://${job.appName}.liara.run`,
      input = quote.input;
    for (let n = 0; n < 2; n++) {
      if (n) await this.sleep(5000);
      if (
        !(await this.probe(url + input.healthPath, false)) ||
        (input.businessPath &&
          !(await this.probe(url + input.businessPath, true)))
      )
        throw new ProvisionError(
          "نسخه فعال است اما سلامت و مسیر کسب‌وکار هنوز تأیید نشده‌اند.",
        );
    }
    job.status = input.businessPath ? "completed" : "needs_verification";
    job.error = undefined;
    job.errorCode = undefined;
    job.nextStep = undefined;
    job.verification = input.businessPath
      ? "نسخهٔ درست فعال است؛ سلامت و نوشتن/خواندن آزمایشی دو بار تأیید شد."
      : "پاسخ سایت تأیید شد؛ عملیات اصلی تنظیم نشده است.";
    this.step(job, "verify", "done", job.verification);
    Object.assign(config, {
      appId: job.appName,
      healthUrl: url + input.healthPath,
      businessUrl: input.businessPath ? url + input.businessPath : "",
      databaseId: job.resources.find((r) => r.kind === "database")?.id || "",
    });
    this.persistManaged({
      appId: config.appId,
      healthUrl: config.healthUrl,
      businessUrl: config.businessUrl,
      databaseId: config.databaseId,
      secretJobId: job.id,
    });
    this.db.audit(
      "deployment_verified",
      "نتیجهٔ انتشار پس از آماده‌شدن ابر تأیید شد",
      job.id,
    );
    this.engine.emit();
    return job;
  }
  async buildLogs(id: string) {
    const job = this.get(id),
      quote = this.vault.get<PrivateQuote>(`quote:${id}`);
    if (
      !quote ||
      quote.account !== this.account() ||
      quote.scopeDigest !== scope(job) ||
      !job.releaseId ||
      job.mode !== "live"
    )
      throw new ProvisionError("لاگ این انتشار در حساب فعلی در دسترس نیست.");
    registerSecrets(
      Object.values(
        this.vault.get<Record<string, string>>(`app-env:${id}`) || {},
      ),
    );
    let since = "",
      lines: string[] = [];
    for (let n = 0; n < 5; n++) {
      const data = await this.liara.call(
        `/v2/releases/${encodeURIComponent(job.releaseId)}/build-logs${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      );
      const output = Array.isArray(data.buildOutput) ? data.buildOutput : [];
      lines.push(
        ...output.map((o: any) => `${o.createdAt || ""} ${o.line || ""}`),
      );
      if (!output.length) break;
      const next = output[output.length - 1]?.createdAt;
      if (!next || next === since) break;
      since = next;
    }
    return { text: (await import("./security.ts")).redact(lines.join("\n")) };
  }
  private resource(job: ProvisionJob, kind: string, id: string, name: string) {
    job.resources.push({ kind, id, name });
    this.db.audit(
      "resource_created",
      `سرویس ${name} ایجاد شد`,
      `${job.id}; ${kind}; ${id}`,
    );
    this.save(job);
  }
  private async execute(job: ProvisionJob, quote: PrivateQuote) {
    const { input } = quote;
    const demo = job.mode === "demo";
    try {
      let project;
      try {
        project = new Projects(this.db).verify(job.projectId, job.sourceHash).p;
      } catch {
        throw new ProvisionError(
          "سورس پروژه با نسخهٔ تأییدشده یکسان نیست؛ دوباره آن را تحلیل و هزینه را تأیید کنید.",
        );
      }
      await this.assertPrices(quote);
      if (quote.resumeDeployment) {
        await this.validateContinuation(job, quote);
      } else {
        let networkId = input.networkId;
        this.step(job, "network", "running");
        if (!networkId) {
          if (demo) networkId = `demo-network-${job.id}`;
          else {
            await this.liara.call("/v1/networks", "POST", {
              networkName: `${input.appName}-net`,
            });
            const networks = await this.liara.call("/v1/networks");
            networkId = networks.networks?.find(
              (n: any) => n.name === `${input.appName}-net`,
            )?._id;
            if (!networkId)
              throw new ProvisionError(
                "شبکه ایجاد شد اما شناسهٔ آن قابل تأیید نیست.",
              );
          }
          this.resource(job, "network", networkId, `${input.appName}-net`);
        }
        this.step(
          job,
          "network",
          "done",
          demo
            ? "شبیه‌سازی؛ شبکهٔ واقعی ساخته نشد"
            : "شبکهٔ مشترک خصوصی تأیید شد",
        );
        this.step(job, "app", "running");
        const { app: appPlan } = await this.assertPrices(quote);
        if (!demo) {
          // Recheck immediately before create. Never mutate a pre-existing app with the same name.
          if ((await this.liara.apps()).some((a) => a.id === input.appName))
            throw new ProvisionError(
              "نام برنامه در این فاصله استفاده شده؛ برنامهٔ موجود تغییر نکرد.",
            );
          await this.liara.call("/v1/projects", "POST", {
            name: input.appName,
            planID: appPlan.planId,
            bundlePlanID: appPlan.bundleId,
            platform: project.platform,
            network: networkId,
            readOnlyRootFilesystem: false,
          });
          this.resource(job, "app", input.appName, input.appName);
          const details = await this.liara.call(
            `/v1/projects/${encodeURIComponent(input.appName)}`,
          );
          if (
            details.project?.project_id !== input.appName ||
            details.project?.type !== project.platform
          )
            throw new ProvisionError(
              "ساخت برنامه ارسال شد اما مشخصات آن قابل تأیید نیست.",
            );
          if (details.project.defaultSubdomain === false) {
            if (!details.project._id)
              throw new ProvisionError(
                "شناسهٔ لازم برای فعال‌سازی آدرس سایت دریافت نشد.",
              );
            await this.liara.call(
              `/v1/projects/${encodeURIComponent(details.project._id)}/default-subdomain/enable`,
              "POST",
            );
          }
        }
        if (demo) this.resource(job, "app", input.appName, input.appName);
        // This permission only covers the exact app the user approved and we just created.
        if (!demo) {
          config.allowedApps = [
            ...new Set([...config.allowedApps, input.appName]),
          ];
          this.persistManaged({ appId: input.appName });
        }
        this.step(
          job,
          "app",
          "done",
          demo
            ? "شبیه‌سازی؛ برنامهٔ واقعی ساخته نشد"
            : "برنامه با پلتفرم و پلن تأییدشده ایجاد شد",
        );
        const variables: Record<string, string> = { ...input.env };
        for (const [i, database] of input.databases.entries()) {
          this.step(job, `db-${i}`, "running");
          const { databases: plans } = await this.assertPrices(quote);
          let databaseId = `demo-db-${job.id}-${i}`;
          let details: any;
          if (demo)
            details = {
              hostname: database.name,
              root_password: `demo-only-${randomUUID()}`,
              username: "root",
              dbName: database.type === "postgres" ? "postgres" : "app",
            };
          else {
            const result = await this.liara.call("/v1/databases", "POST", {
              hostname: database.name,
              type: database.type,
              version: database.version,
              planID: plans[i].planId,
              bundlePlanID: plans[i].bundleId,
              publicNetwork: false,
              network: networkId,
            });
            if (typeof result.databaseID !== "string" || !result.databaseID)
              throw new ProvisionError(
                "ساخت دیتابیس ارسال شد ولی شناسه دریافت نشد؛ برای جلوگیری از ساخت تکراری متوقف شد.",
              );
            databaseId = result.databaseID;
          }
          this.resource(job, "database", databaseId, database.name);
          if (!demo)
            for (let attempt = 0; attempt < 60; attempt++) {
              details = (
                await this.liara.call(
                  `/v1/databases/${encodeURIComponent(databaseId)}`,
                )
              ).database;
              if (
                details?.hostname !== database.name ||
                details?.type !== database.type
              )
                throw new ProvisionError(
                  "مشخصات دیتابیس ایجادشده با پیشنهاد تأییدشده یکسان نیست.",
                );
              if (["failed", "error"].includes(details.status))
                throw new ProvisionError("آماده‌سازی دیتابیس ناموفق بود.");
              if (
                details.root_password &&
                ["ready", "running", "active", "started"].includes(
                  String(details.status).toLowerCase(),
                )
              )
                break;
              details = undefined;
              await this.sleep(5000);
            }
          if (!details)
            throw new ProvisionError(
              "آماده‌شدن دیتابیس در زمان مجاز تأیید نشد؛ ساخت دوباره انجام نمی‌شود.",
            );
          const values = connectionValues(details, database);
          for (const [env, part] of Object.entries(database.bindings))
            variables[env] = values[part];
          this.step(
            job,
            `db-${i}`,
            "done",
            demo
              ? "اتصال نمایشی آماده شد"
              : "دیتابیس خصوصی آماده و اطلاعات اتصال دریافت شد",
          );
        }
        registerSecrets(Object.values(variables));
        this.step(job, "env", "running");
        if (!demo) {
          const details = await this.liara.call(
            `/v1/projects/${encodeURIComponent(input.appName)}`,
          );
          if (!Array.isArray(details.project?.envs))
            throw new ProvisionError(
              "تنظیمات فعلی برنامه قابل خواندن نیست؛ برای جلوگیری از حذف تنظیمات، تغییری ارسال نشد.",
            );
          const existing: Record<string, string> = {};
          for (const env of details.project.envs) {
            if (
              typeof env.key !== "string" ||
              typeof env.value !== "string" ||
              env.encrypted ||
              /^\*+$/.test(env.value)
            )
              throw new ProvisionError(
                "مقدار یکی از تنظیمات موجود قابل حفظ نیست؛ تغییری ارسال نشد.",
              );
            existing[env.key] = env.value;
          }
          const merged = { ...existing, ...variables };
          registerSecrets(Object.values(merged));
          this.vault.put(`app-env:${job.id}`, merged);
          await this.liara.call("/v1/projects/update-envs", "POST", {
            project: input.appName,
            variables: Object.entries(merged).map(([key, value]) => ({
              key,
              value,
            })),
          });
          const updated = await this.liara.call(
            `/v1/projects/${encodeURIComponent(input.appName)}`,
          );
          const keys = new Set(updated.project?.envs?.map((v: any) => v.key));
          if (Object.keys(merged).some((k) => !keys.has(k)))
            throw new ProvisionError(
              "ثبت کامل نام تنظیمات تأیید نشد؛ انتشار متوقف شد.",
            );
        }
        if (demo) this.vault.put(`app-env:${job.id}`, variables);
        if (!demo) this.persistManaged({ secretJobId: job.id });
        this.step(
          job,
          "env",
          "done",
          "مقادیر در گزارش و گفتگو نمایش داده نمی‌شوند",
        );
      }
      this.step(job, "deploy", "running");
      const archive = await new Projects(this.db).archive(
        job.projectId,
        job.sourceHash,
      );
      if (demo) {
        await this.sleep(250);
        this.step(
          job,
          "deploy",
          "done",
          "بستهٔ واقعی ساخته شد؛ ارسال به ابر انجام نشد",
        );
        this.step(job, "verify", "running");
        this.step(
          job,
          "verify",
          "done",
          "صرفاً پایان پیش‌نمایش؛ سلامت پروژه در ابر آزمایش نشده",
        );
        job.status = "completed";
        job.verification =
          "پیش‌نمایش کامل شد؛ ساخت سرویس، هزینه و دیپلوی ابری شبیه‌سازی شدند.";
      } else {
        const result = await this.liara.deploy(input.appName, archive.buffer, {
          port: project.port,
          type: project.platform,
        });
        if (!result.releaseID)
          throw new ProvisionError(
            "انتشار ارسال شد اما شناسهٔ نسخه دریافت نشد؛ نتیجه نامشخص است.",
          );
        job.releaseId = String(result.releaseID);
        this.step(job, "deploy", "done", `شناسهٔ نسخه ${job.releaseId}`);
        const url = `https://${input.appName}.liara.run`;
        job.url = url;
        this.step(job, "verify", "running");
        let consecutive = 0;
        for (let attempt = 0; attempt < 120; attempt++) {
          await this.sleep(5000);
          const releases = await this.liara.call(
            `/v1/projects/${encodeURIComponent(input.appName)}/releases?page=1&count=20`,
          );
          const release = releases.releases?.find(
            (r: any) => r._id === job.releaseId,
          );
          if (
            release &&
            ["FAILED", "ERROR", "TIMEDOUT", "CANCELED", "UNHEALTHY"].includes(
              String(release.state).toUpperCase(),
            )
          )
            throw new ProvisionError(
              "ساخت نسخه در لیارا ناموفق شد؛ لاگ ساخت را بررسی کنید.",
            );
          if (releases.currentRelease !== job.releaseId) continue;
          const [health, business] = await Promise.all([
            this.probe(url + input.healthPath, false),
            input.businessPath
              ? this.probe(url + input.businessPath, true)
              : Promise.resolve(true),
          ]);
          consecutive = health && business ? consecutive + 1 : 0;
          if (consecutive >= 2) break;
        }
        if (consecutive < 2)
          throw new ProvisionError(
            "سلامت و مسیر اصلی کسب‌وکار دو بار متوالی تأیید نشد؛ سرویس‌ها باقی مانده‌اند و نیاز به بررسی دارند.",
          );
        this.step(
          job,
          "verify",
          "done",
          input.businessPath
            ? "نسخهٔ درست فعال است؛ سلامت و مسیر کسب‌وکار دو بار موفق بودند"
            : "نسخهٔ درست فعال است و سایت پاسخ می‌دهد؛ عملیات اصلی هنوز آزمایش نشده",
        );
        job.status = input.businessPath ? "completed" : "needs_verification";
        job.verification = input.businessPath
          ? "انتشار و کارکرد سایت تأیید شد."
          : "انتشار و پاسخ سایت تأیید شد؛ بررسی مستقل عملیات اصلی کسب‌وکار هنوز تنظیم نشده است.";
        if (!input.businessPath) {
          job.nextStep =
            "برای بررسی عمیق‌تر، مسیر تست عملکرد برنامه را در تنظیمات همین جریان وارد کنید. پاسخ سایت به‌تنهایی اثبات کارکرد عملیات کسب‌وکار نیست.";
          this.engine.updateSettings({ monitoring: false });
        }
        config.appId = input.appName;
        config.healthUrl = url + input.healthPath;
        config.businessUrl = input.businessPath ? url + input.businessPath : "";
        config.databaseId =
          job.resources.find((r) => r.kind === "database")?.id || "";
        this.persistManaged({
          appId: config.appId,
          healthUrl: config.healthUrl,
          businessUrl: config.businessUrl,
          databaseId: config.databaseId,
        });
      }
      this.save(job);
      this.db.audit(
        "provision_completed",
        demo
          ? "پیش‌نمایش راه‌اندازی کامل شد"
          : "زیرساخت ایجاد و نتیجهٔ انتشار تأیید شد",
        job.id,
      );
    } catch (e) {
      // Never forward raw provider errors or credential payloads into UI, LLM or audit.
      const known = (e as Error).message;
      job.error =
        e instanceof ProvisionError || e instanceof LiaraError
          ? known
          : "ارتباط یا عملیات زیرساخت کامل نشد؛ نتیجهٔ مرحلهٔ آخر نیاز به بررسی دارد.";
      job.errorCode =
        e instanceof LiaraError && e.status === 402
          ? "payment_required"
          : e instanceof LiaraError &&
              e.status === 400 &&
              e.operation === "source_upload"
            ? "source_rejected"
            : "provider_error";
      job.status = "failed";
      job.nextStep =
        "مراحل و شناسهٔ منابع ساخته‌شده در همین صفحه ثبت شده‌اند. عملیات خودکار تکرار یا سرویس‌ها حذف نمی‌شوند؛ منابع ساخته‌شده تا توقف/حذف ممکن است هزینه داشته باشند. برای بررسی بیشتر از گفتگو و لاگ سرویس استفاده کنید.";
      if (
        job.errorCode === "payment_required" &&
        !job.resources.some((r) => r.kind !== "network")
      )
        job.nextStep =
          "هیچ برنامه یا دیتابیسی ساخته نشده است. پس از شارژ حساب، «بررسی دوبارهٔ هزینه» را بزنید؛ تنظیمات محرمانه حفظ می‌شوند و شبکهٔ قبلی دوباره ساخته نمی‌شود. برداشت بانکی در همراه انجام نمی‌شود.";
      for (const step of job.steps)
        if (step.status === "running") {
          step.status = "failed";
          step.detail = job.error;
        }
      this.save(job);
      this.db.audit(
        "provision_failed",
        "راه‌اندازی به نتیجهٔ تأییدشده نرسید",
        `${job.id}; failed step=${job.steps.find((s) => s.status === "failed")?.key}`,
      );
    }
  }
  private persistManaged(values: Record<string, string>) {
    const previous =
      this.vault.get<Record<string, any>>(`managed:${this.account()}`) || {};
    this.vault.put(`managed:${this.account()}`, {
      ...previous,
      ...values,
      allowedApps: config.allowedApps,
    });
  }
  private async probe(url: string, business: boolean) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return business
        ? data?.ok === true
        : data?.ok !== false && data?.healthy !== false;
    } catch {
      return false;
    }
  }
}
