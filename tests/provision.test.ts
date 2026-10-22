import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { config } from "../server/config.ts";
import { Store } from "../server/store.ts";
import { Engine } from "../server/engine.ts";
import { Liara, LiaraError } from "../server/liara.ts";
import { Vault } from "../server/vault.ts";
import { Projects, hashFiles } from "../server/projects.ts";
import {
  Provisioner,
  parseCatalog,
  connectionValues,
} from "../server/provision.ts";
import type { ProjectReport } from "../src/project-types.ts";
import type { ProvisionInput } from "../src/provision-types.ts";

const plans = {
  projects: {
    small: {
      available: true,
      region: "iran",
      price: 10,
      RAM: { amount: 1 },
      CPU: { amount: 1 },
      volume: 10,
    },
  },
  databases: {
    db: {
      available: true,
      price: 5,
      RAM: { amount: 0.5 },
      CPU: { amount: 0.5 },
      volume: 10,
      supports: ["postgres", "redis"],
    },
  },
  projectBundlePlans: {
    small: { free: { available: true, displayPrice: 100 } },
  },
  databaseBundlePlans: { db: { free: { available: true, displayPrice: 50 } } },
};
const me = () => ({
  plans: structuredClone(plans),
  databaseVersions: { postgres: [{ value: "16" }], redis: [{ value: "7.2" }] },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(p: Provisioner) {
  for (let i = 0; i < 200 && p.busy; i++) await sleep(10);
  assert.equal(p.busy, false);
}
function setup(mode: "demo" | "live" = "live") {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-provision-"));
  Object.assign(config, {
    dataDir: dir,
    mode,
    liaraToken: "test-account-token-very-secret",
    appId: "",
    allowedApps: [],
    teamId: "",
    healthUrl: "",
    businessUrl: "",
  });
  const db = new Store(path.join(dir, "records")),
    engine = new Engine(db),
    vault = new Vault(dir);
  const projects = new Projects(db),
    id = randomUUID();
  const files = new Map([
    [
      "package.json",
      Buffer.from(
        '{"scripts":{"start":"node server.js"},"dependencies":{"pg":"8"}}',
      ),
    ],
    ["server.js", Buffer.from("console.log('SAFE_PROJECT_SOURCE');")],
  ]);
  const root = path.join(projects.base(id), "source");
  mkdirSync(root, { recursive: true });
  for (const [name, bytes] of files)
    writeFileSync(path.join(root, name), bytes);
  writeFileSync(
    path.join(projects.base(id), "manifest.json"),
    JSON.stringify([...files.keys()]),
  );
  const project: ProjectReport = {
    id,
    name: "shop",
    source: "zip",
    hash: hashFiles(files),
    fileCount: files.size,
    createdAt: new Date().toISOString(),
    root: ".",
    candidates: ["."],
    stack: "Node.js",
    platform: "node",
    port: 3000,
    runtime: "Node.js 22",
    build: "",
    start: "npm start",
    evidence: [],
    services: [{ name: "PostgreSQL", reason: "pg dependency", required: true }],
    envNames: ["DATABASE_URL", "SERVICE_KEY"],
    warnings: [],
    blockers: [],
    resources: "small",
  };
  db.put("projects", project);
  const calls: { endpoint: string; method: string; body: any }[] = [];
  let appCreated = false,
    dbCreated = false,
    envs = [{ key: "DEFAULT_VALUE", value: "keep-this" }],
    priceChange = false,
    failDatabase = false,
    failPayment = false,
    failSource = false,
    releaseSubmitted = false;
  const liara = new Liara();
  liara.call = async (endpoint, method = "GET", body?: any) => {
    calls.push({ endpoint, method, body });
    if (endpoint === "/v1/me") {
      const account = me();
      if (priceChange) account.plans.projects.small.price++;
      return account;
    }
    if (endpoint === "/v1/networks")
      return { networks: [{ _id: "private-network", name: "shared" }] };
    if (endpoint === "/v1/projects" && method === "GET")
      return {
        projects: appCreated ? [{ project_id: "new-shop", type: "node" }] : [],
      };
    if (endpoint === "/v1/projects" && method === "POST") {
      if (failPayment) throw new LiaraError(402);
      appCreated = true;
      return {};
    }
    if (endpoint === "/v1/projects/new-shop")
      return {
        project: {
          _id: "project-internal-id",
          project_id: "new-shop",
          type: "node",
          defaultSubdomain: true,
          envs,
        },
      };
    if (endpoint === "/v1/databases" && method === "GET")
      return { databases: dbCreated ? [{ hostname: "new-db" }] : [] };
    if (endpoint === "/v1/databases" && method === "POST") {
      if (failDatabase) throw new LiaraError(503);
      dbCreated = true;
      return { databaseID: "created-db-id" };
    }
    if (endpoint === "/v1/databases/created-db-id")
      return {
        database: {
          hostname: "new-db",
          type: "postgres",
          status: "ready",
          username: "root",
          root_password: "db-p@ss:/?VERY_PRIVATE",
          internalPort: 5432,
          dbName: "postgres",
        },
      };
    if (endpoint === "/v1/projects/update-envs") {
      envs = body.variables;
      return {};
    }
    if (endpoint.includes("/sources")) {
      if (failSource) throw new LiaraError(400);
      assert.ok(body instanceof FormData);
      assert.ok(body.get("file") instanceof Blob);
      assert.equal((body.get("file") as Blob).type, "application/gzip");
      return { sourceID: "source-id" };
    }
    if (endpoint.endsWith("/releases") && method === "POST") {
      releaseSubmitted = true;
      return { releaseID: "exact-new-release" };
    }
    if (endpoint.includes("/releases?"))
      return {
        currentRelease: releaseSubmitted ? "exact-new-release" : null,
        releases: releaseSubmitted
          ? [{ _id: "exact-new-release", state: "ready" }]
          : [],
      };
    throw new Error(`Unmocked endpoint ${endpoint}`);
  };
  const provision = new Provisioner(db, engine, vault, liara, async () => {});
  const input: ProvisionInput = {
    projectId: id,
    appName: "new-shop",
    appPlan: mode === "live" ? "small/free" : "demo-small/free",
    networkId: mode === "live" ? "private-network" : "",
    databases: [
      {
        type: "postgres",
        name: "new-db",
        plan: mode === "live" ? "db/free" : "demo-db/free",
        version: "16",
        bindings: { DATABASE_URL: "url" },
      },
    ],
    env: { SERVICE_KEY: "user-key-private-very-sensitive" },
    healthPath: "/health",
    businessPath: "/api/orders/check",
  };
  return {
    dir,
    db,
    engine,
    vault,
    project,
    provision,
    input,
    calls,
    get envs() {
      return envs;
    },
    setPriceChange() {
      priceChange = true;
    },
    setDatabaseFailure() {
      failDatabase = true;
    },
    setPaymentFailure() {
      failPayment = true;
    },
    setSourceFailure(value: boolean) {
      failSource = value;
    },
    close() {
      engine.stop();
      db.close();
    },
  };
}

test("catalog uses official resource and feature prices, excludes unknown or unavailable prices", () => {
  const account = me();
  const result = parseCatalog(account, { networks: [] });
  assert.equal(result.appPlans[0].monthly, 7300);
  assert.equal(result.databasePlans[0].monthly, 3650);
  (account.plans.projects.small as any).price = undefined;
  assert.equal(parseCatalog(account, { networks: [] }).appPlans.length, 0);
  assert.throws(() => parseCatalog({}, {}));
});
test("vault ciphertext survives restart and authenticated encryption detects tampering", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-vault-")),
    vault = new Vault(dir);
  vault.put("credentials", { token: "DO_NOT_STORE_ME_IN_PLAINTEXT" });
  const files = readdirSync(path.join(dir, "vault"));
  for (const file of files)
    assert.equal(
      readFileSync(path.join(dir, "vault", file)).includes(
        Buffer.from("DO_NOT_STORE_ME_IN_PLAINTEXT"),
      ),
      false,
    );
  assert.deepEqual(new Vault(dir).get("credentials"), {
    token: "DO_NOT_STORE_ME_IN_PLAINTEXT",
  });
  const encrypted = path.join(
    dir,
    "vault",
    files.find((f) => f.endsWith(".enc"))!,
  );
  const bytes = readFileSync(encrypted);
  bytes[35] ^= 1;
  writeFileSync(encrypted, bytes);
  assert.throws(() => vault.get("credentials"));
});
test("quote does not mutate cloud; approval binds exact inputs and secrets stay out of public memory", async () => {
  const s = setup();
  try {
    const quote = await s.provision.quote(s.input);
    assert.equal(quote.monthly, 10950);
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
    assert.deepEqual(quote.envNames.sort(), ["DATABASE_URL", "SERVICE_KEY"]);
    const records = JSON.stringify({
      jobs: s.db.list("provisionJobs"),
      audit: s.db.auditList(),
      snapshot: s.engine.snapshot(),
    });
    assert.doesNotMatch(records, /user-key-private|db-p@ss/);
    await assert.rejects(() =>
      s.provision.approve(quote.id, "0".repeat(64), true),
    );
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
    await s.provision.approve(quote.id, quote.fingerprint, false);
    assert.equal(s.provision.get(quote.id).status, "rejected");
    await assert.rejects(() =>
      s.provision.approve(quote.id, quote.fingerprint, true),
    );
  } finally {
    s.close();
  }
});
test("fresh pricing and source verification prevent unapproved spending", async () => {
  const s = setup();
  try {
    const quote = await s.provision.quote(s.input);
    s.setPriceChange();
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await settled(s.provision);
    assert.equal(s.provision.get(quote.id).status, "failed");
    assert.match(s.provision.get(quote.id).error!, /تعرفه/);
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
  } finally {
    s.close();
  }
  const changed = setup();
  try {
    const quote = await changed.provision.quote(changed.input);
    writeFileSync(
      path.join(
        new Projects(changed.db).base(changed.project.id),
        "source",
        "server.js",
      ),
      "changed source",
    );
    await changed.provision.approve(quote.id, quote.fingerprint, true);
    await settled(changed.provision);
    assert.equal(changed.provision.get(quote.id).status, "failed");
    assert.equal(
      changed.calls.some((c) => c.method === "POST"),
      false,
    );
  } finally {
    changed.close();
  }
});
test("approved live workflow creates private services, preserves existing env, deploys exact release and verifies outcome", async () => {
  const s = setup(),
    originalFetch = globalThis.fetch;
  let probes = 0;
  globalThis.fetch = async () => {
    probes++;
    return Response.json({ ok: true });
  };
  try {
    const quote = await s.provision.quote(s.input);
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await assert.rejects(() =>
      s.provision.approve(quote.id, quote.fingerprint, true),
    );
    await settled(s.provision);
    const job = s.provision.get(quote.id);
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.releaseId, "exact-new-release");
    assert.equal(probes, 4);
    const createDb = s.calls.find(
      (c) => c.endpoint === "/v1/databases" && c.method === "POST",
    )!;
    assert.equal(createDb.body.publicNetwork, false);
    assert.equal(createDb.body.network, "private-network");
    assert.equal(
      s.calls.filter(
        (c) => c.endpoint === "/v1/projects" && c.method === "POST",
      ).length,
      1,
    );
    const env = Object.fromEntries(s.envs.map((e) => [e.key, e.value]));
    assert.equal(env.DEFAULT_VALUE, "keep-this");
    assert.equal(env.SERVICE_KEY, s.input.env.SERVICE_KEY);
    assert.match(
      env.DATABASE_URL,
      /^postgresql:\/\/root:db-p%40ss%3A%2F%3FVERY_PRIVATE@new-db:5432\/postgres$/,
    );
    assert.equal(config.appId, "new-shop");
    assert.ok(config.allowedApps.includes("new-shop"));
    assert.doesNotMatch(
      JSON.stringify({
        job,
        snapshot: s.engine.snapshot(),
        audit: s.db.auditList(),
      }),
      /user-key-private|db-p@ss|db-p%40ss/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    s.close();
  }
});
test("partial failure retains resource ledger and never repeats creation or deletes resources", async () => {
  const s = setup();
  try {
    s.setDatabaseFailure();
    const quote = await s.provision.quote(s.input);
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await settled(s.provision);
    const job = s.provision.get(quote.id);
    assert.equal(job.status, "failed");
    assert.ok(job.resources.some((r) => r.kind === "app"));
    assert.equal(
      job.steps.find((step) => step.key === "db-0")?.status,
      "failed",
    );
    const before = s.calls.filter((c) => c.method === "POST").length;
    new Provisioner(s.db, s.engine, s.vault);
    assert.equal(s.calls.filter((c) => c.method === "POST").length, before);
    assert.equal(
      s.calls.some((c) => c.method === "DELETE"),
      false,
    );
    await assert.rejects(() =>
      s.provision.approve(job.id, job.fingerprint, true),
    );
  } finally {
    s.close();
  }
});
test("missing business endpoint is explicitly unverified rather than claimed as a healthy business", async () => {
  const s = setup(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true });
  try {
    s.input.businessPath = "";
    const quote = await s.provision.quote(s.input);
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await settled(s.provision);
    assert.equal(s.provision.get(quote.id).status, "needs_verification");
    assert.equal(config.businessUrl, "");
    assert.equal(s.engine.settings().monitoring, false);
  } finally {
    globalThis.fetch = originalFetch;
    s.close();
  }
});
test("public frontend variables cannot receive database secrets and connection passwords are URL encoded", async () => {
  const s = setup();
  try {
    s.input.databases[0].bindings = { NEXT_PUBLIC_DATABASE_URL: "url" };
    await assert.rejects(() => s.provision.quote(s.input), /تنظیم/);
    const values = connectionValues(
      { root_password: "a@:/?", username: "user", dbName: "postgres" },
      s.input.databases[0],
    );
    assert.match(values.url, /a%40%3A%2F%3F@/);
  } finally {
    s.close();
  }
});
test("demo completes the workflow without cloud writes or false live deployment claims", async () => {
  const s = setup("demo");
  try {
    const quote = await s.provision.quote(s.input);
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await settled(s.provision);
    const job = s.provision.get(quote.id);
    assert.equal(job.status, "completed");
    assert.match(job.verification!, /شبیه/);
    assert.equal(job.url, undefined);
    assert.equal(s.calls.length, 0);
  } finally {
    s.close();
  }
});

