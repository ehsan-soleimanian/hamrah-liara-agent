import { spawn, type ChildProcess } from "node:child_process";
import { config } from "./config.ts";
let demo: ChildProcess | undefined;
if (config.mode === "demo") {
  demo = spawn(process.execPath, ["--import", "tsx", "demo/index.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  demo.on("exit", (code) => {
    if (code && code !== 0) {
      console.error("Demo app exited unexpectedly.");
      process.exit(code);
    }
  });
  process.on("exit", () => demo?.kill());
}
await import("./index.ts");
