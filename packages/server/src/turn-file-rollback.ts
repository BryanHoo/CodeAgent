import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { AgentItem } from "@code-agent/protocol";

type AgentFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];

export type PatchDirection = "forward" | "reverse";

export type PatchExecutor = (
  projectRoot: string,
  patch: string,
  direction: PatchDirection,
  checkOnly: boolean,
) => Promise<void>;

export type PreparedTurnFileRollback = Readonly<{
  applyForward: () => Promise<void>;
  applyReverse: () => Promise<void>;
  restoredFiles: readonly string[];
}>;

const MAX_PATCH_BYTES = 10 * 1024 * 1024;
const MAX_GIT_ERROR_BYTES = 64 * 1024;
const GIT_APPLY_TIMEOUT_MS = 10_000;

export class TurnFileRollbackError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnFileRollbackError";
  }
}

function isPathOutsideRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function resolveSafeChangePath(projectRoot: string, filePath: string): string {
  if (filePath.includes("\0")) {
    throw new TurnFileRollbackError("File change path contains a null byte");
  }
  const platformPath = filePath.replaceAll("/", sep).replaceAll("\\", sep);
  const absolutePath = isAbsolute(platformPath)
    ? resolve(platformPath)
    : resolve(projectRoot, platformPath);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath.length === 0 || isPathOutsideRoot(relativePath)) {
    throw new TurnFileRollbackError("File change path escapes the project root");
  }
  const normalizedPath = relativePath.split(sep).join("/");
  if (normalizedPath === ".git" || normalizedPath.startsWith(".git/")) {
    throw new TurnFileRollbackError("Git metadata cannot be rolled back");
  }
  return normalizedPath;
}

function createSafePatchHeaders(
  change: AgentFileChange,
  normalizedPath: string,
): readonly [string, string] {
  return [
    `--- ${change.kind === "create" ? "/dev/null" : `a/${normalizedPath}`}`,
    `+++ ${change.kind === "delete" ? "/dev/null" : `b/${normalizedPath}`}`,
  ];
}

function normalizeChangePatch(change: AgentFileChange, normalizedPath: string): string {
  if (/^(?:GIT binary patch|Binary files )/mu.test(change.diff)) {
    throw new TurnFileRollbackError(`Binary file changes cannot be rolled back: ${normalizedPath}`);
  }

  const normalizedDiff = change.diff.replaceAll("\r\n", "\n").trimEnd();
  const lines = normalizedDiff.length === 0 ? [] : normalizedDiff.split("\n");
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "));
  const headers = createSafePatchHeaders(change, normalizedPath);

  if (firstHunkIndex >= 0) {
    // Provider 的文件头不可用于写操作，只保留 Hunk 并重建受 Project 约束的路径。
    return [...headers, ...lines.slice(firstHunkIndex)].join("\n");
  }
  if (change.kind === "update") {
    throw new TurnFileRollbackError(`Update patch has no unified diff hunk: ${normalizedPath}`);
  }

  const bodyLines = lines;
  const bodyPrefix = change.kind === "create" ? "+" : "-";
  const hunkHeader =
    change.kind === "create"
      ? `@@ -0,0 +1,${String(bodyLines.length)} @@`
      : `@@ -1,${String(bodyLines.length)} +0,0 @@`;
  return [...headers, hunkHeader, ...bodyLines.map((line) => `${bodyPrefix}${line}`)].join("\n");
}

async function executeGitPatch(
  projectRoot: string,
  patch: string,
  direction: PatchDirection,
  checkOnly: boolean,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const arguments_ = [
      "-C",
      projectRoot,
      "apply",
      "--recount",
      "--whitespace=nowarn",
      ...(direction === "reverse" ? ["--reverse"] : []),
      ...(checkOnly ? ["--check"] : []),
    ];
    const child = spawn("git", arguments_, {
      shell: false,
      timeout: GIT_APPLY_TIMEOUT_MS,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_GIT_ERROR_BYTES) {
        stderr += chunk.slice(0, MAX_GIT_ERROR_BYTES - stderr.length);
      }
    });
    child.once("error", (error) => {
      rejectPromise(new TurnFileRollbackError("Unable to start git apply", { cause: error }));
    });
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new TurnFileRollbackError(
          stderr.trim() || `git apply exited with code ${String(exitCode)}`,
        ),
      );
    });
    child.stdin.end(patch, "utf8");
  });
}

export async function prepareTurnFileRollback(
  projectRoot: string,
  changes: readonly AgentFileChange[],
  patchExecutor: PatchExecutor = executeGitPatch,
): Promise<PreparedTurnFileRollback> {
  if (!isAbsolute(projectRoot)) {
    throw new TurnFileRollbackError("Project root must be absolute");
  }
  if (changes.length === 0) {
    throw new TurnFileRollbackError("Turn has no file changes to roll back");
  }

  const resolvedProjectRoot = await realpath(projectRoot);
  const restoredFiles = changes.map((change) =>
    resolveSafeChangePath(resolvedProjectRoot, change.path),
  );
  if (new Set(restoredFiles).size !== restoredFiles.length) {
    // 多段依赖补丁无法在一次原子预检中可靠验证，Provider 应返回每个文件的最终 Diff。
    throw new TurnFileRollbackError("Turn contains multiple patches for the same file");
  }
  const patch = changes
    .map((change, changeIndex) =>
      normalizeChangePatch(change, restoredFiles[changeIndex] ?? change.path),
    )
    .join("\n");
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new TurnFileRollbackError("Turn rollback patch is too large");
  }

  await patchExecutor(resolvedProjectRoot, patch, "reverse", true);
  return {
    applyForward: () => patchExecutor(resolvedProjectRoot, patch, "forward", false),
    applyReverse: () => patchExecutor(resolvedProjectRoot, patch, "reverse", false),
    restoredFiles: [...new Set(restoredFiles)],
  };
}
