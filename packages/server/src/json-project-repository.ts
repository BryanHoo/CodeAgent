import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { ProjectRepository, RegisterProjectInput } from "@code-agent/core";
import type { Project } from "@code-agent/protocol";

interface JsonProjectRepositoryOptions {
  now?: () => Date;
}

type ProjectFile = Readonly<{
  projects: readonly Project[];
  version: 1;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["createdAt"] === "string" &&
    !Number.isNaN(Date.parse(value["createdAt"])) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    typeof value["rootPath"] === "string" &&
    isAbsolute(value["rootPath"])
  );
}

function parseProjectFile(text: string): ProjectFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("Invalid projects file: JSON parsing failed", { cause: error });
  }
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !Array.isArray(value["projects"]) ||
    !value["projects"].every(isProject)
  ) {
    throw new Error("Invalid projects file: schema validation failed");
  }
  const ids = new Set<string>();
  const roots = new Set<string>();
  for (const project of value["projects"]) {
    if (ids.has(project.id) || roots.has(resolve(project.rootPath))) {
      throw new Error("Invalid projects file: duplicate project identity");
    }
    ids.add(project.id);
    roots.add(resolve(project.rootPath));
  }
  return { projects: value["projects"], version: 1 };
}

function createProjectId(name: string, rootPath: string): string {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 12);
  return `${slug || "project"}-${hash}`;
}

export class JsonProjectRepository implements ProjectRepository {
  readonly #filePath: string;
  readonly #now: () => Date;
  #mutationQueue: Promise<void> = Promise.resolve();

  public constructor(filePath: string, options: JsonProjectRepositoryOptions = {}) {
    if (!isAbsolute(filePath)) {
      throw new Error("Projects file path must be absolute");
    }
    this.#filePath = filePath;
    this.#now = options.now ?? (() => new Date());
  }

  public async list(): Promise<readonly Project[]> {
    await this.#mutationQueue;
    return (await this.#readFile()).projects;
  }

  public async read(projectId: string): Promise<Project | undefined> {
    return (await this.list()).find((project) => project.id === projectId);
  }

  public register(input: RegisterProjectInput): Promise<Project> {
    const operation = this.#mutationQueue.then(() => this.#registerOnce(input));
    this.#mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #registerOnce(input: RegisterProjectInput): Promise<Project> {
    const rootPath = await realpath(resolve(input.rootPath));
    if (!(await stat(rootPath)).isDirectory()) {
      throw new Error(`Project path is not a directory: ${rootPath}`);
    }
    const file = await this.#readFile();
    const existing = file.projects.find(
      (project) => resolve(project.rootPath) === resolve(rootPath),
    );
    if (existing !== undefined) {
      return existing;
    }
    // 文件系统根目录没有 basename，使用规范化根路径保证持久化契约始终有效。
    const name = input.name.trim() || basename(rootPath) || rootPath;
    const project: Project = {
      createdAt: this.#now().toISOString(),
      id: createProjectId(name, rootPath),
      name,
      rootPath,
    };
    await this.#writeFile({ projects: [...file.projects, project], version: 1 });
    return project;
  }

  async #readFile(): Promise<ProjectFile> {
    try {
      return parseProjectFile(await readFile(this.#filePath, "utf8"));
    } catch (error) {
      if (isRecord(error) && error["code"] === "ENOENT") {
        return { projects: [], version: 1 };
      }
      throw error;
    }
  }

  async #writeFile(file: ProjectFile): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, this.#filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