test("expired or tampered quotes cannot create resources", async () => {
  const s = setup();
  try {
    const quote = await s.provision.quote(s.input);
    s.db.put("provisionJobs", { ...quote, monthly: 1 });
    await assert.rejects(() =>
      s.provision.approve(quote.id, quote.fingerprint, true),
    );
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
    s.db.put("provisionJobs", quote);
    const originalNow = Date.now;
    Date.now = () => Date.parse(quote.expiresAt) + 1;
    try {
      await assert.rejects(
        () => s.provision.approve(quote.id, quote.fingerprint, true),
        /اعتبار/,
      );
    } finally {
      Date.now = originalNow;
    }
    assert.equal(s.provision.get(quote.id).status, "expired");
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
  } finally {
    s.close();
  }
});

test("account changes invalidate spending approval but still allow cancelling a stale proposal", async () => {
  const s = setup();
  try {
    const quote = await s.provision.quote(s.input);
    config.liaraToken = "different-account-test-key";
    await assert.rejects(
      () => s.provision.approve(quote.id, quote.fingerprint, true),
      /حساب/,
    );
    await s.provision.approve(quote.id, quote.fingerprint, false);
    assert.equal(s.provision.get(quote.id).status, "rejected");
    assert.equal(
      s.calls.some((c) => c.method === "POST"),
      false,
    );
  } finally {
    s.close();
  }
});

