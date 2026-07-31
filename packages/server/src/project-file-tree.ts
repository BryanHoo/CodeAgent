import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectFileTree, ProjectFileTreeEntry } from "@code-agent/protocol";
import createIgnore from "ignore";

export const MAX_PROJECT_FILE_TREE_DEPTH = 20;

type IgnoreMatcher = ReturnType<typeof createIgnore>;

type IgnoreScope = Readonly<{
  basePath: string;
  matcher: IgnoreMatcher;
}>;

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function compareEntries(left: Dirent, right: Dirent): number {
  const typeOrder = Number(right.isDirectory()) - Number(left.isDirectory());
  if (typeOrder !== 0) {
    return typeOrder;
  }
  return left.name.localeCompare(right.name, "en");
}

function joinProjectPath(parentPath: string, name: string): string {
  return parentPath.length === 0 ? name : `${parentPath}/${name}`;
}

async function readIgnoreScope(
  absoluteDirectory: string,
  relativeDirectory: string,
): Promise<IgnoreScope | undefined> {
  const ignoreFilePath = resolve(absoluteDirectory, ".gitignore");
  try {
    const stats = await lstat(ignoreFilePath);
    if (!stats.isFile()) {
      return undefined;
    }
    return {
      basePath: relativeDirectory,
      matcher: createIgnore().add(await readFile(ignoreFilePath, "utf8")),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isIgnoredByScopes(
  path: string,
  directory: boolean,
  scopes: readonly IgnoreScope[],
): boolean {
  let ignored = false;
  for (const scope of scopes) {
    const relativePath = scope.basePath.length === 0 ? path : path.slice(scope.basePath.length + 1);
    const result = scope.matcher.test(directory ? `${relativePath}/` : relativePath);
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      // 更深层 `.gitignore` 的反向规则覆盖祖先目录中的文件级规则。
      ignored = false;
    }
  }
  return ignored;
}

function parseDirectorySegments(directoryPath: string | undefined): readonly string[] {
  if (directoryPath === undefined) {
    return [];
  }
  if (
    directoryPath.startsWith("/") ||
    directoryPath.endsWith("/") ||
    directoryPath.includes("\\") ||
    directoryPath.includes("//") ||
    /^[A-Za-z]:/u.test(directoryPath)
  ) {
    throw new TypeError("Project file tree path must be project-relative");
  }
  const segments = directoryPath.split("/");
  if (
    segments.length > MAX_PROJECT_FILE_TREE_DEPTH ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project file tree path is invalid");
  }
  return segments;
}

async function resolveDirectoryContext(projectRoot: string, directoryPath: string | undefined) {
  const resolvedProjectRoot = await realpath(projectRoot);
  const segments = parseDirectorySegments(directoryPath);
  let absoluteDirectory = resolvedProjectRoot;
  let relativeDirectory = "";
  let ignoreScopes: readonly IgnoreScope[] = [];
  const rootIgnoreScope = await readIgnoreScope(absoluteDirectory, relativeDirectory);
  if (rootIgnoreScope !== undefined) {
    ignoreScopes = [rootIgnoreScope];
  }

  for (const segment of segments) {
    const nextRelativeDirectory = joinProjectPath(relativeDirectory, segment);
    if (
      ignoredDirectories.has(segment) ||
      isIgnoredByScopes(nextRelativeDirectory, true, ignoreScopes)
    ) {
      throw new TypeError("Project file tree directory is not available");
    }
    const nextAbsoluteDirectory = resolve(absoluteDirectory, segment);
    const stats = await lstat(nextAbsoluteDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TypeError("Project file tree path must identify a directory");
    }
    absoluteDirectory = nextAbsoluteDirectory;
    relativeDirectory = nextRelativeDirectory;
    const localIgnoreScope = await readIgnoreScope(absoluteDirectory, relativeDirectory);
    if (localIgnoreScope !== undefined) {
      ignoreScopes = [...ignoreScopes, localIgnoreScope];
    }
  }

  return { absoluteDirectory, ignoreScopes, relativeDirectory };
}

export async function readProjectFileTree(
  projectRoot: string,
  directoryPath?: string,
): Promise<ProjectFileTree> {
  const { absoluteDirectory, ignoreScopes, relativeDirectory } = await resolveDirectoryContext(
    projectRoot,
    directoryPath,
  );
  const children = (await readdir(absoluteDirectory, { withFileTypes: true })).sort(compareEntries);
  const entries: ProjectFileTreeEntry[] = [];

  for (const child of children) {
    // 符号链接不进入树，避免跟随链接越过 Project 根目录或形成递归环。
    if (child.name === ".git" || child.isSymbolicLink()) {
      continue;
    }
    if (child.isDirectory() && ignoredDirectories.has(child.name)) {
      continue;
    }
    if (!child.isDirectory() && !child.isFile()) {
      continue;
    }
    const path = joinProjectPath(relativeDirectory, child.name);
    if (isIgnoredByScopes(path, child.isDirectory(), ignoreScopes)) {
      continue;
    }
    entries.push({ path, type: child.isDirectory() ? "directory" : "file" });
  }

  return { entries, path: directoryPath ?? null };
}
