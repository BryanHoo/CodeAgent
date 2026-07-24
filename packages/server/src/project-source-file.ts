import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ProjectSourceFile } from "@code-agent/protocol";

export const MAX_SOURCE_FILE_PREVIEW_BYTES = 256 * 1_024;
export const MAX_SOURCE_FILE_PREVIEW_LINES = 4_000;

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export async function readProjectSourceFile(
  projectRoot: string,
  requestedPath: string,
): Promise<ProjectSourceFile> {
  if (!isAbsolute(projectRoot) || requestedPath.length === 0) {
    throw new TypeError("Project root and source path must be valid");
  }

  const resolvedProjectRoot = await realpath(projectRoot);
  const candidatePath = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(resolvedProjectRoot, requestedPath);
  const resolvedSourcePath = await realpath(candidatePath);
  const projectRelativePath = relative(resolvedProjectRoot, resolvedSourcePath);
  if (isOutsideProject(projectRelativePath)) {
    throw new TypeError("Source file is outside the project root");
  }

  const sourceStats = await stat(resolvedSourcePath);
  if (!sourceStats.isFile()) {
    throw new TypeError("Source path is not a regular file");
  }

  const previewByteLength = Math.min(sourceStats.size, MAX_SOURCE_FILE_PREVIEW_BYTES);
  const previewBuffer = Buffer.alloc(previewByteLength);
  const sourceFileHandle = await open(resolvedSourcePath, "r");
  try {
    await sourceFileHandle.read(previewBuffer, 0, previewByteLength, 0);
  } finally {
    await sourceFileHandle.close();
  }
  if (previewBuffer.includes(0)) {
    throw new TypeError("Binary source files cannot be previewed");
  }

  const decodedContent = new TextDecoder().decode(previewBuffer);
  const previewLines = decodedContent.split("\n");
  const exceedsLineLimit = previewLines.length > MAX_SOURCE_FILE_PREVIEW_LINES;

  return {
    content: exceedsLineLimit
      ? previewLines.slice(0, MAX_SOURCE_FILE_PREVIEW_LINES).join("\n")
      : decodedContent,
    path: projectRelativePath.split(sep).join("/"),
    truncated: sourceStats.size > previewByteLength || exceedsLineLimit,
  };
}
