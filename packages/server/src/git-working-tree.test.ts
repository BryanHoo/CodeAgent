import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("reads and combines immediate child repositories when the project root is not Git", async () => {
    const projectRoot = await mkdtemp(join(process.cwd(), ".git-status-test-"));
    const frontendRoot = join(projectRoot, "frontend");
    const backendRoot = join(projectRoot, "backend");
    const nestedRepositoryRoot = join(projectRoot, "workspace", "nested");
    try {
      await Promise.all([
        mkdir(join(frontendRoot, ".git"), { recursive: true }),
        mkdir(join(backendRoot, ".git"), { recursive: true }),
        mkdir(join(nestedRepositoryRoot, ".git"), { recursive: true }),
        mkdir(join(projectRoot, "notes"), { recursive: true }),
      ]);
      const visitedStatusRoots: string[] = [];
      const executeGit = (root: string, arguments_: readonly string[]) => {
        if (arguments_[0] === "status") {
          visitedStatusRoots.push(root);
          if (root === projectRoot) {
            return Promise.reject(new Error("not a git repository"));
          }
          if (root === frontendRoot) {
            return Promise.resolve(" M src/app.ts\0");
          }
          if (root === backendRoot) {
            return Promise.resolve("M  src/server.ts\0");
          }
        }

        const path = arguments_.at(-1) ?? "unknown";
        return Promise.resolve(`--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`);
      };

      const status = await readGitWorkingTreeStatus(projectRoot, executeGit);

      expect(status.staged.map((change) => change.path)).toEqual(["backend/src/server.ts"]);
      expect(status.unstaged.map((change) => change.path)).toEqual(["frontend/src/app.ts"]);
      expect(visitedStatusRoots.toSorted()).toEqual(
        [projectRoot, backendRoot, frontendRoot].toSorted(),
      );
      expect(visitedStatusRoots).not.toContain(nestedRepositoryRoot);
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
