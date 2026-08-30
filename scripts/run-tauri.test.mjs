import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveTauriArguments } from "./tauri-build-constraints.mjs";

void test("the project Tauri command should enforce platform build constraints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

  assert.equal(packageJson.scripts.tauri, "node scripts/run-tauri.mjs");
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

void test("non-macOS commands should remain unchanged", () => {
  const argumentsList = ["build", "--no-sign"];

  assert.deepEqual(resolveTauriArguments(argumentsList, "linux"), argumentsList);
});
