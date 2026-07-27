import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteStateRepository, type SqliteMigration } from "./sqlite-state-repository.js";

type RepositoryTestOptions = Readonly<{
  migrations?: readonly SqliteMigration[];
  requestTimeoutMs?: number;
  workerUrl?: URL;
}>;

const repositories: SqliteStateRepository[] = [];

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "code-agent-sqlite-"));
}

async function openRepository(
  root: string,
  options: RepositoryTestOptions = {},
): Promise<SqliteStateRepository> {
  const repository = await SqliteStateRepository.open(join(root, "state.sqlite3"), options);
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});

describe("SqliteStateRepository", () => {
  it("runs strict migrations and configures the required pragmas", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);

    await expect(repository.diagnose()).resolves.toEqual({
      busyTimeout: 5_000,
      foreignKeys: true,
      integrityCheck: "ok",
      journalMode: "wal",
      migrationVersion: 1,
      synchronous: "normal",
      writable: true,
    });
  });

  it("rolls back a failed migration without recording its version", async () => {
    const root = await createWorkspace();
    const migrations = [
      {
        name: "create_probe",
        sql: "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY) STRICT;",
        version: 1,
      },
      {
        name: "fail_probe",
        sql: "CREATE TABLE broken_probe (id INTEGER PRIMARY KEY) STRICT; INVALID SQL;",
        version: 2,
      },
    ] as const;

    await expect(openRepository(root, { migrations })).rejects.toThrow(/migration|syntax/u);
    const reopened = await openRepository(root, { migrations: migrations.slice(0, 1) });

    await expect(reopened.diagnose()).resolves.toMatchObject({ migrationVersion: 1 });
  });

  it("treats duplicate real paths as one project", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    const projectAlias = join(root, "workspace-alias");
    await mkdir(projectRoot);
    await symlink(projectRoot, projectAlias);
    const repository = await openRepository(root);
    const registered = await repository.register({ name: "Project", rootPath: projectRoot });

    const duplicate = await repository.register({ name: "Duplicate", rootPath: projectAlias });

    expect(duplicate.id).toBe(registered.id);
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("isolates project defaults and task settings across projects", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = await repository.register({ name: "First", rootPath: firstRoot });
    const second = await repository.register({ name: "Second", rootPath: secondRoot });

    await repository.writeProjectDefaults(first.id, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    await repository.writeProjectDefaults(second.id, {
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });
    await repository.writeTaskSettings(first.id, "task-1", {
      approvalPolicy: "never",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    await repository.writeTaskSettings(second.id, "task-1", {
      approvalPolicy: "on-request",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });

    await expect(repository.readProjectDefaults(first.id)).resolves.toEqual({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    await expect(repository.readProjectDefaults(second.id)).resolves.toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });
    await expect(repository.readTaskSettings(first.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "never",
    });
    await expect(repository.readTaskSettings(second.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "on-request",
    });
  });

  it("atomically replaces complete settings and restores them after reopening", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const project = await repository.register({ name: "Workspace", rootPath: projectRoot });
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "never",
      model: "old-model",
      reasoningEffort: "low",
    });
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "on-request",
      model: "new-model",
      reasoningEffort: "high",
    });
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);

    await expect(reopened.readTaskSettings(project.id, "task-1")).resolves.toEqual({
      approvalPolicy: "on-request",
      model: "new-model",
      reasoningEffort: "high",
    });
    await expect(reopened.read(project.id)).resolves.toEqual(project);
  });

  it("terminates an unresponsive worker after the request deadline", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      requestTimeoutMs: 20,
      workerUrl: new URL("../test/fixtures/unresponsive-sqlite-worker.mjs", import.meta.url),
    });

    await expect(repository.close()).rejects.toThrow(/close.*timed out/u);
  });
});