test("payment rejection is actionable and creates no paid resources; requote is read-only and preserves encrypted inputs", async () => {
  const s = setup();
  try {
    s.setPaymentFailure();
    const quote = await s.provision.quote(s.input);
    await s.provision.approve(quote.id, quote.fingerprint, true);
    await settled(s.provision);
    const failed = s.provision.get(quote.id);
    assert.equal(failed.errorCode, "payment_required");
    assert.match(failed.error!, /اعتبار/);
    assert.equal(
      failed.resources.filter((r) => r.kind !== "network").length,
      0,
    );
    // Simulates a network created before a definitive app-create rejection.
    s.db.put("provisionJobs", {
      ...failed,
      resources: [{ kind: "network", id: "private-network", name: "shared" }],
    });
    const before = s.calls.length;
    const fresh = await s.provision.requote(quote.id);
    assert.equal(fresh.status, "pending");
    assert.notEqual(fresh.fingerprint, quote.fingerprint);
    assert.ok(s.calls.slice(before).every((c) => c.method === "GET"));
    const secret = s.vault.get<any>(`quote:${fresh.id}`);
    assert.equal(secret.input.env.SERVICE_KEY, s.input.env.SERVICE_KEY);
    assert.equal(secret.input.networkId, "private-network");
    assert.ok(!JSON.stringify(fresh).includes(s.input.env.SERVICE_KEY));
    config.liaraToken = "other-account";
    await assert.rejects(() => s.provision.requote(quote.id), /حساب/);
  } finally {
    s.close();
  }
});

