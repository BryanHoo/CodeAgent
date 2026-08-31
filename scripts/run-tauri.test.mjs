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

void test("Windows builds should default to an unpackaged executable", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--no-sign"], "win32"), [
    "build",
    "--no-bundle",
    "--no-sign",
  ]);
});

void test("Windows release should upload the unpackaged executable", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /name: Windows x64 Portable/);
  assert.match(workflow, /args: --no-bundle --no-sign --ci/);
  assert.match(workflow, /uploadPlainBinary: true/);
  assert.match(workflow, /\[name\]_\[version\]_\[arch\]_portable\[ext\]/);
});

void test("non-macOS commands should remain unchanged", () => {
  const argumentsList = ["build", "--no-sign"];

  assert.deepEqual(resolveTauriArguments(argumentsList, "linux"), argumentsList);
});
