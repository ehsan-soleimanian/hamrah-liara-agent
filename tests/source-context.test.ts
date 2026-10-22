import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../server/config.ts";
import { Store } from "../server/store.ts";
import { Vault } from "../server/vault.ts";
import { Projects, hashFiles } from "../server/projects.ts";
import { digest } from "../server/security.ts";
import { deployedSourceContext } from "../server/source-context.ts";
import { Engine } from "../server/engine.ts";
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-source-"));
  Object.assign(config, {
    dataDir: dir,
    mode: "live",
    appId: "owned-app",
    allowedApps: ["owned-app"],
    databaseId: "owned-db",
    liaraToken: "fixture-key",
    teamId: "fixture-team",
  });
  const db = new Store(dir),
    id = randomUUID(),
    jobId = randomUUID(),
    projects = new Projects(db),
    files = new Map<string, Buffer>([
      [
        "index.mjs",
        Buffer.from(
          'let faultUntil = 0; const API_KEY="INLINE_PRIVATE_TOKEN_VALUE"; const opts={"password":"INLINE_PASSWORD_VALUE"};',
        ),
      ],
      ["package.json", Buffer.from('{"scripts":{"start":"node index.mjs"}}')],
      [".env", Buffer.from("DATABASE_URL=DO_NOT_EXPOSE_ENV")],
    ]),
    hash = hashFiles(files);
  mkdirSync(path.join(projects.base(id), "source"), { recursive: true });
  for (const [name, bytes] of files)
    writeFileSync(path.join(projects.base(id), "source", name), bytes);
  writeFileSync(
    path.join(projects.base(id), "manifest.json"),
    JSON.stringify([...files.keys()]),
  );
  db.put("projects", { id, hash, blockers: [] });
  db.put("provisionJobs", {
    id: jobId,
    status: "completed",
    appName: "owned-app",
    mode: "live",
    projectId: id,
    sourceHash: hash,
  });
  const account = digest({
    mode: config.mode,
    token: config.liaraToken,
    team: config.teamId,
  });
  new Vault(dir).put(`managed:${account}`, {
    appId: "owned-app",
    secretJobId: jobId,
  });
  return { db, id, jobId, dir, projects, hash };
}
test("deployed source tool is fixed to current app, validates the entire hash and redacts secrets without exposing env files", () => {
  const old = { ...config },
    s = setup();
  try {
    const context = deployedSourceContext(s.db),
      text = JSON.stringify(context);
    assert.equal(context.sourceHash, s.hash);
    assert.ok(text.includes("faultUntil"));
    assert.doesNotMatch(
      text,
      /INLINE_PRIVATE_TOKEN_VALUE|INLINE_PASSWORD_VALUE|DO_NOT_EXPOSE_ENV/,
    );
    assert.deepEqual(
      context.files.map((f) => f.file),
      ["package.json", "index.mjs"],
    );
    writeFileSync(
      path.join(s.projects.base(s.id), "source", "index.mjs"),
      "changed",
    );
    assert.throws(() => deployedSourceContext(s.db), /سورس/);
  } finally {
    s.db.close();
    Object.assign(config, old);
  }
});
test("account changes, unapproved app selection and retired deployments cannot expose local source", () => {
  const old = { ...config },
    s = setup();
  try {
    config.teamId = "other-account";
    assert.throws(() => deployedSourceContext(s.db), /حساب/);
    config.teamId = "fixture-team";
    config.allowedApps = [];
    assert.throws(() => deployedSourceContext(s.db), /دسترس/);
    config.allowedApps = ["owned-app"];
    const job = s.db.get<any>("provisionJobs", s.jobId);
    s.db.put("provisionJobs", { ...job, retiredAt: new Date().toISOString() });
    assert.throws(() => deployedSourceContext(s.db), /مستقر/);
  } finally {
    s.db.close();
    Object.assign(config, old);
  }
});

test("current-shop update checks live dependencies, freezes env settings and refuses drift before any write", async () => {
  const old = { ...config },
    s = setup(),
    engine = new Engine(s.db);
  try {
    Object.assign(config, {
      healthUrl: "https://owned-app.liara.run/health",
      businessUrl: "https://owned-app.liara.run/api/checkout/check",
    });
    const project = {
      ...s.db.get<any>("projects", s.id),
      name: "shop",
      stack: "Node.js",
      platform: "node",
      port: 3000,
      envNames: ["DATABASE_URL"],
      services: [{ name: "PostgreSQL", required: true }],
      warnings: [],
    };
    s.db.put("projects", project);
    const calls: string[] = [];
    let details = {
      type: "node",
      envs: [{ key: "DATABASE_URL", value: "fixture-only-private-value" }],
    };
    engine.liara.call = async (endpoint, method = "GET") => {
      calls.push(method + " " + endpoint);
      assert.equal(
        method,
        "GET",
        "no mutation is allowed during preflight or after drift",
      );
      return { project: details };
    };
    const a = await engine.prepareUpdate(s.id);
    assert.equal(a.status, "pending");
    assert.equal(a.params.sourceHash, s.hash);
    assert.ok(a.params.deploymentConfigHash);
    assert.doesNotMatch(JSON.stringify(a), /fixture-only-private-value/);
    details = { ...details, envs: [] };
    await assert.rejects(() => engine.prepareUpdate(s.id), /اطلاعات/);
    details = {
      type: "node",
      envs: [{ key: "DATABASE_URL", value: "changed-setting" }],
    };
    await engine.decide(a.id, true, a.fingerprint);
    assert.equal(s.db.get<any>("actions", a.id).status, "failed");
    assert.match(s.db.get<any>("actions", a.id).error, /تنظیمات/);
    s.db.put("projects", {
      ...project,
      services: [...project.services, { name: "Redis", required: true }],
    });
    // A new source project must not silently expand the existing infrastructure.
    const baselineId = randomUUID();
    s.db.put("projects", { ...project, id: baselineId });
    s.db.put("provisionJobs", {
      ...s.db.get<any>("provisionJobs", s.jobId),
      projectId: baselineId,
    });
    await assert.rejects(() => engine.prepareUpdate(s.id), /سرویس جدید/);
    config.teamId = "different-team";
    await assert.rejects(() => engine.prepareUpdate(s.id), /اتصال فروشگاه/);
    assert.ok(calls.every((c) => c.startsWith("GET ")));
  } finally {
    engine.stop();
    s.db.close();
    Object.assign(config, old);
  }
});
