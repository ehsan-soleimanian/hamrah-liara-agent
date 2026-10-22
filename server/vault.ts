import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import path from "node:path";

// Local single-user vault. The key is outside exports and Git; protect data/ with OS permissions.
export class Vault {
  private key: Buffer;
  private dir: string;
  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "vault");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(this.dir, "master.key");
    if (!existsSync(keyPath)) {
      try {
        writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
      } catch (e) {
        if (!existsSync(keyPath)) throw e;
      }
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("کلید مخزن امن معتبر نیست.");
  }
  private filename(name: string) {
    return path.join(
      this.dir,
      createHash("sha256").update(name).digest("hex") + ".enc",
    );
  }
  put(name: string, value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(name));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    const content = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    const target = this.filename(name),
      temp = target + ".tmp";
    writeFileSync(temp, content, { mode: 0o600 });
    renameSync(temp, target);
  }
  get<T>(name: string): T | undefined {
    const target = this.filename(name);
    if (!existsSync(target)) return undefined;
    const bytes = readFileSync(target),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
}
