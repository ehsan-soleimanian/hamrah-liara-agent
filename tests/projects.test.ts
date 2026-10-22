import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { readZip, analyzeFiles, Projects } from "../server/projects.ts";
import { Store } from "../server/store.ts";
import { Engine } from "../server/engine.ts";
import { config } from "../server/config.ts";

// Minimal stored ZIP fixture builder; deliberately allows invalid paths for adversarial tests.
function zip(entries: Record<string, string>) {
  let offset = 0;
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const bytes = Buffer.from(text),
      filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(bytes.length, 20);
    dir.writeUInt32LE(bytes.length, 24);
    dir.writeUInt16LE(filename.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
const fixture = {
  "my-app/package.json": JSON.stringify({
    dependencies: { express: "5", pg: "8", ioredis: "5" },
    scripts: { start: "node server.js" },
    engines: { node: ">=22" },
  }),
  "my-app/server.js":
    "const secret = process.env.DATABASE_URL; const key=process.env['API_KEY'];",
  "my-app/.env":
    "DATABASE_URL=postgres://private-password\nTOP_SECRET=never-show-this",
  "my-app/.env.example": "EXAMPLE_ONLY=secret-value",
  "my-app/private.pem": "SECRET PRIVATE KEY",
  "my-app/node_modules/unused/index.js": "evil",
  "my-app/liara.json": JSON.stringify({ port: 8080 }),
};

test("real ZIP analysis identifies dependencies and env NAMES without persisting credentials", async () => {
  const files = await readZip(zip(fixture));
  const { report, files: clean } = analyzeFiles(files);
  assert.equal(report.stack, "Node.js / Express");
  assert.equal(report.port, 8080);
  assert.deepEqual(
    report.services.map((s) => s.name),
    ["PostgreSQL", "Redis"],
  );
  assert.deepEqual(report.envNames, [
    "API_KEY",
    "DATABASE_URL",
    "EXAMPLE_ONLY",
    "TOP_SECRET",
  ]);
  assert.equal(report.blockers.length, 0);
  assert.equal(clean.has(".env"), false);
  assert.equal(clean.has("private.pem"), false);
  assert.equal(
    [...clean.keys()].some((n) => n.includes("node_modules")),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /private-password|never-show-this|secret-value|SECRET PRIVATE KEY/,
  );
});
test("invalid ZIP, traversal, Windows devices and oversized files fail closed", async () => {
  await assert.rejects(() => readZip(Buffer.from("not a zip")));
  for (const name of [
    "../outside.txt",
    "C:/outside.txt",
    "app/CON.txt",
    "app/a\\b.txt",
  ])
    await assert.rejects(() => readZip(zip({ [name]: "test" })));
  await assert.rejects(() =>
    readZip(zip({ "big.txt": "x".repeat(8 * 1024 * 1024 + 1) })),
  );
});
test("monorepo selection and missing startup produce actionable blockers", () => {
  const files = new Map([
    ["apps/a/package.json", Buffer.from('{"scripts":{"start":"node a.js"}}')],
    ["apps/b/package.json", Buffer.from("{}")],
  ]);
  const ambiguous = analyzeFiles(files);
  assert.ok(ambiguous.report.blockers.length);
  const selected = analyzeFiles(files, { root: "a" }); // one common wrapper (apps) is stripped
  assert.equal(selected.report.root, "a");
  assert.equal(selected.report.blockers.length, 0);
  assert.throws(() => analyzeFiles(files, { root: "../outside" }));
  assert.ok(
    analyzeFiles(new Map([["package.json", Buffer.from("{}")]])).report.blockers
      .length,
  );
});
test("approval packages exact imported source, requires readiness, never runs user code in demo, and rejects tampering", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-import-test-"));
  config.dataDir = dir;
  config.mode = "demo";
  const db = new Store(path.join(dir, "db"));
  const engine = new Engine(db);
  const projects = new Projects(db);
  try {
    const report = await projects.ingest(zip(fixture), {
      name: "my-app",
      source: "zip",
    });
    assert.throws(
      () =>
        engine.propose({
          kind: "deploy_release",
          target: engine.appId(),
          projectId: report.id,
        }),
      /تنظیمات/,
    );
    const action = engine.propose({
      kind: "deploy_release",
      target: engine.appId(),
      projectId: report.id,
      dependenciesReady: true,
    });
    assert.equal(action.params.sourceHash, report.hash);
    assert.equal(db.get<any>("actions", action.id).status, "pending");
    await engine.decide(action.id, true, action.fingerprint);
    assert.equal(db.get<any>("actions", action.id).status, "completed");
    const archive = path.join(projects.base(report.id), "source.tar.gz");
    const names: string[] = [];
    await tar.t({
      file: archive,
      onReadEntry: (e) => {
        names.push(e.path);
      },
    });
    assert.ok(names.includes("server.js"));
    assert.equal(names.includes(".env"), false);
    assert.equal(
      db.list("probes").length,
      0,
      "must not verify imported project using unrelated demo app",
    );
    await assert.rejects(() =>
      engine.decide(action.id, true, action.fingerprint),
    );
    writeFileSync(
      path.join(projects.base(report.id), "source", "server.js"),
      "changed",
    );
    assert.throws(() => projects.verify(report.id, report.hash), /تغییر/);
  } finally {
    engine.stop();
    db.close();
  }
});
test("GitHub import rejects non-GitHub destinations before network access", async () => {
  const db = new Store(mkdtempSync(path.join(tmpdir(), "hamrah-url-test-")));
  try {
    const p = new Projects(db);
    for (const url of [
      "http://github.com/a/b",
      "https://127.0.0.1/a/b",
      "https://github.com.evil.test/a/b",
      "https://user:secret@github.com/a/b",
    ])
      await assert.rejects(() => p.github(url));
  } finally {
    db.close();
  }
});

test("live deployment sends the approved project archive and waits for its exact release plus business verification", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hamrah-live-import-test-"));
  const previous = {
    mode: config.mode,
    dataDir: config.dataDir,
    appId: config.appId,
    allowedApps: config.allowedApps,
    healthUrl: config.healthUrl,
    businessUrl: config.businessUrl,
  };
  Object.assign(config, {
    mode: "live",
    dataDir: dir,
    appId: "approved-app",
    allowedApps: ["approved-app"],
    healthUrl: "https://example.com/health",
    businessUrl: "https://example.com/check",
  });
  const db = new Store(path.join(dir, "db"));
  const engine = new Engine(db);
  try {
    const project = await new Projects(db).ingest(zip(fixture), {
      name: "actual-user-project",
      source: "zip",
    });
    let sent = false,
      checks = 0;
    engine.liara.apps = async () => [
      {
        id: "approved-app",
        name: "approved-app",
        platform: "node",
        type: "app",
        status: "unknown",
        detail: "",
        plan: "existing",
      },
    ];
    engine.liara.deploy = async (app, archive, options) => {
      assert.equal(app, "approved-app");
      assert.deepEqual(options, { port: 8080, type: "node" });
      const target = path.join(dir, "captured.tar.gz");
      writeFileSync(target, archive);
      const files: string[] = [];
      await tar.t({
        file: target,
        onReadEntry: (e) => {
          files.push(e.path);
        },
      });
      assert.ok(files.includes("server.js"));
      assert.equal(files.includes("index.mjs"), false);
      assert.equal(files.includes(".env"), false);
      sent = true;
      return { releaseID: "exact-release" };
    };
    let safetyBackup = false;
    engine.createBackup = async () => {
      safetyBackup = true;
      return {
        id: "verified-test-backup",
        name: "fixture",
        at: new Date().toISOString(),
        size: "1 KB",
        status: "ready",
        source: "live",
        verifiedAt: new Date().toISOString(),
      };
    };
    engine.liara.call = async (endpoint) =>
      endpoint.includes("releases")
        ? {
            currentRelease: "exact-release",
            releases: [{ _id: "exact-release", state: "ready" }],
          }
        : {};
    engine.check = async () => {
      checks++;
      return {
        id: String(checks),
        at: new Date().toISOString(),
        healthy: true,
        healthOk: true,
        businessOk: true,
        latency: 10,
        statusCode: 200,
      };
    };
    const action = engine.propose({
      kind: "deploy_release",
      target: "approved-app",
      projectId: project.id,
      dependenciesReady: true,
    });
    assert.equal(sent, false);
    await engine.decide(action.id, true, action.fingerprint);
    assert.equal(sent, true);
    assert.equal(safetyBackup, true);
    assert.equal(checks, 2);
    assert.equal(db.get<any>("actions", action.id).status, "completed");
  } finally {
    engine.stop();
    db.close();
    Object.assign(config, previous);
  }
});
