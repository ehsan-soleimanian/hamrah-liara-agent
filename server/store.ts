import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digest, redact } from "./security.ts";
import type { AuditEvent } from "../src/types.ts";
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "hamrah.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (collection TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,data TEXT NOT NULL);`);
  }
  list<T>(collection: string): T[] {
    return this.db
      .prepare(
        "SELECT data FROM records WHERE collection=? ORDER BY rowid DESC",
      )
      .all(collection)
      .map((r) => JSON.parse(r.data as string));
  }
  get<T>(collection: string, id: string): T | undefined {
    const r = this.db
      .prepare("SELECT data FROM records WHERE collection=? AND id=?")
      .get(collection, id);
    return r ? JSON.parse(r.data as string) : undefined;
  }
  put<T extends { id: string }>(collection: string, value: T) {
    this.db
      .prepare(
        "INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data",
      )
      .run(collection, value.id, JSON.stringify(value));
    return value;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  value<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key);
    return r ? JSON.parse(r.value as string) : fallback;
  }
  audit(
    type: string,
    title: string,
    detail: string,
    actor = "agent",
  ): AuditEvent {
    const last = this.db
      .prepare("SELECT data FROM audit ORDER BY seq DESC LIMIT 1")
      .get();
    const payload = {
      id: randomUUID(),
      at: new Date().toISOString(),
      type,
      title,
      detail: redact(detail),
      actor,
      prevHash: last ? JSON.parse(last.data as string).hash : "genesis",
    };
    const event = { ...payload, hash: digest(payload) };
    this.db
      .prepare("INSERT INTO audit(id,data) VALUES(?,?)")
      .run(event.id, JSON.stringify(event));
    return event;
  }
  auditList(): AuditEvent[] {
    return this.db
      .prepare("SELECT data FROM audit ORDER BY seq DESC LIMIT 300")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  verifyAudit() {
    let previous = "genesis";
    for (const r of this.db
      .prepare("SELECT data FROM audit ORDER BY seq")
      .all()) {
      const { hash, ...e } = JSON.parse(r.data as string);
      if (e.prevHash !== previous || digest(e) !== hash) return false;
      previous = hash;
    }
    return true;
  }
  close() {
    this.db.close();
  }
}
