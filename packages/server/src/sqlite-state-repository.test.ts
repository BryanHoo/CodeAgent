import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Project } from "@code-agent/protocol";

import { SqliteStateRepository, type SqliteMigration } from "./sqlite-state-repository.js";
import { SQLITE_MIGRATIONS } from "./sqlite-state-migrations.js";

type RepositoryTestOptions = Readonly<{
  migrations?: readonly SqliteMigration[];
  requestTimeoutMs?: number;
  workerUrl?: URL;
}>;

const repositories: SqliteStateRepository[] = [];

function createProject(id: string, name: string, rootPath: string): Project {
  return { createdAt: "2026-08-21T00:00:00.000Z", id, name, rootPath };
}

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
      migrationVersion: 17,
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

  it("persists temporary task settings without creating a Project", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.writeTaskSettings("temporary", "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      sandboxMode: "workspace-write",
    });

    await expect(repository.read("temporary")).resolves.toBeUndefined();
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.readTaskSettings("temporary", "task-1")).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      sandboxMode: "workspace-write",
    });
  });

  it("removes the legacy temporary Project without losing its task settings", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const version16 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 16),
    });
    await version16.close();
    repositories.splice(repositories.indexOf(version16), 1);

    const database = new Database(databasePath);
    database
      .prepare(
        `INSERT INTO projects (id, name, root_path, created_at, sort_order, kind)
         VALUES ('temporary', 'Temporary', '/workspace/temporary', ?, 0, 'temporary')`,
      )
      .run("2026-08-21T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO task_settings
           (project_id, task_id, approval_policy, approvals_reviewer, model,
            reasoning_effort, sandbox_mode, updated_at)
         VALUES ('temporary', 'task-1', 'never', 'user', 'gpt-5.6-sol',
                 'high', 'read-only', ?)`,
      )
      .run("2026-08-21T00:00:00.000Z");
    database.close();

    const upgraded = await openRepository(root);
    await expect(upgraded.read("temporary")).resolves.toBeUndefined();
    await expect(upgraded.readTaskSettings("temporary", "task-1")).resolves.toMatchObject({
      approvalPolicy: "never",
      model: "gpt-5.6-sol",
      sandboxMode: "read-only",
    });
  });

  it("atomically projects Codex projects by id while allowing a shared root path", async () => {
    const root = await createWorkspace();
    const sharedRoot = join(root, "shared-workspace");
    const otherRoot = join(root, "other-workspace");
    await Promise.all([mkdir(sharedRoot), mkdir(otherRoot)]);
    const repository = await openRepository(root);
    const first = {
      createdAt: "2026-08-21T01:00:00.000Z",
      id: "codex-project-1",
      name: "First",
      rootPath: sharedRoot,
    };
    const second = {
      createdAt: "2026-08-21T02:00:00.000Z",
      id: "codex-project-2",
      name: "Second",
      rootPath: sharedRoot,
    };

    await expect(repository.replaceProjects([first, second])).resolves.toEqual([first, second]);
    await repository.writeProjectDefaults(first.id, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });

    const updatedFirst = { ...first, name: "Updated First", rootPath: otherRoot };
    await expect(repository.replaceProjects([second, updatedFirst])).resolves.toEqual([
      second,
      updatedFirst,
    ]);
    await expect(repository.readProjectDefaults(first.id)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
    });
  });

  it("applies incremental Codex project projection mutations", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = {
      createdAt: "2026-08-21T01:00:00.000Z",
      id: "codex-project-1",
      name: "First",
      rootPath: firstRoot,
    };
    const second = {
      createdAt: "2026-08-21T02:00:00.000Z",
      id: "codex-project-2",
      name: "Second",
      rootPath: secondRoot,
    };

    await repository.upsertProject(first);
    await repository.upsertProject(second);
    await expect(repository.setProjectOrder([second.id, first.id])).resolves.toEqual([
      second,
      first,
    ]);
    await expect(repository.upsertProject({ ...first, name: "Renamed" })).resolves.toEqual({
      ...first,
      name: "Renamed",
    });
    await expect(repository.deleteProject(second.id)).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([{ ...first, name: "Renamed" }]);
  });

  it("moves project settings to the Codex id without losing task history settings", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const legacyProject = createProject("legacy-local-id", "Workspace", projectRoot);
    const codexProject = { ...legacyProject, id: "codex-project-id" };
    await repository.upsertProject(legacyProject);
    await repository.writeProjectDefaults(legacyProject.id, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await repository.writeTaskSettings(legacyProject.id, "legacy-task", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });

    await expect(repository.migrateProject(legacyProject.id, codexProject)).resolves.toEqual(
      codexProject,
    );
    await expect(repository.read(legacyProject.id)).resolves.toBeUndefined();
    await expect(repository.readProjectDefaults(codexProject.id)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
    });
    await expect(
      repository.readTaskSettings(codexProject.id, "legacy-task"),
    ).resolves.toMatchObject({ approvalPolicy: "never" });
  });

  it("persists the one-time project source migration state", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);

    await expect(repository.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: false,
    });
    await repository.completeProjectSourceMigration();
    await expect(repository.readProjectSourceMigration()).resolves.toEqual({
      completed: true,
      recoverUnassigned: false,
    });
  });

  it("enables unassigned thread recovery only when upgrading an existing version 14 database", async () => {
    const root = await createWorkspace();
    const version14 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 14),
    });
    await version14.close();
    repositories.splice(repositories.indexOf(version14), 1);

    const upgraded = await openRepository(root);

    await expect(upgraded.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: true,
    });
  });

  it("reopens recovery after version 15 incorrectly completed without vscode threads", async () => {
    const root = await createWorkspace();
    const version14 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 14),
    });
    await version14.close();
    repositories.splice(repositories.indexOf(version14), 1);

    const brokenVersion15 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 15),
    });
    await brokenVersion15.completeProjectSourceMigration();
    await brokenVersion15.close();
    repositories.splice(repositories.indexOf(brokenVersion15), 1);

    const repaired = await openRepository(root);

    await expect(repaired.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: true,
    });
  });

  it("persists complete project ordering and appends newly registered projects", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const thirdRoot = join(root, "third");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot), mkdir(thirdRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await expect(repository.setProjectOrder([second.id, first.id])).resolves.toEqual([
      second,
      first,
    ]);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    const third = createProject("codex-third", "Third", thirdRoot);
    await reopened.upsertProject(third);
    await expect(reopened.list()).resolves.toEqual([second, first, third]);
  });

  it("rejects incomplete or duplicated project ordering without partial writes", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await expect(repository.setProjectOrder([second.id])).rejects.toThrow(
      /every project exactly once/u,
    );
    await expect(repository.setProjectOrder([first.id, first.id])).rejects.toThrow(
      /every project exactly once/u,
    );
    await expect(repository.list()).resolves.toEqual([first, second]);
  });

  it("updates and removes only the local Codex project projection", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const project = createProject("codex-workspace", "Workspace", projectRoot);
    await repository.upsertProject(project);
    await repository.writeProjectDefaults(project.id, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });

    const renamed = await repository.upsertProject({ ...project, name: "工作区别名" });

    expect(renamed).toEqual({ ...project, name: "工作区别名" });
    expect(renamed.rootPath).toBe(project.rootPath);
    await expect(repository.deleteProject("missing")).resolves.toBe(false);
    await expect(repository.deleteProject(project.id)).resolves.toBe(true);
    await expect(repository.read(project.id)).resolves.toBeUndefined();
    await expect(repository.readProjectDefaults(project.id)).resolves.toBeUndefined();
    await expect(stat(projectRoot)).resolves.toMatchObject({});

    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);
    const reopened = await openRepository(root);
    await expect(reopened.list()).resolves.toEqual([]);
    await expect(stat(projectRoot)).resolves.toMatchObject({});
  });

  it("isolates project defaults and task settings across projects", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await repository.writeProjectDefaults(first.id, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await repository.writeProjectDefaults(second.id, {
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await repository.writeTaskSettings(first.id, "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await repository.writeTaskSettings(second.id, "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });

    await expect(repository.readProjectDefaults(first.id)).resolves.toEqual({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await expect(repository.readProjectDefaults(second.id)).resolves.toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await expect(repository.readTaskSettings(first.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
    await expect(repository.readTaskSettings(second.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
  });

  it("atomically replaces complete settings and restores them after reopening", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const project = createProject("codex-workspace", "Workspace", projectRoot);
    await repository.upsertProject(project);
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "old-model",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "new-model",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);

    await expect(reopened.readTaskSettings(project.id, "task-1")).resolves.toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "new-model",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await expect(reopened.read(project.id)).resolves.toEqual(project);
  });

  it("persists one complete global settings record across repository restarts", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const settings = {
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "auto_review" as const,
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "突出说明用户可见影响。",
      defaultOpenAppId: "visual-studio-code" as const,
      fastMode: true,
      followUpBehavior: "steer" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };

    await expect(repository.readGlobalSettings()).resolves.toBeUndefined();
    await expect(repository.writeGlobalSettings(settings)).resolves.toEqual(settings);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    await expect(reopened.readGlobalSettings()).resolves.toEqual(settings);
  });

  it("repairs global settings columns required across version switches", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath);
    try {
      // 模拟版本切换后迁移记录仍在、但新版字段被旧 Schema 移除的状态。
      database.exec("ALTER TABLE global_settings DROP COLUMN fast_mode;");
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readGlobalSettings()).resolves.toBeUndefined();
    await reopened.close();
    repositories.splice(repositories.indexOf(reopened), 1);

    const repairedDatabase = new Database(databasePath, { readonly: true });
    try {
      const columnNames = repairedDatabase
        .prepare("PRAGMA table_info(global_settings)")
        .all()
        .map((column) => (column as { name: string }).name);
      expect(columnNames).toEqual(
        expect.arrayContaining(["commit_message_reasoning_effort", "fast_mode"]),
      );
    } finally {
      repairedDatabase.close();
    }
  });

  it("persists non-sensitive provider connection metadata across repository restarts", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    const record = {
      customBaseUrl: "https://api.example.com/v1",
      customModels: {
        data: [
          {
            defaultReasoningEffort: "medium",
            description: "Custom model",
            displayName: "custom-model",
            id: "custom-model",
            isDefault: true,
            supportedReasoningEfforts: [{ description: "Medium", id: "medium" }],
          },
        ],
        nextCursor: null,
      },
      mode: "custom" as const,
      updatedAt: "2026-08-07T10:00:00.000Z",
    };

    await expect(repository.readProviderConnection()).resolves.toBeUndefined();
    await expect(repository.writeProviderConnection(record)).resolves.toEqual(record);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath, { readonly: true });
    try {
      const columnNames = database
        .prepare("PRAGMA table_info(provider_connection)")
        .all()
        .map((column) => (column as { name: string }).name);
      expect(columnNames).toEqual([
        "id",
        "mode",
        "custom_base_url",
        "custom_models_json",
        "updated_at",
      ]);
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readProviderConnection()).resolves.toEqual(record);
  });

  it("rejects corrupted provider model JSON at the repository boundary", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath);
    try {
      database
        .prepare(
          `INSERT INTO provider_connection (
             id, mode, custom_base_url, custom_models_json, updated_at
           ) VALUES (1, 'custom', 'https://api.example.com/v1', '{broken', ?)`,
        )
        .run("2026-08-07T10:00:00.000Z");
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readProviderConnection()).rejects.toThrow(/model JSON/u);
  });

  it("removes obsolete task metadata after migration", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await SqliteStateRepository.open(databasePath);
    await repository.close();

    const database = new Database(databasePath, { readonly: true });
    try {
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'task_metadata'").get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("terminates an unresponsive worker after the request deadline", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      // 为 Worker 初始化预留稳定余量，同时保持关闭请求的测试等待有界。
      requestTimeoutMs: 200,
      workerUrl: new URL("../test/fixtures/unresponsive-sqlite-worker.mjs", import.meta.url),
    });

    await expect(repository.close()).rejects.toThrow(/close.*timed out/u);
  });
});
