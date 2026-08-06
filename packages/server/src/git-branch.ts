import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { ProjectGitStatus, SwitchProjectBranchRequest } from "@code-agent/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

export type GitBranchErrorCode =
  | "ALREADY_ACTIVE"
  | "BRANCH_NOT_FOUND"
  | "REPOSITORY_READ_ONLY"
  | "SNAPSHOT_MISMATCH"
  | "SWITCH_FAILED";

export class GitBranchError extends Error {
  public readonly code: GitBranchErrorCode;

  public constructor(code: GitBranchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GitBranchError";
  }
}

type GitStatusReader = (
  projectRoot: string,
  gitCommandExecutor?: GitCommandExecutor,
) => Promise<ProjectGitStatus>;

export async function switchProjectBranch(
  projectRoot: string,
  request: SwitchProjectBranchRequest,
  gitCommandExecutor: GitCommandExecutor = executeGit,
  readStatus: GitStatusReader = readGitWorkingTreeStatus,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // Mutation 与状态读取共享同一个真实根目录，避免切换期间符号链接改变执行边界。
  const repositoryRoot = await realpath(projectRoot);
  const status = await readStatus(repositoryRoot, gitCommandExecutor);
  if (status.repositoryMode !== "root") {
    throw new GitBranchError("REPOSITORY_READ_ONLY", "Git repository mode is read-only");
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new GitBranchError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed");
  }
  if (!status.branches.includes(request.branch)) {
    throw new GitBranchError("BRANCH_NOT_FOUND", "Git branch is not available");
  }
  if (status.branch === request.branch) {
    throw new GitBranchError("ALREADY_ACTIVE", "Git branch is already active");
  }

  try {
    await gitCommandExecutor(repositoryRoot, ["switch", "--no-guess", request.branch]);
  } catch {
    throw new GitBranchError("SWITCH_FAILED", "Git branch switch failed");
  }
  return readStatus(repositoryRoot, gitCommandExecutor);
}
