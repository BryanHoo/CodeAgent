import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { JsonProjectRepository } from "./json-project-repository.js";

const temporaryDirectories: string[] = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "code-agent-projects-"));
  temporaryDirectories.push(root);
  const projectRoot = join(root, "Workspace");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(projectRoot);
  return {
    filePath: join(root, "codex-home", "code-agent", "projects.json"),
    projectRoot,
    root,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("JsonProjectRepository", () => {
  it("starts empty and atomically persists registered projects", async () => {
    const fixture = await createFixture();
    const repository = new JsonProjectRepository(fixture.filePath, {
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });

    await expect(repository.list()).resolves.toEqual([]);
    const project = await repository.register({ name: "Workspace", rootPath: fixture.projectRoot });
    await expect(new JsonProjectRepository(fixture.filePath).list()).resolves.toEqual([project]);
    expect(JSON.parse(await readFile(fixture.filePath, "utf8"))).toEqual({
      projects: [project],
      version: 1,
    });
    expect(await readdir(join(fixture.root, "codex-home", "code-agent"))).toEqual([
      "projects.json",
    ]);
  });

  it("deduplicates real paths and serializes concurrent registrations", async () => {
    const fixture = await createFixture();
    const repository = new JsonProjectRepository(fixture.filePath);

    const [first, second] = await Promise.all([
      repository.register({ name: "Workspace", rootPath: fixture.projectRoot }),
      repository.register({ name: "Renamed", rootPath: fixture.projectRoot }),
    ]);

    expect(second).toEqual(first);
    await expect(repository.list()).resolves.toEqual([first]);
    await expect(repository.read(first.id)).resolves.toEqual(first);
  });

  it("persists a non-empty project name for a filesystem root", async () => {
    const fixture = await createFixture();
    const filesystemRoot = parse(fixture.root).root;
    const repository = new JsonProjectRepository(fixture.filePath);

    const project = await repository.register({ name: "", rootPath: filesystemRoot });

    expect(project.name).toBe(filesystemRoot);
    await expect(new JsonProjectRepository(fixture.filePath).list()).resolves.toEqual([project]);
  });

  it("rejects malformed persisted data", async () => {
    const fixture = await createFixture();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(fixture.root, "codex-home", "code-agent"), { recursive: true });
    await writeFile(fixture.filePath, '{"version":1,"projects":[{"id":"unsafe"}]}', "utf8");

    await expect(new JsonProjectRepository(fixture.filePath).list()).rejects.toThrow(
      "Invalid projects file",
    );
  });
});
