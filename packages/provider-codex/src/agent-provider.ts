import { Buffer } from "node:buffer";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AgentProvider,
  AgentProviderAttachment,
  AgentProviderEvent,
  AgentProviderEventListener,
  AgentProviderTaskSnapshot,
  AgentProviderTurnInput,
  AgentRuntimeProvider,
  AgentTaskUnsubscribeStatus,
  ListAgentTasksInput,
  ResolvePendingRequestInput,
  StartAgentTaskOptions,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentBackgroundTerminal,
  AgentBackgroundTerminalPage,
  AgentMessageAttachment,
  AgentMcpServerPage,
  AgentTask,
  AgentTaskPage,
  AgentTurn,
  AgentModelPage,
  AgentTurnOptions,
  AgentReviewTarget,
  AgentSandboxMode,
  AgentSkillPage,
  PendingRequest,
  Project,
  UploadAgentFeedbackRequest,
} from "@code-agent/protocol";
import pino from "pino";

import {
  RpcResponseError,
  type RpcErrorPayload,
  type RpcRequestId,
  type RpcServerRequest,
} from "./jsonl-rpc-client.js";
import { readCodexTranscriptTurnSkills } from "./codex-transcript.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";
import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";
import { PendingRequestLifecycle } from "./pending-request-lifecycle.js";
import { TaskRuntimeState } from "./task-runtime-state.js";
import {
  RuntimeOwnerRegistry,
  isSameResolvedPath,
  normalizedPathIdentity,
} from "./runtime-owner-registry.js";
import {
  CodexProtocolMappingError,
  CODEX_NOTIFICATION_METHODS,
  type CodexSkill,
  type PendingCodexRequest,
  attachTranscriptSkills,
  expectBoolean,
  expectRecord,
  expectString,
  isRecord,
  mapAgentModel,
  mapAgentTurn,
  mapBackgroundTerminal,
  mapCodexNotification,
  mapCodexServerRequest,
  mapCodexSkill,
  mapSandboxMode,
  mapSandboxPolicy,
  mapThreadStatus,
  normalizedTitle,
  optionalString,
  requestIdKey,
  toDateTime,
} from "./codex-protocol-mapping.js";

export { CodexProtocolMappingError } from "./codex-protocol-mapping.js";

export interface CodexRpcClient {
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: { method: string; params: unknown }) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> | void;
}

export interface CreateCodexRuntimeProviderOptions {
  client: CodexRpcClient;
  logger?: CodexProviderLogger;
}

export interface CodexProviderLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

const DEFAULT_PROVIDER_LOGGER: CodexProviderLogger = pino({ level: "warn" }).child({
  component: "provider-codex",
});

async function canonicalPathIdentity(path: string): Promise<string> {
  try {
    // 历史 Thread 可能保留符号链接路径，归属校验需要与已注册 Project 的真实路径对齐。
    return normalizedPathIdentity(await realpath(path));
  } catch {
    return normalizedPathIdentity(path);
  }
}

async function isSameCanonicalPath(left: string, right: string): Promise<boolean> {
  const [leftIdentity, rightIdentity] = await Promise.all([
    canonicalPathIdentity(left),
    canonicalPathIdentity(right),
  ]);
  return leftIdentity === rightIdentity;
}

async function isProjectThread(
  thread: Record<string, unknown>,
  project: Project,
): Promise<boolean> {
  const cwd = expectString(thread["cwd"], "Codex thread cwd");
  return isSameCanonicalPath(cwd, project.rootPath);
}

async function assertProjectThread(
  thread: Record<string, unknown>,
  project: Project,
): Promise<void> {
  if (!(await isProjectThread(thread, project))) {
    throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
  }
}

function isThreadNotLoadedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not loaded:")
  );
}

function isBackgroundTerminalThreadMissingError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not found:")
  );
}

function isThreadNotMaterializedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.includes(
      "is not materialized yet; includeTurns is unavailable before first user message",
    )
  );
}

function createUnmaterializedTaskSnapshot(task: AgentTask): AgentProviderTaskSnapshot {
  return {
    ...task,
    contextUsage: null,
    pendingRequests: [],
    status: "idle",
    turns: [],
  };
}

async function mapAgentTask(thread: Record<string, unknown>, project: Project): Promise<AgentTask> {
  await assertProjectThread(thread, project);
  return {
    id: expectString(thread["id"], "Codex thread id"),
    pinned: false,
    projectId: project.id,
    title: normalizedTitle(thread),
    updatedAt: toDateTime(thread["updatedAt"], "Codex thread updatedAt"),
  };
}

export class CodexAgentProvider implements AgentProvider {
  readonly #client: CodexRpcClient;
  readonly #eventListeners = new Set<AgentProviderEventListener>();
  readonly #historicalAttachments = new CodexHistoricalAttachmentStore();
  readonly #logger: CodexProviderLogger;
  readonly #project: Project;
  readonly #pendingLifecycle: PendingRequestLifecycle;
  readonly #runtime = new TaskRuntimeState();
  readonly #skillsById = new Map<string, CodexSkill>();

