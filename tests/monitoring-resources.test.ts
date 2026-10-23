import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultMonitorPolicy,
  normalizeMetrics,
  makeSample,
  sustained,
  diagnose,
  p95,
} from "../server/monitoring.ts";
import { config } from "../server/config.ts";
import { Engine } from "../server/engine.ts";
import { Store } from "../server/store.ts";
import type { Action, Incident } from "../src/types.ts";
import type { ResourceSample } from "../src/monitoring-types.ts";
import { Agent } from "@cursor/sdk";

const policy = {
  ...defaultMonitorPolicy,
  cpuUnit: "percent" as const,
  memoryUnit: "percent" as const,
};
const pair = (value: unknown, age = 0) => ({
  applet: "replica-1",
  value: [Date.now() / 1000 - age, value],
});
test("metrics require explicit units, valid fresh values and known capacity; missing data is never zero", () => {
  const raw = { cpuUsage: [pair("0.9")], memoryUsage: [pair(768 * 1024 ** 2)] };
  assert.equal(
    normalizeMetrics(raw, { cpu: 1, ram: 1 }, defaultMonitorPolicy).cpuPercent,
    undefined,
  );
  const normalized = normalizeMetrics(
    raw,
    { cpu: 1, ram: 1 },
    { ...policy, cpuUnit: "cores", memoryUnit: "bytes" },
  );
  assert.equal(normalized.cpuPercent, 90);
  assert.equal(normalized.memoryPercent, 75);
  assert.equal(
    normalizeMetrics(
      { cpuUsage: [pair(900000000)] },
      { cpu: 1 },
      { ...policy, cpuUnit: "nanocores" },
    ).cpuPercent,
    90,
  );
  for (const invalid of [NaN, Infinity, -1, "NaN", "", null, true])
    assert.equal(
      normalizeMetrics({ cpuUsage: [pair(invalid)] }, {}, policy).cpuPercent,
      undefined,
    );
  assert.equal(
    normalizeMetrics({ cpuUsage: [pair(99, 1000)] }, {}, policy).cpuPercent,
    undefined,
  );
  assert.equal(
    normalizeMetrics({ cpuUsage: [pair(99, -1000)] }, {}, policy).cpuPercent,
    undefined,
  );
  assert.equal(
    normalizeMetrics(raw, {}, { ...policy, cpuUnit: "cores" }).cpuPercent,
    undefined,
  );
  assert.equal(
    normalizeMetrics(
      { cpuUsage: [pair(20), pair(95)], memoryUsage: [] },
      {},
      policy,
    ).cpuPercent,
    95,
    "busiest replica cannot be hidden by averaging",
  );
  assert.match(normalizeMetrics({}, {}, policy).metricsError!, /موجود نیست/);
});
test("alerts require consecutive same-signal samples; stale/gapped history and one-off spikes cannot trigger", () => {
  const sample = (cpu: number, ms: number) => ({
    ...makeSample("s", "live", true, ms),
    cpuPercent: cpu,
  });
  assert.deepEqual(
    sustained([sample(90, 20), sample(10, 20), sample(90, 20)], policy, 60000),
    [],
  );
  assert.deepEqual(
    sustained(
      [sample(90, 1700), sample(90, 1800), sample(90, 1900)],
      policy,
      60000,
    ),
    ["CPU", "کندی"],
  );
  const old = sample(90, 20);
  old.at = new Date(Date.now() - 600000).toISOString();
  assert.deepEqual(
    sustained([old, sample(90, 20), sample(90, 20)], policy, 60000),
    [],
  );
  assert.equal(p95([sample(1, 10)]), undefined);
  assert.equal(p95([10, 20, 30, 40, 100].map((ms) => sample(1, ms))), 100);
});
test("diagnosis ranks direct log evidence above correlations and offers bounded next steps", () => {
  const sample = {
    ...makeSample("s", "live", true, 2000),
    cpuPercent: 91,
    memoryPercent: 90,
  };
  const hypotheses = diagnose(
    sample,
    "FATAL heap out of memory; connection pool exhausted; TypeError",
    policy,
  );
  assert.equal(hypotheses[0].confidence, "high");
  assert.match(hypotheses[0].cause, /حافظه/);
  assert(hypotheses.some((h) => /پردازنده/.test(h.cause)));
  assert(hypotheses.some((h) => /دیتابیس/.test(h.cause)));
  assert(hypotheses.some((h) => /کد/.test(h.cause)));
  assert.equal(diagnose(undefined, "", policy)[0].confidence, "low");
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-monitor-resources-"));
  Object.assign(config, {
    mode: "live",
    dataDir: dir,
    liaraToken: "fixture-token",
    cursorKey: "",
    appId: "fixture-app",
    teamId: "",
    allowedApps: ["fixture-app"],
    healthUrl: "https://fixture.invalid/health",
    businessUrl: "https://fixture.invalid/check",
    intervalMs: 60000,
  });
  const db = new Store(dir),
    engine = new Engine(db);
  engine.updateSettings({ resourcePolicy: policy });
  let project = { planID: "small", bundlePlanID: "basic", type: "node" };
  let price = 2,
    writes = 0,
    failWrite = false;
  const catalog = () => ({
    plans: {
      projects: {
        small: {
          available: true,
          price: 1,
          RAM: { amount: 1 },
          CPU: { amount: 1 },
          volume: 10,
        },
        large: {
          available: true,
          price,
          RAM: { amount: 2 },
          CPU: { amount: 2 },
          volume: 10,
        },
      },
      databases: {},
      projectBundlePlans: {
        small: { basic: { available: true, displayPrice: 100 } },
        large: { basic: { available: true, displayPrice: 100 } },
      },
    },
  });
  engine.liara.call = async (route: string, method = "GET", body?: any) => {
    if (route === "/v1/me") return catalog();
    if (route === "/v1/projects") return { projects: [] };
    if (route === "/v1/projects/fixture-app")
      return { project: { ...project } };
    if (route === "/v1/projects/fixture-app/resize" && method === "POST") {
      writes++;
      assert.deepEqual(body, { planID: "large" });
      if (failWrite) throw Error("network outcome unknown");
      project = { ...project, planID: body.planID };
      return {};
    }
    throw Error("Unexpected external request: " + route);
  };
  engine.check = async () => ({
    id: randomUUID(),
    at: new Date().toISOString(),
    scope: engine.recovery.scope(),
    healthy: true,
    healthOk: true,
    businessOk: true,
    latency: 2200,
    healthLatency: 1800,
    statusCode: 200,
  });
  engine.logs = async () => ({ text: "TypeError fixture application stack" });
  engine.liara.metrics = async () => ({
    cpuUsage: [pair(92)],
    memoryUsage: [pair(88)],
  });
  return {
    engine,
    db,
    writes: () => writes,
    setPrice: (v: number) => {
      price = v;
    },
    setProject: (p: typeof project) => {
      project = p;
    },
    failWrite: () => {
      failWrite = true;
    },
  };
}
async function settled(engine: Engine, db: Store) {
  for (let i = 0; i < 100; i++) {
    if (
      !db.list<Incident>("incidents").some((i) => i.status === "INVESTIGATING")
    )
      return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("investigation did not settle");
}
test("healthy-but-slow app creates one performance incident, keeps evidence without Cursor, and resolves only on measured recovery", async () => {
  const { engine, db } = fixture();
  try {
    await engine.tick(true);
    await engine.tick(true);
    assert.equal(db.list("incidents").length, 0);
    await engine.tick(true);
    await settled(engine, db);
    let incidents = db.list<Incident>("incidents");
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].category, "performance");
    assert.deepEqual(incidents[0].performanceKeys, ["CPU", "RAM", "کندی"]);
    assert(incidents[0].hypotheses!.length >= 3);
    assert.equal(
      db.list<Action>("actions").length,
      0,
      "high usage cannot authorize mutation",
    );
    await engine.tick(true);
    assert.equal(db.list("incidents").length, 1);
    engine.liara.metrics = async () => {
      throw Error("metrics unavailable");
    };
    engine.check = async () => ({
      id: randomUUID(),
      at: new Date().toISOString(),
      scope: engine.recovery.scope(),
      healthy: true,
      healthOk: true,
      businessOk: true,
      latency: 10,
      healthLatency: 5,
      statusCode: 200,
    });
    await engine.tick(true);
    await engine.tick(true);
    assert.equal(
      db.list<Incident>("incidents")[0].status,
      "ESCALATED",
      "unknown resource state cannot prove recovery",
    );
    assert.match(
      engine.monitoring().samples.at(-1)!.metricsError!,
      /unavailable/,
    );
    engine.liara.metrics = async () => ({
      cpuUsage: [pair(20)],
      memoryUsage: [pair(30)],
    });
    await engine.tick(true);
    assert.notEqual(db.list<Incident>("incidents")[0].status, "RESOLVED");
    await engine.tick(true);
    assert.equal(db.list<Incident>("incidents")[0].status, "RESOLVED");
    assert.equal(engine.monitoring().samples.length, 8);
    config.teamId = "other-team";
    assert.equal(
      engine.monitoring().samples.length,
      0,
      "history is scoped to account and app",
    );
  } finally {
    engine.stop();
    db.close();
  }
});
test("changing thresholds or metric units requires fresh consecutive samples", async () => {
  const { engine, db } = fixture();
  try {
    await engine.tick(true);
    await engine.tick(true);
    engine.updateSettings({ resourcePolicy: { ...policy, cpuPercent: 90 } });
    assert.equal(engine.monitoring().samples.length, 0);
    await engine.tick(true);
    assert.equal(db.list("incidents").length, 0);
  } finally {
    engine.stop();
    db.close();
  }
});
test("scope changes during collection discard samples and interrupted investigations recover without replay", async () => {
  const f = fixture();
  try {
    const oldScope = f.engine.recovery.scope();
    f.engine.liara.metrics = async () => {
      config.teamId = "changed-during-read";
      return { cpuUsage: [pair(95)], memoryUsage: [pair(90)] };
    };
    await f.engine.tick(true);
    assert.equal(f.db.list<ResourceSample>("resourceSamples").length, 0);
    config.teamId = "";
    const at = new Date().toISOString();
    f.db.put("incidents", {
      id: randomUUID(),
      appId: "fixture-app",
      scope: oldScope,
      category: "performance",
      performanceKeys: ["CPU"],
      status: "INVESTIGATING",
      title: "fixture interrupted",
      summary: "fixture",
      createdAt: at,
      updatedAt: at,
      source: "live",
      evidence: [],
      timeline: [],
    } satisfies Incident);
    const restarted = new Engine(f.db);
    assert.equal(f.db.list<Incident>("incidents")[0].status, "ESCALATED");
    assert.equal(f.writes(), 0);
    restarted.stop();
  } finally {
    f.engine.stop();
    f.db.close();
  }
});
test("Cursor regional rejection remains explicit while local performance diagnosis and monitoring continue", async () => {
  const f = fixture(),
    create = Agent.create;
  config.cursorKey = "isolated-model-key";
  Agent.create = async () => {
    throw Error("Cursor is not available in your region. PRIVATE_UPSTREAM");
  };
  try {
    await f.engine.tick(true);
    await f.engine.tick(true);
    await f.engine.tick(true);
    await settled(f.engine, f.db);
    const state = f.engine.snapshot();
    assert.equal(state.connections.cursorStatus?.code, "region_blocked");
    assert.equal(state.connections.cursorStatus?.ok, false);
    assert.doesNotMatch(
      state.connections.cursorStatus!.message!,
      /PRIVATE_UPSTREAM/,
    );
    assert(state.incidents[0].hypotheses!.length >= 3);
    assert(state.incidents[0].diagnosis);
    assert.equal(state.incidents[0].status, "ESCALATED");
    assert.equal(state.actions.length, 0);
    assert.equal(state.monitoring?.samples.length, 3);
  } finally {
    Agent.create = create;
    f.engine.stop();
    f.db.close();
  }
});
test("resource quote is read-only, deduplicates and cannot be executed through generic action input", async () => {
  const f = fixture();
  try {
    const action = await f.engine.resources.quote("large/basic");
    assert.equal(action.status, "pending");
    assert.equal(f.writes(), 0);
    assert.equal((await f.engine.resources.quote("large/basic")).id, action.id);
    assert.match(action.cost, /۳۰/);
    assert.throws(() =>
      f.engine.propose({ kind: "resize_app", target: "fixture-app" } as any),
    );
    await f.engine.decide(action.id, false, action.fingerprint);
    assert.equal(f.writes(), 0);
    assert.equal(f.db.get<Action>("actions", action.id)!.status, "rejected");
  } finally {
    f.engine.stop();
    f.db.close();
  }
});
test("tampered, expired, changed-account and no-longer-allowed resize approvals cannot write", async () => {
  for (const scenario of [
    "tampered",
    "expired",
    "scope",
    "allowlist",
  ] as const) {
    const f = fixture();
    try {
      const a = await f.engine.resources.quote("large/basic");
      if (scenario === "expired")
        f.db.put("actions", { ...a, expiresAt: new Date(0).toISOString() });
      if (scenario === "scope") config.teamId = "changed-team";
      if (scenario === "allowlist") config.allowedApps = [];
      await assert.rejects(() =>
        f.engine.decide(
          a.id,
          true,
          scenario === "tampered" ? "0".repeat(64) : a.fingerprint,
        ),
      );
      assert.equal(f.writes(), 0);
    } finally {
      f.engine.stop();
      f.db.close();
    }
  }
});
test("price drift and changed current plan invalidate approval before dispatch", async () => {
  for (const scenario of ["price", "plan"] as const) {
    const f = fixture();
    try {
      const a = await f.engine.resources.quote("large/basic");
      if (scenario === "price") f.setPrice(5);
      else
        f.setProject({ planID: "large", bundlePlanID: "basic", type: "node" });
      await f.engine.decide(a.id, true, a.fingerprint);
      assert.equal(f.writes(), 0);
      assert.equal(f.db.get<Action>("actions", a.id)!.status, "failed");
      assert.match(f.db.get<Action>("actions", a.id)!.error!, /تغییر/);
    } finally {
      f.engine.stop();
      f.db.close();
    }
  }
});
test("ambiguous resize write is not replayed and remains visibly failed", async () => {
  const f = fixture();
  try {
    const a = await f.engine.resources.quote("large/basic");
    f.failWrite();
    await f.engine.decide(a.id, true, a.fingerprint);
    assert.equal(f.writes(), 1);
    assert.equal(f.db.get<Action>("actions", a.id)!.status, "failed");
    await assert.rejects(() => f.engine.decide(a.id, true, a.fingerprint));
    assert.equal(f.writes(), 1);
  } finally {
    f.engine.stop();
    f.db.close();
  }
});
test("approved resize dispatches once, verifies plan and two health checks, and records audit", async () => {
  const f = fixture();
  try {
    const a = await f.engine.resources.quote("large/basic");
    const executing = f.engine.decide(a.id, true, a.fingerprint);
    await assert.rejects(() => f.engine.decide(a.id, true, a.fingerprint));
    await executing;
    assert.equal(f.writes(), 1);
    const result = f.db.get<Action>("actions", a.id)!;
    assert.equal(result.status, "completed");
    assert(result.steps!.some((s) => /پلن جدید/.test(s.label)));
    assert.equal(f.db.list("probes").length, 2);
    assert(
      f.db.auditList().some((a) => a.type === "approved" && a.actor === "user"),
    );
    assert.equal(f.db.verifyAudit(), true);
  } finally {
    f.engine.stop();
    f.db.close();
  }
});