test("recovery never replays partially created paid resources or ambiguous failures", async () => {
  const s = setup();
  try {
    const quote = await s.provision.quote(s.input);
    s.db.put("provisionJobs", {
      ...quote,
      status: "failed",
      errorCode: "payment_required",
      resources: [{ kind: "app", id: "new-shop", name: "new-shop" }],
    });
    await assert.rejects(() => s.provision.requote(quote.id), /ساخت دوباره/);
    s.db.put("provisionJobs", {
      ...quote,
      status: "failed",
      errorCode: "provider_error",
      error: "timeout",
    });
    await assert.rejects(() => s.provision.requote(quote.id), /ساخت دوباره/);
    assert.ok(s.calls.every((c) => c.method === "GET"));
  } finally {
    s.close();
  }
});

test("known source rejection can continue only deployment after a fresh approval, without recreating infrastructure", async () => {
  const s = setup(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true });
  try {
    s.setSourceFailure(true);
    const first = await s.provision.quote(s.input);
    await s.provision.approve(first.id, first.fingerprint, true);
    await settled(s.provision);
    assert.equal(s.provision.get(first.id).status, "failed");
    s.setSourceFailure(false);
    const start = s.calls.length;
    const next = await s.provision.continueDeployment(first.id);
    assert.equal(next.status, "pending");
    assert.equal(next.continuationOf, first.id);
    assert.ok(s.calls.slice(start).every((c) => c.method === "GET"));
    await s.provision.approve(next.id, next.fingerprint, true);
    await settled(s.provision);
    assert.equal(s.provision.get(next.id).status, "completed");
    assert.equal(
      s.calls.filter(
        (c) => c.endpoint === "/v1/projects" && c.method === "POST",
      ).length,
      1,
    );
    assert.equal(
      s.calls.filter(
        (c) => c.endpoint === "/v1/databases" && c.method === "POST",
      ).length,
      1,
    );
    await assert.rejects(
      () => s.provision.continueDeployment(first.id),
      /نسخه/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    s.close();
  }
});

test("a slow cloud release can be rechecked without a new deploy or infrastructure mutation", async () => {
  const s = setup(),
    previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 503 });
  try {
    const q = await s.provision.quote(s.input);
    await s.provision.approve(q.id, q.fingerprint, true);
    await settled(s.provision);
    assert.equal(s.provision.get(q.id).status, "failed");
    assert.equal(s.provision.get(q.id).releaseId, "exact-new-release");
    const start = s.calls.length;
    globalThis.fetch = async () => Response.json({ ok: true });
    const verified = await s.provision.recheckDeployment(q.id);
    assert.equal(verified.status, "completed");
    assert.ok(s.calls.slice(start).every((c) => c.method === "GET"));
    assert.equal(config.appId, "new-shop");
  } finally {
    globalThis.fetch = previousFetch;
    s.close();
  }
});
