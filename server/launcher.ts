import { spawn, type ChildProcess } from "node:child_process";
import { config } from "./config.ts";
import { Vault } from "./vault.ts";
import { restoreConnection } from "./connection.ts";
import { modeRuntime } from "./runtime-mode.ts";
restoreConnection(new Vault(config.dataDir));
let demo: ChildProcess | undefined;
let demoReady: Promise<void> | undefined;
modeRuntime.prepare = async (mode) => {
  if (mode !== "demo") return;
  if (demoReady) return demoReady;
  demo = spawn(process.execPath, ["--import", "tsx", "demo/index.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });
  const child = demo;
  demoReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "راه‌اندازی فروشگاه نمایشی به پایان نرسید؛ دوباره تلاش کنید.",
        ),
      );
    }, 20000);
    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data);
      if (data.toString().includes("Golbazar demo:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("فروشگاه نمایشی راه‌اندازی نشد."));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      demo = undefined;
      demoReady = undefined;
      reject(new Error("فروشگاه نمایشی متوقف شد."));
    });
  });
  return demoReady;
};
process.on("exit", () => demo?.kill());
await modeRuntime.prepare(config.mode);
await import("./index.ts");