  public constructor(
    client: CodexRpcClient,
    project: Project,
    options: { logger?: CodexProviderLogger; subscribeRpc?: boolean } = {},
  ) {
    this.#client = client;
    this.#logger = options.logger ?? DEFAULT_PROVIDER_LOGGER;
    this.#project = project;
    this.#pendingLifecycle = new PendingRequestLifecycle({
      publish: (event) => {
        this.#routeEvent(event);
      },
      respond: (id, result) => {
        return this.#client.respondToServerRequest(id, result);
      },
    });
    if (options.subscribeRpc ?? true) {
      this.#client.onNotification((notification) => {
        this.receiveNotification(notification.method, notification.params);
      });
      this.#client.onServerRequest((request) => {
        this.receiveServerRequest(request);
      });
    }
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        rollback: true,
        start: true,
        steer: true,
      },
    });
  }

  public releaseProject(): void {
    // Project 销毁后同步切断所有本地状态，避免定时器和监听器继续持有 Provider。
    this.#eventListeners.clear();
    this.#historicalAttachments.clear();
    this.#pendingLifecycle.clear();
    this.#runtime.clear();
    this.#skillsById.clear();
  }

  public async readSandboxMode(): Promise<AgentSandboxMode> {
    const response = expectRecord(
      await this.#client.request("config/read", { cwd: this.#project.rootPath }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    return mapSandboxMode(config["sandbox_mode"]);
  }

  public async archiveTask(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/archive", { threadId: taskId }),
      "thread/archive response",
    );
  }

  public async compactTask(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/compact/start", { threadId: taskId }),
      "thread/compact/start response",
    );
  }

  public async forkTask(taskId: string): Promise<AgentTask> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/fork", { threadId: taskId }),
      "thread/fork response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/fork thread"),
      this.#project,
    );
    // Fork 成功后立即接受新 Task 的实时通知与后续 Mutation。
    this.#runtime.projectTaskIds.add(task.id);
    this.#runtime.resumedTaskIds.add(task.id);
    return task;
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/name/set", { name: title, threadId: taskId }),
      "thread/name/set response",
    );
  }

  public async listMcpServers(): Promise<AgentMcpServerPage> {
    const response = expectRecord(
      await this.#client.request("config/read", { cwd: this.#project.rootPath }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    const rawMcpServers = config["mcp_servers"];
    if (rawMcpServers === undefined) {
      return { data: [] };
    }

    const mcpServers = expectRecord(rawMcpServers, "config/read mcp_servers");
    // 配置只在 Provider 边界判定启用状态，对外只保留名称以隔离命令、环境变量和 Secret。
    const data = Object.entries(mcpServers)
      .filter(([name, value]) => {
        if (name.length === 0) {
          throw new CodexProtocolMappingError("config/read MCP server name is invalid");
        }
        const server = expectRecord(value, `config/read MCP server ${name}`);
        const enabled = server["enabled"];
        if (enabled !== undefined && typeof enabled !== "boolean") {
          throw new CodexProtocolMappingError("config/read MCP server enabled is invalid");
        }
        return enabled !== false;
      })
      .map(([name]) => ({ name }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { data };
  }

  public async listModels(): Promise<AgentModelPage> {
    const data: AgentModelPage["data"][number][] = [];
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const response = expectRecord(
        await this.#client.request("model/list", {
          ...(cursor === undefined ? {} : { cursor }),
          includeHidden: false,
          limit: 100,
        }),
        "model/list response",
      );
      if (!Array.isArray(response["data"])) {
        throw new CodexProtocolMappingError("model/list data must be an array");
      }
      for (const value of response["data"]) {
        const model = mapAgentModel(value);
        if (model !== undefined) {
          data.push(model);
        }
      }
      const nextCursor = response["nextCursor"];
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new CodexProtocolMappingError("model/list nextCursor must be a string or null");
      }
      if (typeof nextCursor === "string") {
        if (visitedCursors.has(nextCursor)) {
          throw new CodexProtocolMappingError("model/list returned a repeated cursor");
        }
        visitedCursors.add(nextCursor);
        cursor = nextCursor;
      } else {
        cursor = undefined;
      }
    } while (cursor !== undefined);

    return { data, nextCursor: null };
  }

  public async listSkills(): Promise<AgentSkillPage> {
    const response = expectRecord(
      await this.#client.request("skills/list", {
        cwds: [this.#project.rootPath],
        forceReload: false,
      }),
      "skills/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("skills/list data must be an array");
    }
    let projectEntry: Record<string, unknown> | undefined;
    for (const value of response["data"]) {
      const entry = expectRecord(value, "skills/list entry");
      if (
        await isSameCanonicalPath(
          expectString(entry["cwd"], "skills/list cwd"),
          this.#project.rootPath,
        )
      ) {
        projectEntry = entry;
        break;
      }
    }
    if (projectEntry === undefined || !Array.isArray(projectEntry["skills"])) {
      throw new CodexProtocolMappingError("skills/list did not return the active project");
    }

    const skills = projectEntry["skills"].map(mapCodexSkill).filter((skill) => skill.enabled);
    this.#skillsById.clear();
    for (const skill of skills) {
      this.#skillsById.set(skill.id, skill);
    }
    return {
      data: skills.map(({ description, displayName, id, name, scope }) => ({
        description,
        displayName,
        id,
        name,
        scope,
      })),
      nextCursor: null,
    };
  }

  public async startTask(options: StartAgentTaskOptions = {}): Promise<AgentTask> {
    const response = expectRecord(
      await this.#client.request("thread/start", {
        cwd: this.#project.rootPath,
        ...(options.ephemeral === true ? { ephemeral: true } : {}),
      }),
      "thread/start response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/start thread"),
      this.#project,
    );
    // 新建 Task 必须立即接收后续 Turn 通知，不能等待下一次列表刷新。
    this.#runtime.projectTaskIds.add(task.id);
    this.#runtime.resumedTaskIds.add(task.id);
    // 临时 Task 只服务 Server 内部操作，不能进入用户可见的列表回退。
    if (options.ephemeral !== true) {
      this.#runtime.unmaterializedTasks.set(task.id, task);
    }
    return task;
  }

  public async startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#assertKnownProjectTask(taskId);
    const codexInput = await this.#mapTurnInput(input);
    await this.#resumeTask(taskId);
    const response = expectRecord(
      await this.#client.request("turn/start", {
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        effort: options.reasoningEffort,
        input: codexInput,
        model: options.model,
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        sandboxPolicy: mapSandboxPolicy(options.sandboxMode),
        threadId: taskId,
      }),
      "turn/start response",
    );
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.#mapMessageText(taskId, input, textIndex),
    );
    if (turn.status === "running") {
      this.#runtime.runningTaskIds.add(taskId);
    }
    return turn;
  }

  public async steerTurn(
    taskId: string,
    turnId: string,
    input: AgentProviderTurnInput,
  ): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const codexInput = await this.#mapTurnInput(input);
    const response = expectRecord(
      await this.#client.request("turn/steer", {
        expectedTurnId: turnId,
        input: codexInput,
        threadId: taskId,
      }),
      "turn/steer response",
    );
    if (response["turnId"] !== turnId) {
      throw new CodexProtocolMappingError("turn/steer returned an unexpected turn id");
    }
  }

  async #mapTurnInput(input: AgentProviderTurnInput) {
    if (input.skills.some((skill) => !this.#skillsById.has(skill.id))) {
      await this.listSkills();
    }
    // 每个引用独立解析为 Codex 原生 Skill part，并保持 Composer 中的选择顺序。
    const skills = input.skills.map((reference) => {
      const skill = this.#skillsById.get(reference.id);
      if (skill?.name !== reference.name) {
        throw new CodexProtocolMappingError("Provider turn skill is unavailable");
      }
      return { name: skill.name, path: skill.path, type: "skill" as const };
    });
    const images = input.images.map((image) => {
      if (!image.url.startsWith(`data:${image.mediaType};base64,`)) {
        throw new CodexProtocolMappingError("Provider image URL does not match its media type");
      }
      return { type: "image" as const, url: image.url };
    });
    const files = input.files.map((file) => ({
      name: file.name,
      path: file.path,
      type: "mention" as const,
    }));
    const textAttachments = input.textAttachments.map((attachment) => ({
      text: attachment.text,
      text_elements: [
        {
          byteRange: { end: Buffer.byteLength(attachment.text, "utf8"), start: 0 },
          placeholder: attachment.name,
        },
      ],
      type: "text" as const,
    }));
    const codexInput = [
      ...skills,
      ...(input.text.length === 0
        ? []
        : [{ text: input.text, text_elements: [], type: "text" as const }]),
      ...textAttachments,
      ...files,
      ...images,
    ];
    if (codexInput.length === 0) {
      throw new CodexProtocolMappingError("Provider turn input must not be empty");
    }
    return codexInput;
  }

  public async startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.#assertKnownProjectTask(taskId);
    const nativeTarget =
      target.type === "uncommitted_changes"
        ? { type: "uncommittedChanges" as const }
        : target.type === "base_branch"
          ? { branch: target.branch, type: "baseBranch" as const }
          : target.type === "commit"
            ? { sha: target.sha, title: target.title ?? null, type: "commit" as const }
            : { instructions: target.instructions, type: "custom" as const };
    // Notification 可能早于 RPC 响应到达，先记录目标以隐藏内部 Prompt 并生成稳定审查 Item。
    this.#runtime.activeReviewTargets.set(taskId, target);
    let response: Record<string, unknown>;
    try {
      response = expectRecord(
        await this.#client.request("review/start", {
          delivery: "inline",
          target: nativeTarget,
          threadId: taskId,
        }),
        "review/start response",
      );
    } catch (error) {
      this.#runtime.activeReviewTargets.delete(taskId);
      throw error;
    }
    if (expectString(response["reviewThreadId"], "review/start thread id") !== taskId) {
      throw new CodexProtocolMappingError("review/start returned a different thread");
    }
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.#mapMessageText(taskId, input, textIndex),
      target,
    );
    if (turn.status !== "running") {
      this.#runtime.activeReviewTargets.delete(taskId);
    }
    return turn;
  }

  public async interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("turn/interrupt", { threadId: taskId, turnId }),
      "turn/interrupt response",
    );
  }

  public async listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    this.#assertKnownProjectTask(taskId);
    const terminals: AgentBackgroundTerminal[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    try {
      do {
        const response = expectRecord(
          await this.#client.request("thread/backgroundTerminals/list", {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
            threadId: taskId,
          }),
          "thread/backgroundTerminals/list response",
        );
        if (!Array.isArray(response["data"])) {
          throw new CodexProtocolMappingError("background terminal list data must be an array");
        }
        terminals.push(...response["data"].map(mapBackgroundTerminal));
        const nextCursor = optionalString(response["nextCursor"]);
        if (nextCursor === undefined) {
          cursor = undefined;
        } else {
          if (seenCursors.has(nextCursor)) {
            throw new CodexProtocolMappingError("background terminal list cursor must advance");
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
      } while (cursor !== undefined);
    } catch (error) {
      if (isBackgroundTerminalThreadMissingError(error)) {
        // 历史 Task 可从持久化记录读取，但未加载到当前运行时，因此不可能存在后台终端。
        return { data: [] };
      }
      throw error;
    }

    return { data: terminals };
  }

  public async terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/backgroundTerminals/terminate", {
        processId: terminalId,
        threadId: taskId,
      }),
      "thread/backgroundTerminals/terminate response",
    );
    return expectBoolean(response["terminated"], "background terminal terminate result");
  }

  public async rollbackLatestTurn(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/rollback", { numTurns: 1, threadId: taskId }),
      "thread/rollback response",
    );
    const thread = expectRecord(response["thread"], "thread/rollback thread");
    if (expectString(thread["id"], "thread/rollback thread id") !== taskId) {
      throw new CodexProtocolMappingError("thread/rollback returned a different thread");
    }
    if (!Array.isArray(thread["turns"])) {
      throw new CodexProtocolMappingError("thread/rollback turns must be an array");
    }
  }

  public async uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("feedback/upload", { ...input, threadId: taskId }),
      "feedback/upload response",
    );
    if (expectString(response["threadId"], "feedback/upload thread id") !== taskId) {
      throw new CodexProtocolMappingError("feedback/upload returned a different thread");
    }
  }

  public async listTasks(input: ListAgentTasksInput = {}): Promise<AgentTaskPage> {
    const response = expectRecord(
      await this.#client.request("thread/list", {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        cwd: this.#project.rootPath,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        sortDirection: "desc",
        sortKey: "updated_at",
      }),
      "thread/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("thread/list data must be an array");
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
      throw new CodexProtocolMappingError("thread/list nextCursor must be a string or null");
    }
    const nativeTasks = await Promise.all(
      response["data"].map((thread) =>
        mapAgentTask(expectRecord(thread, "Codex thread"), this.#project),
      ),
    );
    for (const task of nativeTasks) {
      this.#runtime.projectTaskIds.add(task.id);
      this.#runtime.unmaterializedTasks.delete(task.id);
    }
    // thread/list 可能晚于 thread/start materialize；首屏先合并本地已确认的新 Task。
    const pendingTasks =
      input.cursor === undefined
        ? [...this.#runtime.unmaterializedTasks.values()].toSorted((leftTask, rightTask) =>
            rightTask.updatedAt.localeCompare(leftTask.updatedAt),
          )
        : [];
    const data = [...pendingTasks, ...nativeTasks];
    return { data, nextCursor: nextCursor ?? null };
  }

  public async readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined> {
    this.#runtime.pendingTaskReads.set(
      taskId,
      (this.#runtime.pendingTaskReads.get(taskId) ?? 0) + 1,
    );
    let projectOwnershipVerified = false;
    try {
      let nativeResponse: unknown;
      try {
        nativeResponse = await this.#client.request("thread/read", {
          includeTurns: true,
          threadId: taskId,
        });
      } catch (error) {
        const unmaterializedTask = this.#runtime.unmaterializedTasks.get(taskId);
        if (unmaterializedTask !== undefined && isThreadNotMaterializedError(error)) {
          // Codex 在首条用户消息前不允许 includeTurns，返回已知新 Task 的空快照供首轮校验。
          projectOwnershipVerified = true;
          this.#promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        // Codex 用明确的 RPC 错误表示 Task 不存在，其他连接与协议错误继续向上传播。
        if (isThreadNotLoadedError(error)) {
          return undefined;
        }
        throw error;
      }
      const response = expectRecord(nativeResponse, "thread/read response");
      const thread = expectRecord(response["thread"], "thread/read thread");
      if (!(await isProjectThread(thread, this.#project))) {
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.#promotePendingServerRequests(taskId);
      const task = await mapAgentTask(thread, this.#project);
      if (!Array.isArray(thread["turns"])) {
        throw new CodexProtocolMappingError("thread/read turns must be an array");
      }
      const transcriptSkillsByTurnId = await readCodexTranscriptTurnSkills(taskId);
      // Store 为未变化的来源复用随机授权 ID，重复读取不能使已交付的 Snapshot 图片失效。
      const turns = thread["turns"]
        .map((turn) =>
          mapAgentTurn(
            turn,
            (part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
            (input, textIndex) => this.#mapMessageText(taskId, input, textIndex),
          ),
        )
        .map((turn) => attachTranscriptSkills(turn, transcriptSkillsByTurnId.get(turn.id) ?? []));
      const status = mapThreadStatus(thread["status"]);
      if (status === "running") {
        this.#runtime.runningTaskIds.add(taskId);
      } else {
        this.#runtime.runningTaskIds.delete(taskId);
      }
      const snapshot: AgentProviderTaskSnapshot = {
        ...task,
        contextUsage: this.#runtime.contextUsage.get(taskId) ?? null,
        pendingRequests: this.#pendingLifecycle.pendingForTask(taskId),
        status,
        turns,
      };
      return snapshot;
    } finally {
      this.#finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  public readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.#runtime.projectTaskIds.has(taskId)) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.#historicalAttachments.read(taskId, attachmentId));
  }

  public async resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    return this.#pendingLifecycle.resolve(input);
  }

  public subscribeEvents(listener: AgentProviderEventListener): () => void {
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.#runtime.projectTaskIds.has(taskId)) {
      return "notLoaded";
    }
    if (this.#hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }
    const terminals = await this.listBackgroundTerminals(taskId);
    if (terminals.data.length > 0 || this.#hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }

    const response = expectRecord(
      await this.#client.request("thread/unsubscribe", { threadId: taskId }),
      "thread/unsubscribe response",
    );
    const status = expectString(response["status"], "thread/unsubscribe status");
    if (status !== "notLoaded" && status !== "notSubscribed" && status !== "unsubscribed") {
      throw new CodexProtocolMappingError("thread/unsubscribe returned an unknown status");
    }
    this.#clearTaskRuntimeState(taskId);
    return status;
  }

  public receiveNotification(method: string, params: unknown): void {
    this.#handleNotification(method, params);
  }

  public receiveServerRequest(request: RpcServerRequest): void {
    this.#handleServerRequest(request);
  }

  #handleNotification(method: string, params: unknown): void {
    if (method === "serverRequest/resolved") {
      this.#handleServerRequestResolved(params);
      return;
    }
    let event: AgentProviderEvent | undefined;
    try {
      event = mapCodexNotification(
        method,
        params,
        (taskId, part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
        (taskId, input, textIndex) => this.#mapMessageText(taskId, input, textIndex),
        this.#runtime.activeReviewTargets.get(readTaskId(params) ?? ""),
      );
    } catch {
      // 单个原生通知字段漂移不能中断 JSONL Client 或后续关键事件。
      this.#warnDroppedNotification("invalid_notification", method, params);
      return;
    }
    if (event === undefined) {
      if (!CODEX_NOTIFICATION_METHODS.has(method)) {
        this.#warnDroppedNotification("unknown_notification", method, params);
      }
      return;
    }
    if (
      event.type === "usage.updated" &&
      (this.#runtime.projectTaskIds.has(event.taskId) ||
        this.#runtime.pendingTaskReads.has(event.taskId))
    ) {
      // 快照和实时事件共享同一份最近一轮上下文用量。
      this.#runtime.contextUsage.set(event.taskId, event.payload.usage);
    }
    if (event.type === "turn.started") {
      this.#runtime.runningTaskIds.add(event.taskId);
    }
    if (event.type === "turn.completed") {
      this.#runtime.runningTaskIds.delete(event.taskId);
      this.#runtime.activeReviewTargets.delete(event.taskId);
      this.#removeQueuedRequestsForTurn(event.taskId, event.turnId);
      this.#pendingLifecycle.expireTurn(event.taskId, event.turnId);
    }
    this.#routeEvent(event);
  }

  #warnDroppedNotification(
    diagnosticCode: "invalid_notification" | "unknown_notification",
    method: string,
    params: unknown,
  ): void {
    // 原始通知可能包含 Prompt、命令或文件正文，诊断日志只保留关联身份。
    this.#logger.warn(
      {
        codexVersion: SUPPORTED_CODEX_VERSION,
        diagnosticCode,
        method,
        projectId: this.#project.id,
        taskId: readTaskId(params) ?? null,
      },
      "Codex notification dropped",
    );
  }

  #hasTaskLifecycleObligations(taskId: string): boolean {
    return this.#runtime.hasLifecycleObligations(taskId, this.#pendingLifecycle.hasForTask(taskId));
  }

  #clearTaskRuntimeState(taskId: string): void {
    this.#historicalAttachments.clearTask(taskId);
    this.#pendingLifecycle.clearTask(taskId);
    this.#runtime.clearTask(taskId);
  }

  #handleServerRequest(serverRequest: RpcServerRequest): void {
    let entry: PendingCodexRequest | undefined;
    try {
      entry = mapCodexServerRequest(serverRequest, this.#project);
    } catch {
      // 单个请求字段漂移不能破坏后续帧，也不能让 Codex 永久等待。
      this.#rejectServerRequest(serverRequest, {
        code: -32602,
        data: { method: serverRequest.method },
        message: "Invalid params",
      });
      return;
    }
    if (entry === undefined) {
      this.#rejectServerRequest(serverRequest, {
        code: -32601,
        data: { method: serverRequest.method },
        message: "Method not found",
      });
      return;
    }
    if (this.#hasPendingRequest(entry.request.requestId)) {
      return;
    }
    if (!this.#runtime.projectTaskIds.has(entry.request.taskId)) {
      if (this.#runtime.pendingTaskReads.has(entry.request.taskId)) {
        const queued = this.#runtime.pendingTaskServerRequests.get(entry.request.taskId) ?? [];
        queued.push(entry);
        this.#runtime.pendingTaskServerRequests.set(entry.request.taskId, queued);
      }
      return;
    }
    this.#activatePendingRequest(entry);
  }

  #rejectServerRequest(serverRequest: RpcServerRequest, error: RpcErrorPayload): void {
    // 写入失败会由 RPC Client 关闭连接；此处不制造未处理的异步拒绝。
    void this.#client.rejectServerRequest(serverRequest.id, error).catch(() => undefined);
  }

  #activatePendingRequest(entry: PendingCodexRequest): void {
    this.#pendingLifecycle.activate(entry);
  }

  #hasPendingRequest(requestId: string): boolean {
    if (this.#pendingLifecycle.has(requestId)) {
      return true;
    }
    return [...this.#runtime.pendingTaskServerRequests.values()].some((entries) =>
      entries.some((entry) => entry.request.requestId === requestId),
    );
  }

  #promotePendingServerRequests(taskId: string): void {
    const entries = this.#runtime.pendingTaskServerRequests.get(taskId) ?? [];
    this.#runtime.pendingTaskServerRequests.delete(taskId);
    for (const entry of entries) {
      this.#activatePendingRequest(entry);
    }
  }

  #removeQueuedRequestsForTurn(taskId: string, turnId: string): void {
    const queued = this.#runtime.pendingTaskServerRequests.get(taskId);
    if (queued === undefined) {
      return;
    }
    const remaining = queued.filter((entry) => entry.request.turnId !== turnId);
    if (remaining.length === 0) {
      this.#runtime.pendingTaskServerRequests.delete(taskId);
      return;
    }
    this.#runtime.pendingTaskServerRequests.set(taskId, remaining);
  }

  #handleServerRequestResolved(value: unknown): void {
    let params: Record<string, unknown>;
    try {
      params = expectRecord(value, "Codex serverRequest/resolved params");
    } catch {
      return;
    }
    const providerRequestId = params["requestId"];
    if (
      typeof providerRequestId !== "string" &&
      !(typeof providerRequestId === "number" && Number.isFinite(providerRequestId))
    ) {
      return;
    }
    const taskId = params["threadId"];
    if (typeof taskId !== "string") {
      return;
    }
    const requestId = requestIdKey(providerRequestId);
    if (this.#pendingLifecycle.handleResolved(requestId, taskId)) {
      return;
    }

    // 原生终态也要清理归属验证中的暂存项，但此时不能发布未验证事件。
    const queued = this.#runtime.pendingTaskServerRequests.get(taskId);
    const queuedIndex = queued?.findIndex((candidate) => candidate.request.requestId === requestId);
    if (queued === undefined || queuedIndex === undefined || queuedIndex < 0) {
      return;
    }
    queued.splice(queuedIndex, 1);
    if (queued.length === 0) {
      this.#runtime.pendingTaskServerRequests.delete(taskId);
    }
  }

  #routeEvent(event: AgentProviderEvent): void {
    if (this.#runtime.projectTaskIds.has(event.taskId)) {
      this.#publishEvent(event);
      return;
    }
    if (this.#runtime.pendingTaskReads.has(event.taskId)) {
      const pendingEvents = this.#runtime.pendingTaskEvents.get(event.taskId) ?? [];
      pendingEvents.push(event);
      this.#runtime.pendingTaskEvents.set(event.taskId, pendingEvents);
    }
  }

  #finishTaskRead(taskId: string, projectOwnershipVerified: boolean): void {
    const remainingReads = (this.#runtime.pendingTaskReads.get(taskId) ?? 1) - 1;
    if (projectOwnershipVerified) {
      // 归属确认后先同步交付读取期间的通知，再让 readTask Promise 完成。
      this.#runtime.projectTaskIds.add(taskId);
      const pendingEvents = this.#runtime.pendingTaskEvents.get(taskId) ?? [];
      this.#runtime.pendingTaskEvents.delete(taskId);
      for (const event of pendingEvents) {
        this.#publishEvent(event);
      }
    }
    if (remainingReads > 0) {
      this.#runtime.pendingTaskReads.set(taskId, remainingReads);
      return;
    }
    this.#runtime.pendingTaskReads.delete(taskId);
    if (!this.#runtime.projectTaskIds.has(taskId)) {
      this.#runtime.pendingTaskEvents.delete(taskId);
      this.#runtime.pendingTaskServerRequests.delete(taskId);
      this.#runtime.contextUsage.delete(taskId);
      this.#pendingLifecycle.clearTask(taskId);
    }
  }

  #publishEvent(event: AgentProviderEvent): void {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // 一个订阅者失败不能阻塞其他交付边界。
      }
    }
  }

  #mapMessageImage(
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    if (part["type"] === "image") {
      const url = optionalString(part["url"]);
      if (url === undefined) {
        return undefined;
      }
      const name = optionalString(part["name"]);
      return this.#historicalAttachments.addDataUrl(
        taskId,
        { ...(name === undefined ? {} : { name }), url },
        imageIndex,
      );
    }
    const path = optionalString(part["path"]);
    return path === undefined
      ? undefined
      : this.#historicalAttachments.addLocalImage(taskId, path, imageIndex);
  }

  #mapMessageText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined {
    return this.#historicalAttachments.addText(taskId, input, textIndex);
  }

  #assertKnownProjectTask(taskId: string): void {
    if (!this.#runtime.projectTaskIds.has(taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }

  async #resumeTask(taskId: string): Promise<void> {
    if (this.#runtime.resumedTaskIds.has(taskId)) {
      return;
    }
    const currentResume = this.#runtime.resumePromises.get(taskId);
    if (currentResume !== undefined) {
      return currentResume;
    }

    const resumePromise = (async () => {
      const response = expectRecord(
        await this.#client.request("thread/resume", { threadId: taskId }),
        "thread/resume response",
      );
      const thread = expectRecord(response["thread"], "thread/resume thread");
      if (expectString(thread["id"], "thread/resume thread id") !== taskId) {
        throw new CodexProtocolMappingError("thread/resume returned a different thread");
      }
      await assertProjectThread(thread, this.#project);
      // 恢复成功后，本次 App Server 生命周期内可直接继续后续 Turn。
      this.#runtime.resumedTaskIds.add(taskId);
    })();
    this.#runtime.resumePromises.set(taskId, resumePromise);
    try {
      await resumePromise;
    } finally {
      if (this.#runtime.resumePromises.get(taskId) === resumePromise) {
        this.#runtime.resumePromises.delete(taskId);
      }
    }
  }
}

