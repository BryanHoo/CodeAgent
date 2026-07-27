import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  AgentSettingsRepository,
  ProjectRepository,
  RegisterProjectInput,
} from "@code-agent/core";
import type { AgentProjectDefaults, AgentTaskSettings, Project } from "@code-agent/protocol";

export type SqliteMigration = Readonly<{
  name: string;
  sql: string;
  version: number;
}>;

export type SqliteDatabaseDiagnostics = Readonly<{
  busyTimeout: number;
  foreignKeys: boolean;
  integrityCheck: string;
  journalMode: string;
  migrationVersion: number;
  synchronous: string;
  writable: boolean;
}>;

export interface SqliteStateRepositoryOptions {
  migrations?: readonly SqliteMigration[];
  now?: () => Date;
  requestTimeoutMs?: number;
  workerUrl?: URL;
}

const DEFAULT_SQLITE_REQUEST_TIMEOUT_MS = 10_000;

const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    name: "create_local_state",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE project_defaults (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE task_settings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      ) STRICT;
    `,
    version: 1,
  },
  {
    name: "create_task_metadata",
    sql: `
      CREATE TABLE task_metadata (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      ) STRICT;
    `,
    version: 2,
  },
  {
    name: "add_sandbox_mode_settings",
    sql: `
      ALTER TABLE project_defaults
        ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
        CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
      ALTER TABLE task_settings
        ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
        CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
    `,
    version: 3,
  },
];

type WorkerResponse =
  | Readonly<{ error: Readonly<{ message: string; name: string }>; id: number; type: "response" }>
  | Readonly<{ id: number; result: unknown; type: "response" }>
  | Readonly<{ error: Readonly<{ message: string; name: string }>; type: "fatal" }>
  | Readonly<{ type: "ready" }>;

type PendingRequest = Readonly<{
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}>;

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

function deserializeError(error: Readonly<{ message: string; name: string }>): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}

export class SqliteStateRepository implements ProjectRepository, AgentSettingsRepository {
  readonly #now: () => Date;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #ready: Promise<void>;
  readonly #requestTimeoutMs: number;
  readonly #worker: Worker;
  #closed = false;
  #nextRequestId = 1;

  private constructor(databasePath: string, options: SqliteStateRepositoryOptions) {
    if (!isAbsolute(databasePath)) {
      throw new Error("SQLite database path must be absolute");
    }
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_SQLITE_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new RangeError("SQLite request timeout must be a positive number");
    }
    this.#now = options.now ?? (() => new Date());
    this.#worker = new Worker(
      options.workerUrl ?? new URL("./sqlite-state-worker.js", import.meta.url),
      {
        workerData: {
          databasePath,
          migrations: options.migrations ?? SQLITE_MIGRATIONS,
        },
      },
    );
    this.#ready = new Promise<void>((resolveReady, rejectReady) => {
      let readySettled = false;
      const readyTimeout = setTimeout(() => {
        settleReadyError(
          new Error(
            `SQLite worker initialization timed out after ${String(this.#requestTimeoutMs)}ms`,
          ),
        );
      }, this.#requestTimeoutMs);
      const settleReady = (): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        resolveReady();
      };
      const settleReadyError = (error: Error): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        rejectReady(error);
      };
      const onMessage = (message: WorkerResponse): void => {
        if (message.type === "ready") {
          settleReady();
          return;
        }
        if (message.type === "fatal") {
          settleReadyError(deserializeError(message.error));
          return;
        }
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if ("error" in message) {
          pending.reject(deserializeError(message.error));
        } else {
          pending.resolve(message.result);
        }
      };
      this.#worker.on("message", onMessage);
      this.#worker.once("error", (error: unknown) => {
        const workerError = error instanceof Error ? error : new Error(String(error));
        settleReadyError(workerError);
        this.#rejectPending(workerError);
      });
      this.#worker.once("exit", (code) => {
        const workerError = new Error(`SQLite worker exited with code ${String(code)}`);
        settleReadyError(workerError);
        if (!this.#closed || this.#pending.size > 0) {
          this.#rejectPending(workerError);
        }
      });
    });
  }

  public static async open(
    databasePath: string,
    options: SqliteStateRepositoryOptions = {},
  ): Promise<SqliteStateRepository> {
    const repository = new SqliteStateRepository(databasePath, options);
    try {
      await repository.#ready;
      return repository;
    } catch (error) {
      repository.#closed = true;
      await repository.#worker.terminate();
      repository.#rejectPending(
        error instanceof Error ? error : new Error("SQLite worker initialization failed"),
      );
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      await this.#call("close", undefined, true);
    } finally {
      await this.#worker.terminate();
      this.#rejectPending(new Error("SQLite repository is closed"));
    }
  }

  public diagnose(): Promise<SqliteDatabaseDiagnostics> {
    return this.#call("diagnose");
  }

  public list(): Promise<readonly Project[]> {
    return this.#call("listProjects");
  }

  public read(projectId: string): Promise<Project | undefined> {
    return this.#call("readProject", { projectId });
  }

  public async register(input: RegisterProjectInput): Promise<Project> {
    const rootPath = await realpath(resolve(input.rootPath));
    if (!(await stat(rootPath)).isDirectory()) {
      throw new Error(`Project path is not a directory: ${rootPath}`);
    }
    // 文件系统根目录没有 basename，使用规范化路径保证 Project 名称始终非空。
    const name = input.name.trim() || basename(rootPath) || rootPath;
    return this.#call("registerProject", {
      project: {
        createdAt: this.#now().toISOString(),
        id: createProjectId(name, rootPath),
        name,
        rootPath,
      },
    });
  }

  public readProjectDefaults(projectId: string): Promise<AgentProjectDefaults | undefined> {
    return this.#call("readProjectDefaults", { projectId });
  }

  public readTaskSettings(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSettings | undefined> {
    return this.#call("readTaskSettings", { projectId, taskId });
  }

  public listPinnedTaskIds(projectId: string): Promise<readonly string[]> {
    return this.#call("listPinnedTaskIds", { projectId });
  }

  public writeProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
  ): Promise<AgentProjectDefaults> {
    return this.#call("writeProjectDefaults", {
      projectId,
      settings,
      updatedAt: this.#now().toISOString(),
    });
  }

  public writeTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
  ): Promise<AgentTaskSettings> {
    return this.#call("writeTaskSettings", {
      projectId,
      settings,
      taskId,
      updatedAt: this.#now().toISOString(),
    });
  }

  public writeTaskPinned(projectId: string, taskId: string, pinned: boolean): Promise<boolean> {
    return this.#call("writeTaskPinned", {
      pinned,
      projectId,
      taskId,
      updatedAt: this.#now().toISOString(),
    });
  }

  async #call<TResult>(
    operation: string,
    payload?: unknown,
    allowClosed = false,
  ): Promise<TResult> {
    await this.#ready;
    if (this.#closed && !allowClosed) {
      throw new Error("SQLite repository is closed");
    }
    const id = this.#nextRequestId++;
    return new Promise<TResult>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.has(id)) {
          return;
        }
        const error = new Error(
          `SQLite worker operation ${operation} timed out after ${String(this.#requestTimeoutMs)}ms`,
        );
        // 超时后无法确认 Worker 是否仍会写入，终止整个 Repository 避免继续使用未知状态。
        this.#closed = true;
        this.#rejectPending(error);
        void this.#worker.terminate();
      }, this.#requestTimeoutMs);
      this.#pending.set(id, {
        reject: rejectRequest,
        resolve: (value) => {
          resolveRequest(value as TResult);
        },
        timeout,
      });
      try {
        this.#worker.postMessage({ id, operation, payload });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
