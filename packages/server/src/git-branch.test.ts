import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitBranchError, switchProjectBranch } from "./git-branch.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const temporaryRoots: string[] = [];

async function createRepositoryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code-agent-git-branch-test-")));
  temporaryRoots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("switchProjectBranch", () => {
  it("switches only to a local branch from the expected snapshot", async () => {
    const projectRoot = await createRepositoryRoot();
    let currentBranch = "main";
    const executeGit = vi.fn((_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] === "status") {
        return Promise.resolve("");
      }
      if (arguments_[0] === "branch") {
        return Promise.resolve(`${currentBranch}\n`);
      }
      if (arguments_[0] === "for-each-ref") {
        return Promise.resolve(
          arguments_.includes("refs/remotes")
            ? "main\nfeat/switch\norigin/main\n"
            : "main\nfeat/switch\n",
        );
      }
      if (arguments_[0] === "symbolic-ref") {
        return Promise.resolve("refs/remotes/origin/main\n");
      }
      if (arguments_[0] === "switch") {
        currentBranch = arguments_[2] ?? currentBranch;
        return Promise.resolve("");
      }
      throw new Error(`Unexpected Git command: ${arguments_.join(" ")}`);
    });
    const initial = await readGitWorkingTreeStatus(projectRoot, executeGit);

    const result = await switchProjectBranch(
      projectRoot,
      { branch: "feat/switch", expectedSnapshot: initial.snapshot },
      executeGit,
    );

    expect(executeGit).toHaveBeenCalledWith(projectRoot, ["switch", "--no-guess", "feat/switch"]);
    expect(result.branch).toBe("feat/switch");
  });

  it("rejects stale, unknown, active, and read-only branch switches before mutation", async () => {
    const projectRoot = await createRepositoryRoot();
    const rootStatus = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main", "feat/switch"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };
    const executeGit = vi.fn(() => Promise.resolve(""));

    for (const [request, status, code] of [
      [
        { branch: "feat/switch", expectedSnapshot: "b".repeat(64) },
        rootStatus,
        "SNAPSHOT_MISMATCH",
      ],
      [
        { branch: "missing", expectedSnapshot: rootStatus.snapshot },
        rootStatus,
        "BRANCH_NOT_FOUND",
      ],
      [{ branch: "main", expectedSnapshot: rootStatus.snapshot }, rootStatus, "ALREADY_ACTIVE"],
      [
        { branch: "feat/switch", expectedSnapshot: rootStatus.snapshot },
        { ...rootStatus, repositoryMode: "children" as const },
        "REPOSITORY_READ_ONLY",
      ],
    ] as const) {
      await expect(
        switchProjectBranch(projectRoot, request, executeGit, () => Promise.resolve(status)),
      ).rejects.toMatchObject({ code });
    }

    expect(executeGit).not.toHaveBeenCalled();
  });

  it("maps Git command failures without exposing their output", async () => {
    const projectRoot = await createRepositoryRoot();
    const status = {
      baseBranches: ["origin/main"],
      branch: "main",
      branches: ["main", "feat/switch"],
      repositoryMode: "root" as const,
      snapshot: "a".repeat(64),
      staged: [],
      unstaged: [],
    };

    await expect(
      switchProjectBranch(
        projectRoot,
        { branch: "feat/switch", expectedSnapshot: status.snapshot },
        () => Promise.reject(new Error("fatal: /private/worktree conflict")),
        () => Promise.resolve(status),
      ),
    ).rejects.toEqual(new GitBranchError("SWITCH_FAILED", "Git branch switch failed"));
  });
});
