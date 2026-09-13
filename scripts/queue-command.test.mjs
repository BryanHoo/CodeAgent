import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

void test("prompt submission command is registered and granted only to main", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.ok(read("src-tauri/build.rs").includes('"submit_prompt"'));
  assert.ok(read("src-tauri/src/lib.rs").includes("submit_prompt,"));
  for (const set of read("src-tauri/permissions/window-command-sets.toml").split("[[set]]").slice(1)) {
    assert.equal(set.includes('"allow-submit-prompt"'), set.includes('identifier = "main-window-commands"'));
  }
});

void test("queue move command replaces raw reorder and is granted only to the main window", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const manifest = read("src-tauri/build.rs");
  const handlers = read("src-tauri/src/lib.rs");
  const permissions = read("src-tauri/permissions/window-command-sets.toml");
  assert.ok(manifest.includes('"move_queued_submission"'));
  assert.ok(handlers.includes("move_queued_submission,"));
  assert.ok(!manifest.includes('"reorder_queued_submissions"'));
  assert.ok(!handlers.includes("reorder_queued_submissions,"));
  assert.ok(!permissions.includes('"allow-reorder-queued-submissions"'));
  const sets = permissions.split("[[set]]").slice(1);
  assert.ok(sets.some((set) => set.includes('identifier = "main-window-commands"')));
  for (const set of sets) {
    assert.equal(set.includes('"allow-move-queued-submission"'), set.includes('identifier = "main-window-commands"'));
  }
});
