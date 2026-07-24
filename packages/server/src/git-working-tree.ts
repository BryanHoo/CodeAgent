import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { AgentItem, ProjectGitStatus } from "@code-agent/protocol";

type GitFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];

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

export async function readGitWorkingTreeStatus(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // 每次读取都重新解析真实路径，避免 Project 根目录被符号链接替换后越过配置边界。
  const resolvedProjectRoot = await realpath(projectRoot);
  const statusOutput = await gitCommandExecutor(resolvedProjectRoot, [
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
        await createTrackedFileChange(resolvedProjectRoot, entry, "staged", gitCommandExecutor),
      );
    }
    if (entry.indexStatus === "?" && entry.workingTreeStatus === "?") {
      unstaged.push(await createUntrackedFileDiff(resolvedProjectRoot, entry.path));
    } else if (entry.workingTreeStatus !== " " && entry.workingTreeStatus !== "!") {
      unstaged.push(
        await createTrackedFileChange(resolvedProjectRoot, entry, "unstaged", gitCommandExecutor),
      );
    }
  }

  const comparePaths = (left: GitFileChange, right: GitFileChange) =>
    left.path.localeCompare(right.path);
  return { staged: staged.toSorted(comparePaths), unstaged: unstaged.toSorted(comparePaths) };
}
