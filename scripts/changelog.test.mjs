import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractVersionNotes } from "./changelog.mjs";

const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const releaseWorkflow = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

void test("extracts the dated changelog section for a release", () => {
  const notes = extractVersionNotes(changelog, "0.1.6");

  assert.match(notes, /^## \[0\.1\.6\] - 2026-09-04$/m);
  assert.match(notes, /^### Added$/m);
  assert.match(notes, /桌面端定时任务/u);
  assert.match(notes, /Skills 市场/u);
  assert.match(notes, /^### Changed$/m);
  assert.match(notes, /应用生命周期/u);
  assert.match(notes, /^### Fixed$/m);
  assert.match(notes, /全屏状态/u);
  assert.match(notes, /事件背压/u);
  assert.doesNotMatch(notes, /^## \[Unreleased\]$/m);
});

void test("rejects a release version missing from the changelog", () => {
  assert.throws(() => extractVersionNotes(changelog, "9.9.9"), /9\.9\.9/);
});

void test("publishes the matching changelog section as the GitHub release body", () => {
  assert.match(releaseWorkflow, /node scripts\/release-notes\.mjs/);
  assert.match(releaseWorkflow, /id: release-notes\n\s+shell: bash/);
  assert.match(releaseWorkflow, /releaseBody: \$\{\{ steps\.release-notes\.outputs\.body \}\}/);
});
