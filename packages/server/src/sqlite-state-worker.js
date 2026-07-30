import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
  };
}

function projectFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
  };
}

function projectDefaultsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

function taskSettingsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    approvalPolicy: row.approval_policy,
    approvalsReviewer: row.approvals_reviewer,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

function globalSettingsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    approvalPolicy: row.approval_policy,
    approvalsReviewer: row.approvals_reviewer,
    defaultOpenAppId: row.default_open_app_id,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

function configureDatabase(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
}

function runMigrations(database, migrations) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  let previousVersion = 0;
  for (const migration of migrations) {
    if (
      !Number.isInteger(migration.version) ||
      migration.version <= previousVersion ||
      typeof migration.name !== "string" ||
      typeof migration.sql !== "string"
    ) {
      throw new Error("Invalid SQLite migration definition");
    }
    previousVersion = migration.version;
    if (applied.has(migration.version)) {
      continue;
    }
    // DDL 与版本记录必须同事务提交，失败时数据库仍停留在上一个完整版本。
    database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

function hasTable(database, tableName) {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== undefined
  );
}

function createOperations(database) {
  const statements = hasTable(database, "projects")
    ? {
        insertProject: database.prepare(
          `INSERT OR IGNORE INTO projects (id, name, root_path, created_at, sort_order)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM projects))`,
        ),
        listProjects: database.prepare(
          "SELECT id, name, root_path, created_at FROM projects ORDER BY sort_order, created_at, id",
        ),
        listProjectIds: database.prepare(
          "SELECT id FROM projects ORDER BY sort_order, created_at, id",
        ),
        readProject: database.prepare(
          "SELECT id, name, root_path, created_at FROM projects WHERE id = ?",
        ),
        readProjectByRoot: database.prepare(
          "SELECT id, name, root_path, created_at FROM projects WHERE root_path = ?",
        ),
        writeProjectSortOrder: database.prepare("UPDATE projects SET sort_order = ? WHERE id = ?"),
        readProjectDefaults: database.prepare(
          "SELECT model, reasoning_effort, sandbox_mode FROM project_defaults WHERE project_id = ?",
        ),
        readGlobalSettings: database.prepare(
          "SELECT approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode, default_open_app_id FROM global_settings WHERE id = 1",
        ),
        readTaskSettings: database.prepare(
          "SELECT approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode FROM task_settings WHERE project_id = ? AND task_id = ?",
        ),
        listPinnedTaskIds: database.prepare(
          "SELECT task_id FROM task_metadata WHERE project_id = ? AND pinned = 1 ORDER BY task_id",
        ),
        writeProjectDefaults: database.prepare(`
      INSERT INTO project_defaults (project_id, model, reasoning_effort, sandbox_mode, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        updated_at = excluded.updated_at
    `),
        writeGlobalSettings: database.prepare(`
      INSERT INTO global_settings (
        id, approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode, default_open_app_id, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        approval_policy = excluded.approval_policy,
        approvals_reviewer = excluded.approvals_reviewer,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        default_open_app_id = excluded.default_open_app_id,
        updated_at = excluded.updated_at
    `),
        writeTaskSettings: database.prepare(`
      INSERT INTO task_settings (
        project_id, task_id, approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, task_id) DO UPDATE SET
        approval_policy = excluded.approval_policy,
        approvals_reviewer = excluded.approvals_reviewer,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        updated_at = excluded.updated_at
        `),
        writeTaskPinned: database.prepare(`
      INSERT INTO task_metadata (project_id, task_id, pinned, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, task_id) DO UPDATE SET
        pinned = excluded.pinned,
        updated_at = excluded.updated_at
        `),
      }
    : undefined;

  function requireStatements() {
    if (statements === undefined) {
      throw new Error("SQLite state tables are unavailable");
    }
    return statements;
  }

  const reorderProjects = database.transaction((projectIds) => {
    const stateStatements = requireStatements();
    const storedProjectIds = stateStatements.listProjectIds.all().map((row) => row.id);
    const requestedProjectIds = new Set(projectIds);
    const containsCompleteProjectSet =
      projectIds.length === storedProjectIds.length &&
      requestedProjectIds.size === storedProjectIds.length &&
      storedProjectIds.every((projectId) => requestedProjectIds.has(projectId));
    if (!containsCompleteProjectSet) {
      throw new Error("Project order must contain every project exactly once");
    }

    // 完整顺序在同一事务内替换，读取方不会观察到部分重排。
    projectIds.forEach((projectId, sortOrder) => {
      stateStatements.writeProjectSortOrder.run(sortOrder, projectId);
    });
    return stateStatements.listProjects.all().map(projectFromRow);
  });

  return {
    diagnose() {
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (-1, 'doctor', ?)",
          )
          .run(new Date().toISOString());
      } finally {
        database.exec("ROLLBACK");
      }
      const synchronousValue = database.pragma("synchronous", { simple: true });
      return {
        busyTimeout: database.pragma("busy_timeout", { simple: true }),
        foreignKeys: database.pragma("foreign_keys", { simple: true }) === 1,
        integrityCheck: database.pragma("integrity_check", { simple: true }),
        journalMode: database.pragma("journal_mode", { simple: true }),
        migrationVersion: database
          .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
          .get().version,
        synchronous: synchronousValue === 1 ? "normal" : String(synchronousValue),
        writable: true,
      };
    },
    listProjects() {
      return requireStatements().listProjects.all().map(projectFromRow);
    },
    listPinnedTaskIds(payload) {
      return requireStatements()
        .listPinnedTaskIds.all(payload.projectId)
        .map((row) => row.task_id);
    },
    readProject(payload) {
      return projectFromRow(requireStatements().readProject.get(payload.projectId));
    },
    reorderProjects(payload) {
      return reorderProjects(payload.projectIds);
    },
    readProjectDefaults(payload) {
      return projectDefaultsFromRow(requireStatements().readProjectDefaults.get(payload.projectId));
    },
    readGlobalSettings() {
      return globalSettingsFromRow(requireStatements().readGlobalSettings.get());
    },
    readTaskSettings(payload) {
      return taskSettingsFromRow(
        requireStatements().readTaskSettings.get(payload.projectId, payload.taskId),
      );
    },
    registerProject(payload) {
      const stateStatements = requireStatements();
      const project = payload.project;
      stateStatements.insertProject.run(
        project.id,
        project.name,
        project.rootPath,
        project.createdAt,
      );
      const stored = projectFromRow(stateStatements.readProjectByRoot.get(project.rootPath));
      if (stored === undefined) {
        throw new Error("Project identity conflicts with another root path");
      }
      return stored;
    },
    writeProjectDefaults(payload) {
      const settings = payload.settings;
      requireStatements().writeProjectDefaults.run(
        payload.projectId,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        payload.updatedAt,
      );
      return settings;
    },
    writeGlobalSettings(payload) {
      const settings = payload.settings;
      requireStatements().writeGlobalSettings.run(
        settings.approvalPolicy,
        settings.approvalsReviewer,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        settings.defaultOpenAppId,
        payload.updatedAt,
      );
      return settings;
    },
    writeTaskPinned(payload) {
      requireStatements().writeTaskPinned.run(
        payload.projectId,
        payload.taskId,
        payload.pinned ? 1 : 0,
        payload.updatedAt,
      );
      return payload.pinned;
    },
    writeTaskSettings(payload) {
      const settings = payload.settings;
      requireStatements().writeTaskSettings.run(
        payload.projectId,
        payload.taskId,
        settings.approvalPolicy,
        settings.approvalsReviewer,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        payload.updatedAt,
      );
      return settings;
    },
  };
}

let database;
try {
  mkdirSync(resolve(workerData.databasePath, ".."), { recursive: true });
  database = new Database(workerData.databasePath);
  configureDatabase(database);
  runMigrations(database, workerData.migrations);
  const operations = createOperations(database);
  parentPort.on("message", (message) => {
    try {
      if (message.operation === "close") {
        database.close();
        parentPort.postMessage({ id: message.id, result: null, type: "response" });
        parentPort.close();
        return;
      }
      const operation = operations[message.operation];
      if (typeof operation !== "function") {
        throw new Error(`Unknown SQLite worker operation: ${String(message.operation)}`);
      }
      parentPort.postMessage({
        id: message.id,
        result: operation(message.payload),
        type: "response",
      });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: serializeError(error), type: "response" });
    }
  });
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  database?.close();
  parentPort.postMessage({ error: serializeError(error), type: "fatal" });
  parentPort.close();
}
