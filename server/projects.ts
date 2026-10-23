import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import * as tar from "tar";
import { config } from "./config.ts";
import type { Store } from "./store.ts";
import type { ProjectReport } from "../src/project-types.ts";

const MAX_ZIP = 20 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 4000;
const ignored =
  /(^|\/)(node_modules|\.git|\.next|vendor|__MACOSX|\.venv|venv|coverage)(\/|$)/i;
const secret =
  /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|id_rsa|credentials(?:\.json)?|\.npmrc|\.pypirc|\.netrc|\.gitconfig)$/i;
const template = /(^|\/)\.env\.(example|sample|template)$/i;
const sourceExt =
  /\.(?:[cm]?[jt]sx?|py|php|go|rb|json|toml|ya?ml|prisma|txt|html)$/i;
const manifest =
  /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|composer\.json|go\.mod|Dockerfile|index\.html)$/;
function safePath(name: string) {
  if (
    !name ||
    name.length > 240 ||
    /[\\\x00-\x1f:]/.test(name) ||
    name.startsWith("/") ||
    name
      .split("/")
      .some(
        (p) =>
          p === ".." ||
          p === "." ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
      )
  )
    throw new Error("مسیر ناامن در ZIP؛ فایل را دوباره از سورس پروژه بسازید.");
  return name;
}
export async function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  if (!buffer.length || buffer.length > MAX_ZIP)
    throw new Error("حجم ZIP باید حداکثر ۲۰ مگابایت باشد.");
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error("فایل ZIP معتبر نیست."));
          return;
        }
        const files = new Map<string, Buffer>();
        const seen = new Set<string>();
        let total = 0,
          count = 0;
        let failed = false;
        const fail = (e: Error) => {
          failed = true;
          zip.close();
          reject(e);
        };
        zip.on("error", () => fail(new Error("ZIP خراب یا نامعتبر است.")));
        zip.on("end", () => {
          if (!failed) resolve(files);
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          try {
            const name = safePath(entry.fileName.replace(/\/$/, ""));
            if (
              ++count > MAX_FILES ||
              entry.uncompressedSize > MAX_FILE ||
              (total += entry.uncompressedSize) > MAX_TOTAL
            )
              throw new Error(
                "پروژه بیش از حد بزرگ است؛ پوشه‌های وابستگی و خروجی build را حذف کنید.",
              );
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              throw new Error("لینک و فایل ویژه در ZIP پذیرفته نمی‌شود.");
            const key = name.toLowerCase();
            if (seen.has(key)) throw new Error("ZIP دارای مسیر تکراری است.");
            seen.add(key);
            if (entry.fileName.endsWith("/") || ignored.test(name)) {
              zip.readEntry();
              return;
            }
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                fail(new Error("خواندن ZIP ممکن نشد."));
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on("data", (chunk) => {
                size += chunk.length;
                if (size > MAX_FILE) {
                  stream.destroy();
                  fail(new Error("اندازهٔ فایل نامعتبر است."));
                } else chunks.push(chunk);
              });
              stream.on("error", () =>
                fail(new Error("استخراج ZIP ناموفق بود.")),
              );
              stream.on("end", () => {
                if (!failed) {
                  files.set(name, Buffer.concat(chunks));
                  zip.readEntry();
                }
              });
            });
          } catch (e) {
            fail(e as Error);
          }
        });
        zip.readEntry();
      },
    );
  });
}
export function hashFiles(files: Map<string, Buffer>) {
  const h = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    h.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
    h.update(bytes);
  }
  return h.digest("hex");
}
function json(text: string, file: string): Record<string, any> {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new Error(`ساختار ${file} معتبر نیست.`);
  }
}
export function analyzeFiles(
  input: Map<string, Buffer>,
  options: { root?: string; traffic?: string } = {},
) {
  let files = new Map(input);
  const first = [...files.keys()][0]?.split("/")[0];
  if (first && [...files.keys()].every((n) => n.startsWith(`${first}/`)))
    files = new Map([...files].map(([n, b]) => [n.slice(first.length + 1), b]));
  const candidates = [
    ...new Set(
      [...files.keys()]
        .filter((n) => manifest.test(n))
        .map((n) => path.posix.dirname(n)),
    ),
  ].sort();
  const root =
    options.root?.trim() ||
    (candidates.includes(".")
      ? "."
      : candidates.length === 1
        ? candidates[0]
        : ".");
  if (root !== ".") safePath(root);
  const prefix = root === "." ? "" : `${root}/`;
  const selected = new Map(
    [...files]
      .filter(([n]) => n.startsWith(prefix))
      .map(([n, b]) => [n.slice(prefix.length), b]),
  );
  if (!selected.size) throw new Error("پوشهٔ انتخاب‌شده در پروژه پیدا نشد.");
  const report: Omit<
    ProjectReport,
    "id" | "name" | "source" | "createdAt" | "hash" | "fileCount"
  > = {
    root,
    candidates,
    stack: "نامشخص",
    platform: "",
    port: 3000,
    runtime: "نامشخص",
    build: "",
    start: "",
    evidence: [],
    services: [],
    envNames: [],
    warnings: [],
    blockers: [],
    resources:
      options.traffic === "high"
        ? "شروع با حداقل ۱ CPU و ۲ گیگابایت RAM برای برنامه؛ پس از تست بار تنظیم شود. دیتابیس منابع جداگانه می‌خواهد."
        : "برای شروع کم‌ترافیک، حدود ۰٫۵ CPU و ۵۱۲ مگابایت RAM؛ برنامه‌های SSR یا build سنگین بهتر است با ۱ گیگابایت آغاز شوند. این تخمین است و با پایش اصلاح می‌شود.",
  };
  const text = (name: string) => selected.get(name)?.toString("utf8") || "";
  const evidence = (file: string, finding: string) =>
    report.evidence.push({ file, finding });
  if (candidates.length > 1 && !options.root && !candidates.includes("."))
    report.blockers.push(
      "چند برنامه پیدا شد؛ پوشهٔ برنامه را انتخاب و دوباره تحلیل کنید.",
    );
  let deps: Record<string, string> = {};
  if (selected.has("package.json")) {
    const pkg = json(text("package.json"), "package.json");
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};
    report.stack = deps.next
      ? "Next.js"
      : deps.nuxt
        ? "Nuxt"
        : deps.vite
          ? "Vite / React یا Vue"
          : deps.express
            ? "Node.js / Express"
            : "Node.js";
    report.platform = deps.next ? "next" : "node";
    report.runtime = `Node.js ${String(pkg.engines?.node || "نسخه در package.json مشخص نشده").slice(0, 60)}`;
    report.build = scripts.build
      ? "npm run build"
      : "نیازی در package.json تعریف نشده";
    report.start = scripts.start ? "npm start" : "";
    evidence(
      "package.json",
      `${report.stack}؛ ${Object.keys(pkg.dependencies || {}).length} وابستگی اجرایی؛ build: ${scripts.build ? "دارد" : "ندارد"}، start: ${scripts.start ? "دارد" : "ندارد"}`,
    );
    if (deps.vite && !scripts.start) {
      report.platform = "static";
      report.start = "سرویس فایل‌های dist";
      report.warnings.push(
        "خروجی پیش‌فرض Vite پوشهٔ dist است؛ تنظیم سفارشی build را بررسی کنید.",
      );
    }
    if (!report.start && !selected.has("Dockerfile"))
      report.blockers.push(
        "دستور start تعریف نشده؛ در package.json اسکریپت start اضافه کنید یا Dockerfile بسازید.",
      );
    if (pkg.workspaces)
      report.blockers.push(
        "پروژه workspace است؛ بستهٔ قابل‌انتشار و وابستگی‌های مشترک باید با Dockerfile مشخص شوند.",
      );
    if (selected.has("pnpm-lock.yaml") || selected.has("yarn.lock"))
      report.warnings.push(
        "پروژه از pnpm یا Yarn استفاده می‌کند؛ پشتیبانی builder و دستورهای build را بررسی کنید.",
      );
  } else if (
    selected.has("requirements.txt") ||
    selected.has("pyproject.toml")
  ) {
    const content = text("requirements.txt") + text("pyproject.toml");
    report.stack = /django/i.test(content)
      ? "Django"
      : /fastapi/i.test(content)
        ? "FastAPI"
        : /flask/i.test(content)
          ? "Flask"
          : "Python";
    report.platform = /django/i.test(content) ? "django" : "flask";
    report.runtime = "Python";
    evidence(
      selected.has("requirements.txt") ? "requirements.txt" : "pyproject.toml",
      `وابستگی‌های ${report.stack} شناسایی شدند.`,
    );
    if (!selected.has("Dockerfile"))
      report.blockers.push(
        "برای تعیین دقیق دستور اجرای Python، یک Dockerfile با CMD و EXPOSE اضافه کنید.",
      );
  } else if (selected.has("composer.json")) {
    deps = json(text("composer.json"), "composer.json").require || {};
    report.stack = deps["laravel/framework"] ? "Laravel" : "PHP";
    report.platform = "php";
    report.runtime = "PHP";
    evidence("composer.json", `پروژهٔ ${report.stack} شناسایی شد.`);
  } else if (selected.has("index.html")) {
    report.stack = "سایت استاتیک";
    report.platform = "static";
    report.runtime = "Static";
    report.start = "سرویس فایل‌های HTML";
    evidence("index.html", "صفحهٔ ورودی سایت استاتیک وجود دارد.");
  }
  if (selected.has("Dockerfile")) {
    const docker = text("Dockerfile");
    report.platform = "docker";
    if (report.stack === "نامشخص") report.stack = "برنامهٔ Docker";
    const port = docker.match(/^\s*EXPOSE\s+(\d+)/im);
    if (port) report.port = Number(port[1]);
    evidence(
      "Dockerfile",
      `بسته‌بندی Docker؛ ${port ? `پورت ${port[1]}` : "پورت باید در مرحلهٔ انتشار تأیید شود"}`,
    );
    report.start = /^\s*(CMD|ENTRYPOINT)\s+(.+)$/im.test(docker)
      ? "طبق Dockerfile"
      : report.start;
    if (!report.start)
      report.blockers.push(
        "Dockerfile دستور CMD یا ENTRYPOINT ندارد؛ دستور اجرای برنامه مشخص نیست.",
      );
    if (/^\s*(?:ADD|COPY).*\.env\b/im.test(docker))
      report.warnings.push(
        "Dockerfile به فایل env اشاره می‌کند؛ فایل‌های محرمانه حذف می‌شوند و باید از تنظیمات امن لیارا تأمین شوند.",
      );
    if (/^\s*ADD\s+https?:/im.test(docker))
      report.warnings.push(
        "Dockerfile منبع خارجی دریافت می‌کند؛ تنها کدی را منتشر کنید که به آن اعتماد دارید.",
      );
  }
  const envNames = new Set<string>();
  const signatures: [string, RegExp][] = [
    ["PostgreSQL", /\b(pg|postgres|psycopg2?|asyncpg)\b|postgresql:/i],
    ["MySQL", /\b(mysql2?|pymysql)\b|mysql:/i],
    ["MongoDB", /\b(mongoose|mongodb|pymongo)\b|mongodb:/i],
    ["Redis", /\b(ioredis|redis|bullmq)\b|redis:/i],
    ["فضای پایدار SQLite", /\b(better-sqlite3|sqlite3?|node:sqlite)\b/i],
    ["ذخیره‌سازی فایل", /@aws-sdk\/client-s3|\bboto3\b|S3_BUCKET/i],
    ["ارسال ایمیل", /\bnodemailer\b|SMTP_HOST/i],
  ];
  const found = new Map<string, string>();
  let scanBytes = 0;
  for (const [name, bytes] of selected) {
    if (
      bytes.length > 512 * 1024 ||
      (scanBytes += bytes.length) > 12 * 1024 * 1024
    )
      continue;
    if (!sourceExt.test(name) && !secret.test(name) && name !== "Dockerfile")
      continue;
    // Credential files only contribute variable NAMES, never values or raw text.
    const content = bytes.toString("utf8");
    const healthRoute = content.match(
      /\.get\(\s*['"](\/(?:health|healthz|api\/health))['"]/,
    );
    const businessRoute = content.match(
      /\.get\(\s*['"](\/api\/[a-zA-Z0-9_/-]+\/(?:check|verify))['"]/,
    );
    if (healthRoute || businessRoute)
      report.checks = {
        healthPath: healthRoute?.[1] || report.checks?.healthPath || "/",
        businessPath: businessRoute?.[1] || report.checks?.businessPath || "",
      };
    if (secret.test(name)) {
      for (const match of content.matchAll(/^\s*([A-Z][A-Z0-9_]{1,79})\s*=/gm))
        envNames.add(match[1]);
      continue;
    }
    if (report.platform === "node" && /\.[cm]?[jt]s$/.test(name)) {
      const listen = content.match(
        /\.listen\(\s*(?:(?:process\.env\.PORT\s*\|\|\s*)?)(\d{2,5})\b/,
      );
      if (listen) {
        report.port = Number(listen[1]);
        evidence(name, `پورت ${listen[1]} در دستور listen`);
      }
    }
    for (const match of content.matchAll(
      /(?:process\.env\.([A-Z][A-Z0-9_]{1,79})|process\.env\[['"]([A-Z][A-Z0-9_]{1,79})['"]\]|(?:getenv|environ\.get|env)\(\s*['"]([A-Z][A-Z0-9_]{1,79})['"]|environ\[['"]([A-Z][A-Z0-9_]{1,79})['"]\])/g,
    ))
      envNames.add(match[1] || match[2] || match[3] || match[4]);
    if (!/lock\b|package-lock|yarn\.lock/.test(name))
      for (const [label, regex] of signatures)
        if (!found.has(label) && regex.test(content)) found.set(label, name);
  }
  for (const [name, file] of found) {
    report.services.push({
      name,
      reason: `نشانهٔ استفاده در ${file}؛ پیش از انتشار، سرویس موجود یا اتصال مناسب را تأمین کنید.`,
      required: true,
    });
    evidence(file, `نشانهٔ وابستگی به ${name}`);
  }
  report.envNames = [...envNames]
    .filter((n) => !["PORT", "NODE_ENV"].includes(n))
    .sort()
    .slice(0, 80);
  report.warnings.push(
    "وجود کتابخانه، استفادهٔ قطعی در زمان اجرا را ثابت نمی‌کند؛ سرویس‌های پیشنهادی را با تنظیمات واقعی تطبیق دهید.",
  );
  if (!report.platform)
    report.blockers.push(
      "روش اجرای قابل‌اتکایی پیدا نشد؛ Dockerfile یا فایل وابستگی برنامه را در پوشهٔ درست اضافه کنید.",
    );
  if (found.has("فضای پایدار SQLite"))
    report.warnings.push(
      "SQLite به دیسک پایدار نیاز دارد؛ فایل دیتابیس از بستهٔ انتشار حذف می‌شود.",
    );
  if (selected.has("liara.json")) {
    const settings = json(text("liara.json"), "liara.json");
    if (
      Number.isInteger(settings.port) &&
      settings.port >= 1 &&
      settings.port <= 65535
    ) {
      report.port = settings.port;
      evidence("liara.json", `پورت انتشار ${settings.port}`);
    }
  }
  if (report.port < 1 || report.port > 65535)
    report.blockers.push("پورت Dockerfile معتبر نیست.");
  if (["static", "php"].includes(report.platform)) report.port = 80;
  if (report.platform === "static")
    report.resources =
      "سایت فایل‌های ثابت دارد؛ برای شروع به سرویس استاتیک سبک نیاز دارید و پردازش دائمی برنامه لازم نیست. حجم فایل‌ها و ترافیک تعیین‌کنندهٔ منابع نهایی‌اند.";
  else if (["Next.js", "Nuxt"].includes(report.stack))
    report.resources =
      options.traffic === "high"
        ? "رندر سمت سرور شناسایی شد؛ نقطهٔ شروع پیشنهادی ۱ CPU و ۲ گیگابایت RAM، سپس تست بار و پایش."
        : "رندر سمت سرور شناسایی شد؛ برای شروع کم‌ترافیک ۱ CPU و حدود ۱ گیگابایت RAM پیشنهاد اولیه است. هنگام build ممکن است منابع بیشتری نیاز باشد.";
  if (report.platform === "static" && selected.has("package.json"))
    report.blockers.push(
      "پروژهٔ فرانت‌اند به build نیاز دارد؛ برای انتشار مطمئن Dockerfile بسازید که خروجی build را سرو کند.",
    );
  if (report.runtime.startsWith("Python") && report.platform !== "docker")
    report.blockers.push("برای انتشار Python یک Dockerfile کامل لازم است.");
  const clean = new Map(
    [...selected].filter(
      ([n]) =>
        !secret.test(n) &&
        !/\.(sqlite(?:3)?|db)(?:-(?:wal|shm))?$|\.(zip|tar|gz)$/i.test(n),
    ),
  );
  const excluded = selected.size - clean.size;
  if (excluded)
    report.warnings.push(
      `${excluded} فایل شامل تنظیمات محرمانه، قالب env یا آرشیو/دیتابیس از انتشار کنار گذاشته شد.`,
    );
  return { files: clean, report };
}

async function bounded(response: Response) {
  if (!response.ok)
    throw new Error(
      `دریافت GitHub ناموفق بود (${response.status})؛ آدرس و دسترسی مخزن را بررسی کنید.`,
    );
  if (Number(response.headers.get("content-length")) > MAX_ZIP)
    throw new Error("مخزن بیش از ۲۰ مگابایت است؛ ZIP سبک‌تر آپلود کنید.");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ZIP) throw new Error("مخزن بیش از ۲۰ مگابایت است.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export class Projects {
  constructor(private db: Store) {}
  base(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error("شناسهٔ پروژه نامعتبر است.");
    return path.join(config.dataDir, config.mode, "projects", id);
  }
  get(id: string) {
    const p = this.db.get<ProjectReport>("projects", id);
    if (!p) throw new Error("پروژه پیدا نشد؛ دوباره دریافت کنید.");
    return p;
  }
  async github(url: string, ref = "", root = "", traffic = "low") {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    );
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !match
    )
      throw new Error(
        "آدرس را به‌شکل https://github.com/owner/repository وارد کنید.",
      );
    const repo = `${match[1]}/${match[2]}`;
    const token = process.env.GITHUB_TOKEN || "";
    const headers = {
      "User-Agent": "Hamrah",
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const commit = await fetch(
      `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref || "HEAD")}`,
      { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
    );
    if (!commit.ok)
      throw new Error(
        `دسترسی به مخزن ممکن نشد (${commit.status}). برای مخزن خصوصی GITHUB_TOKEN را در .env تنظیم کنید یا ZIP بدهید.`,
      );
    const { sha } = await commit.json();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("نسخهٔ مخزن مشخص نشد.");
    const response = await fetch(
      `https://api.github.com/repos/${repo}/zipball/${sha}`,
      { headers, redirect: "manual", signal: AbortSignal.timeout(30000) },
    );
    let archive: Buffer;
    if ([301, 302, 307].includes(response.status)) {
      const location = new URL(response.headers.get("location") || "");
      if (
        location.protocol !== "https:" ||
        location.hostname !== "codeload.github.com" ||
        location.port ||
        location.username ||
        location.password
      )
        throw new Error("مقصد دریافت مخزن معتبر نیست.");
      // Never forward the GitHub token to the redirected archive host.
      archive = await bounded(
        await fetch(location, {
          redirect: "error",
          signal: AbortSignal.timeout(45000),
        }),
      );
    } else archive = await bounded(response);
    return this.ingest(archive, {
      name: match[2],
      source: "github",
      repository: `https://github.com/${repo}`,
      revision: sha,
      root,
      traffic,
    });
  }
  async ingest(
    buffer: Buffer,
    meta: {
      name: string;
      source: "zip" | "github";
      repository?: string;
      revision?: string;
      root?: string;
      traffic?: string;
    },
  ) {
    if (this.db.list("projects").length >= 30)
      throw new Error(
        "سقف نگهداری ۳۰ پروژه پر شده؛ برای واردکردن پروژهٔ جدید، آرشیوهای قبلی را با مدیریت سرور پاک‌سازی کنید.",
      );
    const all = await readZip(buffer);
    const { files, report } = analyzeFiles(all, meta);
    if (!files.size) throw new Error("فایل قابل‌انتشاری در پروژه پیدا نشد.");
    const id = randomUUID();
    const dir = this.base(id);
    mkdirSync(path.join(dir, "source"), { recursive: true });
    try {
      for (const [name, bytes] of files) {
        const dest = path.join(dir, "source", name);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, bytes);
      }
      const names = [...files.keys()].sort();
      writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(names));
      const result: ProjectReport = {
        ...report,
        traffic: meta.traffic === "high" ? "high" : "low",
        id,
        name:
          meta.name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80) ||
          "پروژهٔ شما",
        source: meta.source,
        repository: meta.repository,
        revision: meta.revision,
        createdAt: new Date().toISOString(),
        hash: hashFiles(files),
        fileCount: files.size,
      };
      this.db.put("projects", result);
      this.db.set("activeProjectId", id);
      this.db.audit(
        "project_analyzed",
        "پروژهٔ واقعی تحلیل شد",
        `${result.name}; ${id}; hash=${result.hash}; ${result.stack}`,
      );
      return result;
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }
  verify(id: string, expected: string) {
    const p = this.get(id);
    const dir = this.base(id);
    const names: string[] = JSON.parse(
      readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const files = new Map(
      names.map((n) => [
        safePath(n),
        readFileSync(path.join(dir, "source", safePath(n))),
      ]),
    );
    if (p.hash !== expected || hashFiles(files) !== expected)
      throw new Error(
        "سورس از زمان تحلیل تغییر کرده است؛ پروژه را دوباره تحلیل و تأیید کنید.",
      );
    if (p.blockers.length) throw new Error(p.blockers.join(" "));
    return { p, files };
  }
  async archive(id: string, expected: string) {
    const { p, files } = this.verify(id, expected);
    const dir = this.base(id);
    const target = path.join(dir, "source.tar.gz");
    await tar.c(
      {
        gzip: true,
        file: target,
        cwd: path.join(dir, "source"),
        portable: true,
        follow: false,
      },
      [...files.keys()].sort(),
    );
    return { report: p, buffer: readFileSync(target) };
  }
}
