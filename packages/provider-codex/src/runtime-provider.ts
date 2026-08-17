import { resolve } from "node:path";
import type {
  AgentProvider,
  AgentProviderAttachment,
  AgentProviderEventListener,
  AgentProviderEventSubscriptionOptions,
  AgentProviderTaskSnapshot,
  AgentProviderTurnInput,
  AgentRuntimeDefaultSettings,
  AgentRuntimeProvider,
  AgentTaskUnsubscribeStatus,
  ListAgentTasksInput,
  ResolvePendingRequestInput,
  StartAgentTaskOptions,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentBackgroundTerminalPage,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentMcpServerPage,
  AgentTask,
  AgentTaskPage,
  AgentTurn,
  AgentModelPage,
  AgentTurnOptions,
  AgentReviewTarget,
  AgentSandboxMode,
  AgentSkillPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  PendingRequest,
  Project,
  StartOfficialProviderLoginResponse,
  UploadAgentFeedbackRequest,
} from "@code-agent/protocol";
import { RuntimeOwnerRegistry, isSameResolvedPath } from "./runtime-owner-registry.js";
import { CodexProtocolMappingError, expectRecord } from "./codex-protocol-mapping.js";

import { CodexAgentProvider } from "./agent-provider-runtime.js";
import {
  DEFAULT_PROVIDER_LOGGER,
  type CodexProviderLogger,
  type CodexRpcClient,
  type CreateCodexRuntimeProviderOptions,
} from "./agent-provider-base.js";
import { readReviewWorkerThread, readTaskId } from "./agent-provider-notifications.js";
import { CodexProviderConnectionService } from "./provider-connection.js";

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalApprovalPolicy(value: unknown): AgentRuntimeDefaultSettings["approvalPolicy"] {
  return value === "untrusted" || value === "on-request" || value === "never" ? value : undefined;
}

