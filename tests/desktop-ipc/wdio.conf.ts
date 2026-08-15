import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { TauriCapabilities } from "@wdio/tauri-service";

const root = resolve(import.meta.dirname, "../..");
const appBinaryPath = resolve(
  root,
  "target/debug/bundle/macos/CodeAgent.app/Contents/MacOS/code-agent-desktop",
);
const testRoot = mkdtempSync(join(tmpdir(), "code-agent-desktop-ipc-"));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version: string;
};

process.env["CODEX_HOME"] = join(testRoot, "codex");
process.env["CODE_AGENT_E2E_DATA_ROOT"] = join(testRoot, "data");
process.env["CODE_AGENT_E2E_VERSION"] = manifest.version;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [resolve(import.meta.dirname, "app-info.e2e.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath },
    } as TauriCapabilities,
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        captureBackendLogs: true,
        driverProvider: "embedded",
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "info",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
