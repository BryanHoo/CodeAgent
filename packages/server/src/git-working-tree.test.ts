import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readGitWorkingTreeStatus } from "./git-working-tree.js";

describe("readGitWorkingTreeStatus", () => {
  it("reads the repository through the real parameterized Git command", async () => {
    const status = await readGitWorkingTreeStatus(process.cwd());

    expect(Array.isArray(status.staged)).toBe(true);
    expect(Array.isArray(status.unstaged)).toBe(true);
  });

  it("separates staged, unstaged, untracked, and partially staged changes", async () => {
    const projectRoot = await mkdtemp(join(process.cwd(), ".git-status-test-"));
    try {
      await writeFile(join(projectRoot, "untracked.txt"), "new file\n");
      const executeGit = (_root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          return Promise.resolve("MM partial.txt\0M  staged.txt\0?? untracked.txt\0");
        }
        const path = arguments_.at(-1) ?? "unknown";
        const location = arguments_.includes("--cached") ? "staged" : "unstaged";
        return Promise.resolve(
          `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-original\n+${location} version\n`,
        );
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit);

      expect(status.staged.map((change) => change.path)).toEqual(["partial.txt", "staged.txt"]);
      expect(status.unstaged.map((change) => change.path)).toEqual([
        "partial.txt",
        "untracked.txt",
      ]);
      expect(status.unstaged.find((change) => change.path === "untracked.txt")).toMatchObject({
        kind: "create",
      });
      expect(status.staged[0]?.diff).toContain("+staged version");
      expect(status.unstaged[0]?.diff).toContain("+unstaged version");
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("rejects relative project roots before invoking Git", async () => {
    await expect(readGitWorkingTreeStatus("relative/project")).rejects.toThrow(
      "Project root must be absolute",
    );
  });
});
