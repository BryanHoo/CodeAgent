import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { AgentItem, ProjectGitStatus } from "@code-agent/protocol";

type GitFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];
type GitWorkingTreeChanges = Pick<ProjectGitStatus, "staged" | "unstaged">;

type WorkingTreeEntry = Readonly<{
  indexStatus: string;
  path: string;
  workingTreeStatus: string;
}>;

const executeFile = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_UNTRACKED_DIFF_BYTES = 5 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 10_000;

async function executeGit(projectRoot: string, arguments_: readonly string[]): Promise<string> {
  const result = await executeFile("git", ["-C", projectRoot, ...arguments_], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return result.stdout;
}

export type GitCommandExecutor = (
  projectRoot: string,
  arguments_: readonly string[],
) => Promise<string>;

function parsePorcelainStatus(output: string): readonly WorkingTreeEntry[] {
  const records = output.split("\0");
  const entries: WorkingTreeEntry[] = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    if (record === undefined || record.length < 4) {
      continue;
    }
    const indexStatus = record[0] ?? " ";
    const workingTreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    entries.push({ indexStatus, path, workingTreeStatus });

    // Porcelain -z 会在重命名或复制记录后追加旧路径，本功能只展示新路径。
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      workingTreeStatus === "R" ||
      workingTreeStatus === "C"
    ) {
      recordIndex += 1;
    }
  }

  return entries;
}

function resolveChangeKind(status: string): GitFileChange["kind"] {
  if (status === "A" || status === "?") {
    return "create";
  }
  if (status === "D") {
    return "delete";
  }
  return "update";
}

async function createUntrackedFileDiff(projectRoot: string, path: string): Promise<GitFileChange> {
  const absolutePath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new TypeError("Git file path escapes the project root");
  }
  const fileStats = await lstat(absolutePath);
  if (fileStats.size > MAX_UNTRACKED_DIFF_BYTES) {
    return {
      diff: `--- /dev/null\n+++ b/${path}\nBinary files /dev/null and b/${path} differ`,
      kind: "create",
      path,
    };
  }

  // Git 记录的是符号链接目标文本，不能跟随链接读取 Project 外部文件。
  const content = fileStats.isSymbolicLink()
    ? Buffer.from(await readlink(absolutePath), "utf8")
    : await readFile(absolutePath);
  if (content.includes(0)) {
    return {
      diff: `--- /dev/null\n+++ b/${path}\nBinary files /dev/null and b/${path} differ`,
      kind: "create",
      path,
    };
  }

  const text = content.toString("utf8");
  const contentLines = text.length === 0 ? [] : text.replace(/\n$/u, "").split("\n");
  const hunk = `@@ -0,0 +1,${String(contentLines.length)} @@`;
  return {
    diff: [`--- /dev/null`, `+++ b/${path}`, hunk, ...contentLines.map((line) => `+${line}`)].join(
      "\n",
    ),
    kind: "create",
    path,
  };
}

async function createTrackedFileChange(
  projectRoot: string,
  entry: WorkingTreeEntry,
  location: "staged" | "unstaged",
  gitCommandExecutor: GitCommandExecutor,
): Promise<GitFileChange> {
  const status = location === "staged" ? entry.indexStatus : entry.workingTreeStatus;
  const diffArguments = [
    "diff",
    ...(location === "staged" ? ["--cached"] : []),
    "--no-color",
    "--no-ext-diff",
    "--",
    `:(literal)${entry.path}`,
  ];
  return {
    diff: await gitCommandExecutor(projectRoot, diffArguments),
    kind: resolveChangeKind(status),
    path: entry.path,
  };
}

