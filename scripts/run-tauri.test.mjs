import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveTauriArguments } from "./tauri-build-constraints.mjs";

void test("the project Tauri command should enforce platform build constraints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

  assert.equal(packageJson.scripts.tauri, "node scripts/run-tauri.mjs");
});

void test("the main window should allow SPA navigation event subscriptions", async () => {
  const capability = JSON.parse(
    await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url)),
  );

  assert.ok(capability.permissions.includes("core:event:allow-listen"));
  assert.ok(capability.permissions.includes("core:event:allow-unlisten"));
});

void test("macOS builds should default to the Apple Silicon target", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--no-sign"], "darwin"), [
    "build",
    "--target",
    "aarch64-apple-darwin",
    "--no-sign",
  ]);
});

void test("macOS builds should reject an Intel target", () => {
  assert.throws(
    () => resolveTauriArguments(["build", "-t", "x86_64-apple-darwin"], "darwin"),
    /aarch64-apple-darwin/,
  );
});

void test("Windows builds should preserve an explicit updater bundle", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--bundles", "nsis", "--no-sign"], "win32"), [
    "build",
    "--bundles",
    "nsis",
    "--no-sign",
  ]);
});

void test("Windows local builds should still default to an unpackaged executable", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--no-sign"], "win32"), [
    "build",
    "--no-bundle",
    "--no-sign",
  ]);
});

void test("Windows releases should publish portable and updater NSIS artifacts", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /- name: Windows x64 Portable[\s\S]*?args: --no-bundle --no-sign --ci[\s\S]*?uploadPlainBinary: true[\s\S]*?uploadUpdaterArtifacts: false/,
  );
  assert.match(workflow, /releaseAssetNamePattern: "\[name\]_\[version\]_\[arch\]_portable\[ext\]"/);
  assert.match(
    workflow,
    /- name: Windows x64 NSIS[\s\S]*?args: --bundles nsis --ci[\s\S]*?uploadPlainBinary: false[\s\S]*?uploadUpdaterArtifacts: true/,
  );
});

void test("bundled releases should publish signed updater artifacts", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(workflow, /uploadUpdaterJson: \$\{\{ matrix\.uploadUpdaterArtifacts \}\}/);
  assert.match(workflow, /uploadUpdaterSignatures: \$\{\{ matrix\.uploadUpdaterArtifacts \}\}/);
  assert.match(workflow, /prerelease: false/);
});

void test("Tauri should use signed GitHub release metadata", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json",
  ]);
});

void test("Windows should verify Codex through the app instead of the Tauri test harness", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/webview.yml", import.meta.url),
    "utf8",
  );

  // Tauri 的 Windows 测试进程存在装载器问题，产品应用链路仍必须保留真实运行时覆盖。
  assert.match(
    workflow,
    /name: Run real Codex lifecycle test\n\s+if: matrix\.platform != 'windows-latest'/,
  );
  assert.match(
    workflow,
    /name: Run real Codex WebView chain\n\s+if: matrix\.platform != 'ubuntu-24\.04'/,
  );
});

void test("native WebView CI should install the supported Codex runtime", async () => {
  const [workflow, processSource] = await Promise.all([
    readFile(new URL("../.github/workflows/webview.yml", import.meta.url), "utf8"),
    readFile(
      new URL("../src-tauri/src/infrastructure/codex/process.rs", import.meta.url),
      "utf8",
    ),
  ]);
  const installedVersion = workflow.match(/npm install --global @openai\/codex@(\d+\.\d+\.\d+)/)?.[1];
  const supportedVersion = processSource.match(
    /SUPPORTED_CODEX_VERSION: &str = "(\d+\.\d+\.\d+)"/,
  )?.[1];

  assert.ok(installedVersion, "native WebView CI must pin a Codex runtime version");
  assert.ok(supportedVersion, "Rust must declare a supported Codex runtime version");
  assert.equal(installedVersion, supportedVersion);
});

void test("non-macOS commands should remain unchanged", () => {
  const argumentsList = ["build", "--no-sign"];

  assert.deepEqual(resolveTauriArguments(argumentsList, "linux"), argumentsList);
});
