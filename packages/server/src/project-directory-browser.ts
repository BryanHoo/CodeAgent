import type { Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import type { ProjectDirectoryListing } from "@code-agent/protocol";

import { listFilesystemRoots } from "./filesystem-roots.js";

export type ProjectDirectoryBrowserErrorReason = "directory-unavailable" | "invalid-directory";

export class ProjectDirectoryBrowserError extends Error {
  public constructor(
    message: string,
    public readonly reason: ProjectDirectoryBrowserErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectDirectoryBrowserError";
  }
}

type ProjectDirectoryBrowserOptions = Readonly<{
  filesystemRoots?: typeof listFilesystemRoots;
  homePath?: string;
}>;

function toDirectoryError(error: unknown): ProjectDirectoryBrowserError {
  const code = (error as NodeJS.ErrnoException).code;
  const unavailable = code === "EACCES" || code === "EPERM";
  return new ProjectDirectoryBrowserError(
    unavailable ? "Project directory is not accessible" : "Project directory is invalid",
    unavailable ? "directory-unavailable" : "invalid-directory",
    { cause: error instanceof Error ? error : undefined },
  );
}

function compareDirectories(left: Dirent, right: Dirent): number {
  return (
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en")
  );
}

export async function resolveProjectDirectory(
  requestedPath?: string,
  options: ProjectDirectoryBrowserOptions = {},
): Promise<string> {
  const path = requestedPath ?? options.homePath ?? homedir();
  if (!isAbsolute(path)) {
    throw new ProjectDirectoryBrowserError(
      "Project directory path must be absolute",
      "invalid-directory",
    );
  }

  try {
    const normalizedPath = await realpath(path);
    if (!(await lstat(normalizedPath)).isDirectory()) {
      throw new ProjectDirectoryBrowserError(
        "Project directory path must identify a directory",
        "invalid-directory",
      );
    }
    return normalizedPath;
  } catch (error) {
    if (error instanceof ProjectDirectoryBrowserError) {
      throw error;
    }
    throw toDirectoryError(error);
  }
}

export async function readProjectDirectory(
  requestedPath?: string,
  options: ProjectDirectoryBrowserOptions = {},
): Promise<ProjectDirectoryListing> {
  const [path, roots] = await Promise.all([
    resolveProjectDirectory(requestedPath, options),
    (options.filesystemRoots ?? listFilesystemRoots)(),
  ]);
  let children: Dirent[];
  try {
    children = await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw toDirectoryError(error);
  }

  // 浏览接口只暴露真实直接子目录；文件和符号链接不会进入可递归展开的目录树。
  const entries = children
    .filter((child) => child.isDirectory() && !child.isSymbolicLink())
    .sort(compareDirectories)
    .map((child) => ({ name: child.name, path: join(path, child.name) }));
  const parentPath = dirname(path);
  return {
    entries,
    parentPath: parentPath === path ? null : parentPath,
    path,
    roots,
  };
}