async function hasGitMetadata(repositoryRoot: string): Promise<boolean> {
  try {
    await lstat(join(repositoryRoot, ".git"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readRepositoryWorkingTreeStatus(
  repositoryRoot: string,
  gitCommandExecutor: GitCommandExecutor,
): Promise<GitWorkingTreeChanges> {
  const statusOutput = await gitCommandExecutor(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const entries = parsePorcelainStatus(statusOutput);
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];

  for (const entry of entries) {
    if (entry.indexStatus !== " " && entry.indexStatus !== "?" && entry.indexStatus !== "!") {
      staged.push(
        await createTrackedFileChange(repositoryRoot, entry, "staged", gitCommandExecutor),
      );
    }
    if (entry.indexStatus === "?" && entry.workingTreeStatus === "?") {
      unstaged.push(await createUntrackedFileDiff(repositoryRoot, entry.path));
    } else if (entry.workingTreeStatus !== " " && entry.workingTreeStatus !== "!") {
      unstaged.push(
        await createTrackedFileChange(repositoryRoot, entry, "unstaged", gitCommandExecutor),
      );
    }
  }

  return { staged, unstaged };
}

async function readOptionalGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  gitCommandExecutor: GitCommandExecutor,
): Promise<string> {
  try {
    return await gitCommandExecutor(repositoryRoot, arguments_);
  } catch {
    return "";
  }
}

async function readRepositoryBranches(
  repositoryRoot: string,
  gitCommandExecutor: GitCommandExecutor,
): Promise<Pick<ProjectGitStatus, "baseBranches" | "branch">> {
  const [branchOutput, refsOutput, remoteHeadOutput] = await Promise.all([
    readOptionalGit(repositoryRoot, ["branch", "--show-current"], gitCommandExecutor),
    readOptionalGit(
      repositoryRoot,
      ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"],
      gitCommandExecutor,
    ),
    readOptionalGit(
      repositoryRoot,
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      gitCommandExecutor,
    ),
  ]);
  const branch = branchOutput.trim() || null;
  const branches = [...new Set(refsOutput.split("\n").map((ref) => ref.trim()))]
    .filter((ref) => ref !== "" && !ref.endsWith("/HEAD") && ref !== branch)
    .toSorted((left, right) => left.localeCompare(right));
  const remoteDefaultBranch = remoteHeadOutput.trim().replace(/^refs\/remotes\//u, "");
  const preferredBranch = [
    remoteDefaultBranch,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].find((candidate) => candidate !== "" && branches.includes(candidate));

  if (preferredBranch !== undefined) {
    branches.splice(branches.indexOf(preferredBranch), 1);
    branches.unshift(preferredBranch);
  }
  return { baseBranches: branches, branch };
}

function prefixRepositoryPath(repositoryName: string, change: GitFileChange): GitFileChange {
  return { ...change, path: `${repositoryName}/${change.path}` };
}

async function readImmediateChildRepositoryStatuses(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor,
): Promise<GitWorkingTreeChanges | undefined> {
  const childDirectories = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const repositoryCandidates = await Promise.all(
    childDirectories.map(async (entry) => {
      const repositoryRoot = join(projectRoot, entry.name);
      return (await hasGitMetadata(repositoryRoot))
        ? { name: entry.name, root: repositoryRoot }
        : null;
    }),
  );
  const repositories = repositoryCandidates.filter(
    (candidate): candidate is { name: string; root: string } => candidate !== null,
  );
  if (repositories.length === 0) {
    return undefined;
  }

  // 子仓库之间互不依赖，并行读取可避免多个 Git 项目形成串行等待。
  const statuses = await Promise.all(
    repositories.map(async (repository) => ({
      name: repository.name,
      status: await readRepositoryWorkingTreeStatus(repository.root, gitCommandExecutor),
    })),
  );
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  for (const repository of statuses) {
    staged.push(
      ...repository.status.staged.map((change) => prefixRepositoryPath(repository.name, change)),
    );
    unstaged.push(
      ...repository.status.unstaged.map((change) => prefixRepositoryPath(repository.name, change)),
    );
  }

  return { staged, unstaged };
}

export async function readGitWorkingTreeStatus(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // 每次读取都重新解析真实路径，避免 Project 根目录被符号链接替换后越过配置边界。
  const resolvedProjectRoot = await realpath(projectRoot);
  let status: GitWorkingTreeChanges;
  let repositoryBranches: Pick<ProjectGitStatus, "baseBranches" | "branch"> = {
    baseBranches: [],
    branch: null,
  };
  let repositoryMode: ProjectGitStatus["repositoryMode"] = "root";
  if (await hasGitMetadata(resolvedProjectRoot)) {
    status = await readRepositoryWorkingTreeStatus(resolvedProjectRoot, gitCommandExecutor);
    repositoryBranches = await readRepositoryBranches(resolvedProjectRoot, gitCommandExecutor);
  } else {
    // 只认 Project 自身的 .git，避免把上级仓库误判为可提交根仓库。
    const childStatus = await readImmediateChildRepositoryStatuses(
      resolvedProjectRoot,
      gitCommandExecutor,
    );
    if (childStatus === undefined) {
      throw new Error("Project root is not a Git repository");
    }
    status = childStatus;
    repositoryMode = "children";
  }

  const comparePaths = (left: GitFileChange, right: GitFileChange) =>
    left.path.localeCompare(right.path);
  const staged = status.staged.toSorted(comparePaths);
  const unstaged = status.unstaged.toSorted(comparePaths);
  const snapshot = createHash("sha256")
    .update(JSON.stringify({ branch: repositoryBranches.branch, repositoryMode, staged, unstaged }))
    .digest("hex");
  return {
    ...repositoryBranches,
    repositoryMode,
    snapshot,
    staged,
    unstaged,
  };
}
