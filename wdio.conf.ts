import { resolve } from "node:path";
import type { Options } from "@wdio/types";

const executable = process.platform === "win32" ? "codeagent.exe" : "codeagent";
const targetPath =
  process.platform === "darwin" ? ["target", "aarch64-apple-darwin"] : ["target"];
const buildProfile = process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug";
const appBinaryPath = resolve("src-tauri", ...targetPath, buildProfile, executable);
const realRuntimeEnabled = process.env.CODEAGENT_REAL_RUNTIME_TEST === "1";
const performanceEnabled = process.env.CODEAGENT_WEBVIEW_PERFORMANCE_TEST === "1";

export const config: Options.Testrunner = {
  bail: 0,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath },
    },
  ],
  connectionRetryCount: 1,
  connectionRetryTimeout: 90_000,
  framework: "mocha",
  logLevel: "warn",
  maxInstances: 1,
  mochaOpts: { timeout: 60_000, ui: "bdd" },
  reporters: ["spec"],
  runner: "local",
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        env: { CODEAGENT_WEBVIEW_TEST: "1" },
      },
    ],
  ],
  specs: performanceEnabled
    ? ["./tests/webview/performance.spec.ts"]
    : realRuntimeEnabled
      ? ["./tests/webview/real-codex-runtime.spec.ts"]
      : ["./tests/webview/critical-flows.spec.ts"],
  waitforTimeout: 10_000,
};
