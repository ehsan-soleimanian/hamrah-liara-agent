import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Domains, requiredRecords, dnsDiff } from "../server/domains.ts";
import { normalizeDomain, publicAddress } from "../server/domain-probe.ts";
import { Store } from "../server/store.ts";
import { Vault } from "../server/vault.ts";
import { config } from "../server/config.ts";
import { Liara } from "../server/liara.ts";

function fixture(provider: "manual" | "cloudflare" = "manual") {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-domains-"));
  Object.assign(config, {
    mode: "live",
    liaraToken: "domain-test-key",
    teamId: "team-one",
    allowedApps: ["shop"],
  });
  const db = new Store(dir),
    vault = new Vault(dir),
    jobId = randomUUID();
  db.put("provisionJobs", {
    id: jobId,
    appName: "shop",
    mode: "live",
    status: "completed",
  });
  const writes: { endpoint: string; body?: any }[] = [];
  let created = false,
    valid = false,
    ssl = false,
    cfRecords: any[] = [];
  const liara = {
    call: async (endpoint: string, method = "GET", body?: any) => {
      if (method !== "GET") {
        writes.push({ endpoint, body });
        if (endpoint === "/v1/domains") created = true;
        if (endpoint.includes("provision-ssl")) ssl = true;
        return {};
      }
      const domain = {
        _id: "domain-one",
        name: "shop.customer.ir",
        project: { project_id: "shop" },
        target: "iran.liara.run",
        verificationCode: "ownership-123",
        certificatesStatus: ssl ? "ACTIVE" : "DEACTIVE",
      };
      if (endpoint === "/v1/domains")
        return { domains: created ? [domain] : [] };
      if (endpoint.endsWith("/check"))
        return {
          domain: {
            status: valid ? "ACTIVE" : "PENDING",
            CNameRecord: valid ? "VALID" : "INVALID",
            acmeRecord: valid ? "VALID" : "INVALID",
          },
        };
      return { domain };
    },
  };
  const cfWrites: any[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const u = new URL(String(url)),
      method = options?.method || "GET";
    if (method !== "GET")
      cfWrites.push({
        url: u.toString(),
        method,
        body: options?.body ? JSON.parse(String(options.body)) : null,
      });
    return Response.json({
      success: true,
      result: u.pathname.endsWith("/zones")
        ? [
            {
              id: "zone",
              name: "customer.ir",
              status: "active",
              name_servers: ["ns1.example.net"],
            },
          ]
        : cfRecords,
      result_info: { total_pages: 1 },
    });
  };
  const manager = new Domains(
    db,
    vault,
    liara as unknown as Liara,
    async () => ({
      tls: true,
      https: true,
      redirect: true,
      certificateExpiresAt: "2027-01-01T00:00:00Z",
    }),
    fetcher,
  );
  return {
    db,
    vault,
    manager,
    jobId,
    dir,
    writes,
    cfWrites,
    liara,
    valid: () => (valid = true),
    records: (r: any[]) => (cfRecords = r),
    input: {
      jobId,
      name: "shop.customer.ir",
      provider,
      ...(provider === "cloudflare"
        ? { cloudflareToken: "cf-super-secret-test-token" }
        : {}),
    },
  };
}
test("domain names and public probes reject URL tricks, private IPs and mapped addresses", () => {
  assert.equal(normalizeDomain("SHOP.Customer.ir."), "shop.customer.ir");
  assert.equal(normalizeDomain("مثال.ir"), "xn--mgbh0fb.ir");
  for (const x of [
    "https://customer.ir",
    "a.ir/path",
    "*.a.ir",
    "127.0.0.1",
    "a.local",
    "x.ir:443",
    "x.ir@127.0.0.1",
    "a..ir",
    "x.ir\\evil",
  ])
    assert.throws(() => normalizeDomain(x));
  for (const x of [
    "127.0.0.1",
    "10.1.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(x), false, x);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("three provider-derived records are required and unknown targets fail closed", () => {
  assert.throws(() =>
    requiredRecords("shop.customer.ir", { target: "iran.liara.run" }),
  );
  assert.throws(() =>
    requiredRecords("shop.customer.ir", {
      target: "evil.com",
      verificationCode: "x",
    }),
  );
  const records = requiredRecords("shop.customer.ir", {
    target: "iran.liara.run",
    verificationCode: "x",
  });
  assert.equal(records[1].name, "liara-challenge.shop.customer.ir");
  assert.equal(
    records[2].content,
    "shop-customer-ir._acme-challenge.liara.cloud",
  );
});
test("manual flow requires two exact approvals, waits for DNS and verifies after SSL", async () => {
  const f = fixture();
  try {
    const j = await f.manager.plan(f.input);
    assert.equal(f.writes.length, 0);
    await assert.rejects(() => f.manager.decide(j.id, "wrong", true));
    let d = await f.manager.decide(j.id, j.fingerprint, true);
    assert.equal(d.status, "dns_approval");
    assert.equal(f.writes.length, 1);
    d = await f.manager.decide(d.id, d.fingerprint, true);
    assert.equal(d.status, "waiting_dns");
    d = await f.manager.check(d.id);
    assert.equal(d.checks.dns, false);
    assert.equal(f.writes.length, 1);
    f.valid();
    d = await f.manager.check(d.id);
    assert.equal(d.status, "waiting_ssl");
    assert.equal(f.writes[1].body.domain, "shop.customer.ir");
    d = await f.manager.check(d.id);
    assert.equal(d.status, "active");
    assert.equal(d.checks.https, true);
    assert.equal(f.writes.length, 2);
    assert.equal(f.db.verifyAudit(), true);
  } finally {
    f.db.close();
  }
});
test("Cloudflare key stays encrypted and writes only after exact DNS confirmation", async () => {
  const f = fixture("cloudflare");
  try {
    let j = await f.manager.plan(f.input);
    assert.equal(f.cfWrites.length, 0);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    assert.equal(JSON.stringify(j).includes("cf-super-secret"), false);
    for (const file of readdirSync(path.join(f.dir, "vault")))
      assert.equal(
        readFileSync(path.join(f.dir, "vault", file)).includes(
          Buffer.from("cf-super-secret"),
        ),
        false,
      );
    j = await f.manager.decide(j.id, j.fingerprint, true);
    assert.equal(f.cfWrites.length, 3);
    assert.equal(f.cfWrites[0].body.proxied, false);
    assert.equal(f.cfWrites[0].body.ttl, 300);
    assert.equal(
      f.cfWrites.some((x) => ["MX", "NS"].includes(x.body?.type)),
      false,
    );
  } finally {
    f.db.close();
  }
});
test("DNS changed since review blocks all provider writes", async () => {
  const f = fixture("cloudflare");
  try {
    let j = await f.manager.plan(f.input);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    f.records([
      {
        id: "changed",
        type: "A",
        name: "shop.customer.ir",
        content: "8.8.8.8",
      },
    ]);
    await assert.rejects(
      () => f.manager.decide(j.id, j.fingerprint, true),
      /تغییر/,
    );
    assert.equal(f.cfWrites.length, 0);
  } finally {
    f.db.close();
  }
});
test("DNS conflicts preserve mail records and show exact previous web records", () => {
  const records = requiredRecords("shop.customer.ir", {
    target: "iran.liara.run",
    verificationCode: "x",
  });
  const before = [
    { id: "a", name: "shop.customer.ir", type: "A", content: "8.8.8.8" },
    { id: "mail", name: "customer.ir", type: "MX", content: "mx.mail.ir" },
  ];
  assert.equal(dnsDiff(records, before)[0].action, "replace");
  assert.equal(dnsDiff(records, before)[0].before.length, 1);
  assert.throws(() =>
    dnsDiff(records, [
      {
        id: "mail",
        name: "shop.customer.ir",
        type: "MX",
        content: "mx.mail.ir",
      },
    ]),
  );
});
test("expired approvals, account changes and retired apps cannot dispatch changes", async () => {
  const f = fixture();
  try {
    let j = await f.manager.plan(f.input);
    j.expiresAt = "2020-01-01T00:00:00Z";
    f.db.put("domainJobs", j);
    await assert.rejects(() => f.manager.decide(j.id, j.fingerprint, true));
    config.teamId = "other-team";
    assert.equal(f.manager.list().length, 0);
    assert.throws(() => f.manager.get(j.id));
    config.teamId = "team-one";
    f.db.put("provisionJobs", {
      id: f.jobId,
      appName: "shop",
      mode: "live",
      status: "completed",
      retiredAt: new Date().toISOString(),
    });
    await assert.rejects(() => f.manager.plan(f.input));
    assert.equal(f.writes.length, 0);
  } finally {
    f.db.close();
  }
});
test("crash recovery never blindly replays mutations and cancellation prevents checks", async () => {
  const f = fixture();
  try {
    let j = await f.manager.plan(f.input);
    j.status = "applying_dns";
    f.db.put("domainJobs", j);
    const recovered = new Domains(f.db, f.vault);
    assert.equal(recovered.get(j.id).status, "attention");
    await recovered.tick();
    assert.equal(f.writes.length, 0);
    j = await recovered.cancel(j.id);
    assert.equal(j.status, "cancelled");
  } finally {
    f.db.close();
  }
});
test("an uncertain SSL write is recorded before dispatch and is not replayed", async () => {
  const f = fixture();
  try {
    let j = await f.manager.plan(f.input);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    f.valid();
    const original = f.liara.call;
    let attempts = 0;
    f.liara.call = async (endpoint, method = "GET", body) => {
      if (endpoint.includes("provision-ssl")) {
        attempts++;
        throw Error("uncertain write");
      }
      return original(endpoint, method, body);
    };
    j = await f.manager.check(j.id);
    assert.ok(j.sslRequestedAt);
    await f.manager.check(j.id);
    assert.equal(attempts, 1);
  } finally {
    f.db.close();
  }
});
test("a failed HTTPS recheck clears prior success and cannot leave a false active result", async () => {
  const f = fixture();
  try {
    let j = await f.manager.plan(f.input);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    f.valid();
    await f.manager.check(j.id);
    j = await f.manager.check(j.id);
    assert.equal(j.status, "active");
    const failing = new Domains(
      f.db,
      f.vault,
      f.liara as unknown as Liara,
      async () => {
        throw Error("TLS unavailable");
      },
    );
    j = await failing.check(j.id);
    assert.equal(j.checks.tls, false);
    assert.equal(j.checks.https, false);
    assert.notEqual(j.status, "active");
  } finally {
    f.db.close();
  }
});
test("worker does not continue expired setup permissions", async () => {
  const f = fixture();
  try {
    let j = await f.manager.plan(f.input);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j.approvedUntil = "2020-01-01T00:00:00Z";
    f.db.put("domainJobs", j);
    f.valid();
    await f.manager.tick();
    assert.equal(f.manager.get(j.id).status, "attention");
    assert.equal(f.writes.length, 1);
  } finally {
    f.db.close();
  }
});
test("Liara DNS waits for public NS before any record or SSL write, then verifies outcome", async () => {
  const f = fixture();
  try {
    const { LiaraDns } = await import("../server/liara-dns.ts");
    let created = false,
      delegated = false;
    const dnsWrites: { endpoint: string; body: any }[] = [];
    const dns = {
      call: async (endpoint: string, method = "GET", body?: any) => {
        if (method !== "GET") {
          dnsWrites.push({ endpoint, body });
          if (endpoint === "/zones") created = true;
        }
        return { data: created ? [{ name: "customer.ir" }] : [] };
      },
      zone: async (name: string) => ({
        id: name,
        name,
        nameservers: ["ns1.liara.ir", "ns2.liara.ir"],
        status: delegated ? "ACTIVE" : "PENDING",
      }),
      delegated: async () => ({
        valid: delegated,
        zone: await dns.zone("customer.ir"),
      }),
      records: async () => [],
    };
    const manager = new Domains(
      f.db,
      f.vault,
      f.liara as unknown as Liara,
      async () => ({
        tls: true,
        https: true,
        redirect: true,
        certificateExpiresAt: "2027-01-01T00:00:00Z",
      }),
      fetch,
      dns as unknown as InstanceType<typeof LiaraDns>,
    );
    let j = await manager.plan({ ...f.input, provider: "liara" });
    assert.equal(dnsWrites.length, 0);
    j = await manager.decide(j.id, j.fingerprint, true);
    assert.equal(dnsWrites.length, 1);
    assert.equal(dnsWrites[0].endpoint, "/zones");
    assert.equal(j.zone?.nameservers.length, 2);
    assert.equal(j.status, "dns_approval");
    j = await manager.decide(j.id, j.fingerprint, true);
    assert.equal(j.status, "waiting_ns");
    j = await manager.check(j.id);
    assert.equal(j.status, "waiting_ns");
    assert.equal(dnsWrites.length, 1);
    assert.equal(f.writes.length, 1);
    delegated = true;
    f.valid();
    j = await manager.check(j.id);
    assert.equal(dnsWrites.length, 4);
    assert.ok(j.dnsAppliedAt);
    assert.equal(j.status, "waiting_ssl");
    assert.equal(dnsWrites[2].body.contents[0].text, "ownership-123");
    assert.equal(dnsWrites[3].body.name, "_acme-challenge.shop.customer.ir");
    j = await manager.check(j.id);
    assert.equal(j.status, "active");
    await manager.check(j.id);
    assert.equal(dnsWrites.length, 4);
  } finally {
    f.db.close();
  }
});
test("Liara DNS adapter uses scoped official origin and verifies both provider status and public NS", async () => {
  const { LiaraDns } = await import("../server/liara-dns.ts");
  const calls: { url: string; method: string }[] = [];
  const request: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || "GET" });
    return Response.json({
      status: "success",
      data: {
        name: "customer.ir",
        status: "ACTIVE",
        nameServers: ["ns1.liara.ir", "ns2.liara.ir"],
      },
    });
  };
  config.teamId = "dns-team";
  config.liaraToken = "dns-test-token";
  const adapter = new LiaraDns(request, async () => ["old.example.net"]);
  assert.equal(
    (await adapter.delegated({ name: "customer.ir", nameservers: [] })).valid,
    false,
  );
  assert.equal(new URL(calls[0].url).searchParams.get("teamID"), "dns-team");
  assert.equal(calls[0].method, "PUT");
  const correct = new LiaraDns(request, async () => [
    "ns2.liara.ir.",
    "ns1.liara.ir.",
  ]);
  assert.equal(
    (await correct.delegated({ name: "customer.ir", nameservers: [] })).valid,
    true,
  );
  const before = calls.length;
  await assert.rejects(() => adapter.call("https://evil.invalid/zones"));
  assert.equal(calls.length, before);
});
test("Liara record diff supports apex ALIAS while preserving unrelated records", () => {
  const changes = dnsDiff(
    [{ type: "ALIAS", name: "customer.ir", content: "iran.liara.run" }],
    [
      {
        id: "web",
        type: "ALIAS",
        name: "customer.ir",
        content: "iran.liara.run",
      },
      {
        id: "mx",
        type: "MX",
        name: "mail.customer.ir",
        content: "mail.example.net",
      },
    ],
  );
  assert.equal(changes[0].action, "keep");
  assert.throws(() =>
    dnsDiff(
      [{ type: "TXT", name: "liara-challenge.customer.ir", content: "new" }],
      [
        {
          id: "multi",
          type: "TXT",
          name: "liara-challenge.customer.ir",
          content: "",
          multiple: true,
        },
      ],
    ),
  );
});
test("demo Liara path keeps the registrar handoff visible until the user confirms it", async () => {
  const f = fixture();
  try {
    config.mode = "demo";
    f.db.put("provisionJobs", {
      id: f.jobId,
      appName: "shop",
      mode: "demo",
      status: "completed",
    });
    let j = await f.manager.plan({ ...f.input, provider: "liara" });
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j = await f.manager.decide(j.id, j.fingerprint, true);
    j = await f.manager.check(j.id);
    assert.equal(j.status, "waiting_ns");
    j = await f.manager.confirmNameservers(j.id);
    assert.equal(j.status, "active");
    assert.ok(j.registrarConfirmedAt);
    assert.equal(f.writes.length, 0);
  } finally {
    f.db.close();
  }
});
test("apex ALIAS leaves mandatory zone NS, SOA, MX and TXT intact", () => {
  const existing = ["NS", "SOA", "MX", "TXT"].map((type, i) => ({
    id: String(i),
    type,
    name: "customer.ir",
    content: "keep",
  }));
  const changes = dnsDiff(
    [{ type: "ALIAS", name: "customer.ir", content: "iran.liara.run" }],
    existing,
  );
  assert.equal(changes[0].before.length, 0);
  assert.equal(changes[0].action, "create");
});