function readTaskId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value["threadId"] === "string") {
    return value["threadId"];
  }
  const thread = value["thread"];
  return isRecord(thread) && typeof thread["id"] === "string" ? thread["id"] : undefined;
}

class CodexRuntimeProjectProvider implements AgentProvider {
  readonly #delegate: CodexAgentProvider;
  readonly #project: Project;
  readonly #runtime: CodexRuntimeProvider;

  public constructor(
    runtime: CodexRuntimeProvider,
    delegate: CodexAgentProvider,
    project: Project,
  ) {
    this.#delegate = delegate;
    this.#project = project;
    this.#runtime = runtime;
  }

  public async archiveTask(taskId: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.archiveTask(taskId);
  }

  public compactTask(taskId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.compactTask(taskId);
  }

  public async forkTask(taskId: string): Promise<AgentTask> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    const task = await this.#delegate.forkTask(taskId);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return this.#delegate.getCapabilities();
  }

  public interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.interruptTurn(taskId, turnId);
  }

  public listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.listBackgroundTerminals(taskId);
  }

  public terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.terminateBackgroundTerminal(taskId, terminalId);
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return "notLoaded";
    }
    const status = await this.#delegate.unsubscribeTask(taskId);
    if (status !== "busy") {
      this.#runtime.releaseTask(this.#project, taskId);
    }
    return status;
  }

  public listModels(): Promise<AgentModelPage> {
    return this.#delegate.listModels();
  }

  public listMcpServers(): Promise<AgentMcpServerPage> {
    return this.#delegate.listMcpServers();
  }

  public listSkills(): Promise<AgentSkillPage> {
    return this.#delegate.listSkills();
  }

  public readSandboxMode(): Promise<AgentSandboxMode> {
    return this.#delegate.readSandboxMode();
  }

  public async listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage> {
    const page = await this.#delegate.listTasks(input);
    for (const task of page.data) {
      this.#runtime.claimTask(this.#project, task.id);
    }
    return page;
  }

  public async readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined> {
    if (!this.#runtime.beginTaskRead(this.#project, taskId)) {
      return undefined;
    }
    try {
      const snapshot = await this.#delegate.readTask(taskId);
      if (snapshot === undefined) {
        this.#runtime.releaseProvisionalTask(this.#project, taskId);
      } else {
        this.#runtime.claimTask(this.#project, taskId);
      }
      return snapshot;
    } catch (error) {
      this.#runtime.releaseProvisionalTask(this.#project, taskId);
      throw error;
    }
  }

  public readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return Promise.resolve(undefined);
    }
    return this.#delegate.readTaskAttachment(taskId, attachmentId);
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.renameTask(taskId, title);
  }

  public resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    this.#runtime.assertTaskOwner(this.#project, input.taskId);
    return this.#delegate.resolvePendingRequest(input);
  }

  public rollbackLatestTurn(taskId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.rollbackLatestTurn(taskId);
  }

  public startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.startReview(taskId, target);
  }

  public async startTask(options: StartAgentTaskOptions = {}): Promise<AgentTask> {
    const task = await this.#delegate.startTask(options);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.startTurn(taskId, input, options);
  }

  public steerTurn(taskId: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.steerTurn(taskId, turnId, input);
  }

  public subscribeEvents(listener: AgentProviderEventListener): () => void {
    return this.#delegate.subscribeEvents(listener);
  }

  public uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.uploadFeedback(taskId, input);
  }

  async #ensureTaskOwner(taskId: string): Promise<void> {
    if (this.#runtime.isTaskOwner(this.#project, taskId)) {
      return;
    }
    // Sidebar 可直接操作已释放的历史 Task，先重新读取并恢复 Project 归属。
    if ((await this.readTask(taskId)) === undefined) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }
}

