import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { commitSelectedProjectChanges } from "./git-commit.js";
import type { GitCommitError } from "./git-commit.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const executeFile = promisify(execFile);
const temporaryRoots: string[] = [];

async function runGit(root: string, ...arguments_: string[]) {
  return executeFile("git", ["-C", root, ...arguments_], { encoding: "utf8" });
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "code-agent-git-commit-test-"));
  temporaryRoots.push(root);
  await runGit(root, "init", "--initial-branch=main");
  await runGit(root, "config", "user.name", "CodeAgent Test");
  await runGit(root, "config", "user.email", "code-agent@example.com");
  await Promise.all([
    writeFile(join(root, "selected.txt"), "selected old\n"),
    writeFile(join(root, "unselected.txt"), "unselected old\n"),
  ]);
  await runGit(root, "add", "--all");
  await runGit(root, "commit", "-m", "chore(test): 初始化仓库");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("commitSelectedProjectChanges", () => {
  it("commits only selected tracked and untracked files while preserving other staged files", async () => {
    const root = await createRepository();
    await Promise.all([
      writeFile(join(root, "selected.txt"), "selected current\n"),
      writeFile(join(root, "unselected.txt"), "unselected staged\n"),
      writeFile(join(root, "new.txt"), "new selected\n"),
    ]);
    await runGit(root, "add", "--", "unselected.txt");
    const status = await readGitWorkingTreeStatus(root);

    const result = await commitSelectedProjectChanges(root, {
      action: "commit",
      expectedSnapshot: status.snapshot,
      message: "feat(git): 提交选择文件",
      paths: ["selected.txt", "new.txt"],
    });

    const committedFiles = await runGit(root, "show", "--format=", "--name-only", "HEAD");
    const stagedFiles = await runGit(root, "diff", "--cached", "--name-only");
    expect(committedFiles.stdout.trim().split("\n").toSorted()).toEqual([
      "new.txt",
      "selected.txt",
    ]);
    expect(stagedFiles.stdout.trim()).toBe("unselected.txt");
    expect(result).toMatchObject({
      branch: "main",
      message: "feat(git): 提交选择文件",
      pushStatus: "not_requested",
    });
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/u);
  });

  it("rejects stale snapshots and paths outside the current changes", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "changed\n");
    const status = await readGitWorkingTreeStatus(root);

    await expect(
      commitSelectedProjectChanges(root, {
        action: "commit",
        expectedSnapshot: "0".repeat(64),
        message: "fix(git): 修复提交",
        paths: ["selected.txt"],
      }),
    ).rejects.toMatchObject({ code: "GIT_STATUS_CHANGED" } satisfies Partial<GitCommitError>);
    await expect(
      commitSelectedProjectChanges(root, {
        action: "commit",
        expectedSnapshot: status.snapshot,
        message: "fix(git): 修复提交",
        paths: ["missing.txt"],
      }),
    ).rejects.toMatchObject({ code: "GIT_PATH_UNAVAILABLE" } satisfies Partial<GitCommitError>);
  });

  it("keeps a successful commit when push has no configured upstream", async () => {
    const root = await createRepository();
    await writeFile(join(root, "selected.txt"), "changed\n");
    const status = await readGitWorkingTreeStatus(root);

    await expect(
      commitSelectedProjectChanges(root, {
        action: "commit_and_push",
        expectedSnapshot: status.snapshot,
        message: "fix(git): 修复提交",
        paths: ["selected.txt"],
      }),
    ).resolves.toMatchObject({ pushStatus: "not_configured" });
    await expect(runGit(root, "log", "-1", "--pretty=%s")).resolves.toMatchObject({
      stdout: "fix(git): 修复提交\n",
    });
  });
});