function optionalSandboxMode(value: unknown): AgentRuntimeDefaultSettings["sandboxMode"] {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : undefined;
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

  public async forkTask(taskId: string, lastTurnId?: string): Promise<AgentTask> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    const task = await this.#delegate.forkTask(taskId, lastTurnId);
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

  public async listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    await this.#ensureTaskOwner(taskId);
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

  public async listMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.listMcpServers(taskId);
  }

  public async reloadMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.reloadMcpServers(taskId);
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

  public async pinTask(taskId: string, pinned: boolean): Promise<AgentTask> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.pinTask(taskId, pinned);
  }

  public resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    this.#runtime.assertTaskOwner(this.#project, input.taskId);
    return this.#delegate.resolvePendingRequest(input);
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

  public subscribeEvents(
    listener: AgentProviderEventListener,
    options?: AgentProviderEventSubscriptionOptions,
  ): () => void {
    return this.#delegate.subscribeEvents(listener, options);
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
  readonly #providerConnection: CodexProviderConnectionService;
  readonly #owners = new RuntimeOwnerRegistry();
  readonly #projects = new Map<string, Project>();
  readonly #projectProviders = new Map<string, CodexRuntimeProjectProvider>();
  readonly #rawProviders = new Map<string, CodexAgentProvider>();
  readonly #reviewWorkerOwners = new Map<
    string,
    Readonly<{ parentTaskId: string; projectId: string }>
  >();

  public constructor(
    client: CodexRpcClient,
    logger: CodexProviderLogger = DEFAULT_PROVIDER_LOGGER,
    options: Readonly<{ fetch?: typeof globalThis.fetch }> = {},
  ) {
    this.#client = client;
    this.#logger = logger;
    this.#providerConnection = new CodexProviderConnectionService(client, options);
    client.onNotification((notification) => {
      this.#providerConnection.receiveNotification(notification.method, notification.params);
      const taskId = readTaskId(notification.params);
      if (taskId === undefined) {
        return;
      }
      const reviewWorker =
        notification.method === "thread/started"
          ? readReviewWorkerThread(notification.params)
          : undefined;
      if (reviewWorker !== undefined) {
        const projectId = this.#owners.projectIdForTask(reviewWorker.parentTaskId);
        if (projectId !== undefined) {
          // 子 Thread 不进入 Task 列表，只继承父 Task 的事件路由归属。
          this.#reviewWorkerOwners.set(reviewWorker.workerTaskId, {
            parentTaskId: reviewWorker.parentTaskId,
            projectId,
          });
          this.#rawProviders
            .get(projectId)
            ?.receiveNotification(notification.method, notification.params);
        }
        return;
      }
      const workerOwner = this.#reviewWorkerOwners.get(taskId);
      const projectId = this.#owners.projectIdForTask(taskId) ?? workerOwner?.projectId;
      this.#rawProviders
        .get(projectId ?? "")
        ?.receiveNotification(notification.method, notification.params);
      if (workerOwner !== undefined && notification.method === "turn/completed") {
        this.#reviewWorkerOwners.delete(taskId);
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

  public cancelProviderLogin(loginId: string): Promise<AgentProviderConnectionMutationResponse> {
    return this.#providerConnection.cancelLogin(loginId);
  }

  public configureCustomProvider(
    input: ConfigureCustomProviderRequest,
  ): Promise<ConfigureCustomProviderResponse> {
    return this.#providerConnection.configureCustom(input);
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

  public logoutProvider(): Promise<AgentProviderConnectionMutationResponse> {
    return this.#providerConnection.logout();
  }

  public async readDefaultSettings(): Promise<AgentRuntimeDefaultSettings> {
    const response = expectRecord(
      await this.#client.request("config/read", { includeLayers: false }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    const approvalsReviewer = config["approvals_reviewer"];
    const approvalPolicy = optionalApprovalPolicy(config["approval_policy"]);

    // 自动审核在统一协议中固定搭配 on-request，其他新枚举留给项目默认值处理。
    const approvalDefaults =
      approvalsReviewer === "auto_review"
        ? { approvalPolicy: "on-request" as const, approvalsReviewer: "auto_review" as const }
        : {
            ...(approvalPolicy === undefined ? {} : { approvalPolicy }),
            ...(approvalsReviewer === "user" ? { approvalsReviewer: "user" as const } : {}),
          };
    const model = optionalNonEmptyString(config["model"]);
    const reasoningEffort = optionalNonEmptyString(config["model_reasoning_effort"]);
    const sandboxMode = optionalSandboxMode(config["sandbox_mode"]);

    return {
      ...approvalDefaults,
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(sandboxMode === undefined ? {} : { sandboxMode }),
    };
  }

  public readProviderConnection(): Promise<AgentProviderConnectionStatus> {
    return this.#providerConnection.readStatus();
  }

  public releaseProject(projectId: string): Promise<void> {
    const provider = this.#rawProviders.get(projectId);
    // 先移除路由和 Owner，再清空 Provider 内部状态，后续 RPC 无法回流到已删除 Project。
    this.#projects.delete(projectId);
    this.#projectProviders.delete(projectId);
    this.#rawProviders.delete(projectId);
    this.#owners.releaseProject(projectId);
    for (const [workerTaskId, owner] of this.#reviewWorkerOwners) {
      if (owner.projectId === projectId) {
        this.#reviewWorkerOwners.delete(workerTaskId);
      }
    }
    provider?.releaseProject();
    return Promise.resolve();
  }

  public startOfficialProviderLogin(): Promise<StartOfficialProviderLoginResponse> {
    return this.#providerConnection.startOfficialLogin();
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
    for (const [workerTaskId, owner] of this.#reviewWorkerOwners) {
      if (owner.parentTaskId === taskId) {
        this.#reviewWorkerOwners.delete(workerTaskId);
      }
    }
  }

  public releaseProvisionalTask(project: Project, taskId: string): void {
    this.#owners.releaseProvisionalTask(project, taskId);
  }
}

export function createCodexRuntimeProvider(
  options: CreateCodexRuntimeProviderOptions,
): CodexRuntimeProvider {
  return new CodexRuntimeProvider(options.client, options.logger, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
