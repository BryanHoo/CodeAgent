import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SOURCE_FILE_PREVIEW_BYTES,
  MAX_SOURCE_FILE_PREVIEW_LINES,
  readProjectSourceFile,
} from "./project-source-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-source-"));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "docs"));
  return projectRoot;
}

describe("readProjectSourceFile", () => {
  it("reads text files under the project root using a relative response path", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "architecture-design.md");
    await writeFile(sourcePath, "# Architecture\n\nDetails\n");

    await expect(readProjectSourceFile(projectRoot, sourcePath)).resolves.toEqual({
      content: "# Architecture\n\nDetails\n",
      path: "docs/architecture-design.md",
      truncated: false,
    });
  });

  it("bounds large previews without reading their full contents", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "large.md");
    await writeFile(sourcePath, "x".repeat(MAX_SOURCE_FILE_PREVIEW_BYTES + 4_096));

    const preview = await readProjectSourceFile(projectRoot, sourcePath);

    expect(Buffer.byteLength(preview.content, "utf8")).toBeLessThanOrEqual(
      MAX_SOURCE_FILE_PREVIEW_BYTES,
    );
    expect(preview.truncated).toBe(true);
  });

  it("bounds previews with many short lines", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "many-lines.md");
    await writeFile(sourcePath, "line\n".repeat(MAX_SOURCE_FILE_PREVIEW_LINES + 100));

    const preview = await readProjectSourceFile(projectRoot, sourcePath);

    expect(preview.content.split("\n")).toHaveLength(MAX_SOURCE_FILE_PREVIEW_LINES);
    expect(preview.truncated).toBe(true);
  });

  it("rejects files and symbolic links outside the project root", async () => {
    const projectRoot = await createTemporaryProject();
    const outsidePath = join(tmpdir(), `outside-${String(Date.now())}.md`);
    temporaryDirectories.push(outsidePath);
    await writeFile(outsidePath, "secret");
    const linkedPath = join(projectRoot, "docs", "outside.md");
    await symlink(outsidePath, linkedPath);

    await expect(readProjectSourceFile(projectRoot, outsidePath)).rejects.toThrow(
      "outside the project root",
    );
    await expect(readProjectSourceFile(projectRoot, linkedPath)).rejects.toThrow(
      "outside the project root",
    );
  });
});