export class CodexRuntimeProvider implements AgentRuntimeProvider {
  readonly #client: CodexRpcClient;
  readonly #logger: CodexProviderLogger;
  readonly #owners = new RuntimeOwnerRegistry();
  readonly #projects = new Map<string, Project>();
  readonly #projectProviders = new Map<string, CodexRuntimeProjectProvider>();
  readonly #rawProviders = new Map<string, CodexAgentProvider>();

  public constructor(
    client: CodexRpcClient,
    logger: CodexProviderLogger = DEFAULT_PROVIDER_LOGGER,
  ) {
    this.#client = client;
    this.#logger = logger;
    client.onNotification((notification) => {
      const taskId = readTaskId(notification.params);
      if (taskId !== undefined) {
        this.#rawProviders
          .get(this.#owners.projectIdForTask(taskId) ?? "")
          ?.receiveNotification(notification.method, notification.params);
      }
    });
    client.onServerRequest((request) => {
      const taskId = readTaskId(request.params);
      const provider =
        taskId === undefined
          ? undefined
          : this.#rawProviders.get(this.#owners.projectIdForTask(taskId) ?? "");
      if (provider !== undefined) {
        provider.receiveServerRequest(request);
        return;
      }
      void client
        .rejectServerRequest(request.id, {
          code: -32602,
          data: { method: request.method },
          message: "Task project is unknown",
        })
        .catch(() => undefined);
    });
  }

  public forProject(project: Project): AgentProvider {
    const current = this.#projectProviders.get(project.id);
    if (current !== undefined) {
      const registeredProject = this.#projects.get(project.id);
      if (
        registeredProject === undefined ||
        !isSameResolvedPath(registeredProject.rootPath, project.rootPath)
      ) {
        throw new CodexProtocolMappingError("Codex project identity belongs to another cwd");
      }
      return current;
    }
    const rawProvider = new CodexAgentProvider(this.#client, project, {
      logger: this.#logger,
      subscribeRpc: false,
    });
    const provider = new CodexRuntimeProjectProvider(this, rawProvider, project);
    this.#rawProviders.set(project.id, rawProvider);
    this.#projectProviders.set(project.id, provider);
    this.#projects.set(project.id, project);
    return provider;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        rollback: true,
        start: true,
        steer: true,
      },
    });
  }

  public listModels(): Promise<AgentModelPage> {
    const firstProvider = this.#projectProviders.values().next().value;
    if (firstProvider !== undefined) {
      return firstProvider.listModels();
    }
    const runtimeProject: Project = {
      createdAt: new Date(0).toISOString(),
      id: "runtime",
      name: "Runtime",
      rootPath: resolve("/"),
    };
    return new CodexAgentProvider(this.#client, runtimeProject, {
      logger: this.#logger,
      subscribeRpc: false,
    }).listModels();
  }

  public releaseProject(projectId: string): Promise<void> {
    const provider = this.#rawProviders.get(projectId);
    // 先移除路由和 Owner，再清空 Provider 内部状态，后续 RPC 无法回流到已删除 Project。
    this.#projects.delete(projectId);
    this.#projectProviders.delete(projectId);
    this.#rawProviders.delete(projectId);
    this.#owners.releaseProject(projectId);
    provider?.releaseProject();
    return Promise.resolve();
  }

  public beginTaskRead(project: Project, taskId: string): boolean {
    return this.#owners.beginTaskRead(project, taskId);
  }

  public claimTask(project: Project, taskId: string): void {
    this.#owners.claimTask(project, taskId);
  }

  public assertTaskOwner(project: Project, taskId: string): void {
    this.#owners.assertTaskOwner(project, taskId);
  }

  public isTaskOwner(project: Project, taskId: string): boolean {
    return this.#owners.isTaskOwner(project, taskId);
  }

  public releaseTask(project: Project, taskId: string): void {
    this.#owners.releaseTask(project, taskId);
  }

  public releaseProvisionalTask(project: Project, taskId: string): void {
    this.#owners.releaseProvisionalTask(project, taskId);
  }
}

export function createCodexRuntimeProvider(
  options: CreateCodexRuntimeProviderOptions,
): CodexRuntimeProvider {
  return new CodexRuntimeProvider(options.client, options.logger);
}
