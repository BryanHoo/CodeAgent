import { resolve } from "node:path";
import type {
  AgentProvider,
  AgentRuntimeDefaultSettings,
  AgentRuntimeProvider,
  AgentTaskScope,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentModelPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  Project,
  StartOfficialProviderLoginResponse,
} from "@code-agent/protocol";
import { TEMPORARY_TASK_SCOPE_ID } from "@code-agent/protocol";
import { RuntimeOwnerRegistry, isSameResolvedPath } from "./runtime-owner-registry.js";
import { CodexProtocolMappingError, expectRecord } from "./codex-protocol-mapping.js";

import { CodexAgentProvider } from "./agent-provider-runtime.js";
import type { CodexRpcClient, CreateCodexRuntimeProviderOptions } from "./agent-provider-base.js";
import { DEFAULT_PROVIDER_LOGGER, type CodexProviderLogger } from "./agent-provider-logger.js";
import { readReviewWorkerThread, readTaskId } from "./agent-provider-notifications.js";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { CodexRuntimeProjectProvider } from "./runtime-project-provider.js";

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

export class CodexRuntimeProvider implements AgentRuntimeProvider {
  readonly #client: CodexRpcClient;
  readonly #logger: CodexProviderLogger;
  readonly #providerConnection: CodexProviderConnectionService;
  readonly #owners = new RuntimeOwnerRegistry();
  readonly #projects = new Map<string, AgentTaskScope>();
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
      if (notification.method === "skills/changed") {
        for (const provider of this.#rawProviders.values()) {
          provider.receiveNotification(notification.method, notification.params);
        }
        return;
      }
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
      if (
        projectId !== undefined &&
        (notification.method === "thread/archived" || notification.method === "thread/deleted")
      ) {
        const project = this.#projects.get(projectId);
        if (project !== undefined) this.#owners.releaseTask(project, taskId);
      }
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
    const primaryRoot = project.roots[0];
    if (primaryRoot === undefined) {
      throw new CodexProtocolMappingError("Codex project roots must contain a primary root");
    }
    return this.#forScope({ id: project.id, kind: "project", rootPath: primaryRoot.path });
  }

  public forTemporary(rootPath: string): AgentProvider {
    return this.#forScope({ id: TEMPORARY_TASK_SCOPE_ID, kind: "temporary", rootPath });
  }

  #forScope(project: AgentTaskScope): AgentProvider {
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
    const runtimeProject: AgentTaskScope = {
      id: "runtime",
      kind: "project",
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

  public beginTaskRead(project: AgentTaskScope, taskId: string): boolean {
    return this.#owners.beginTaskRead(project, taskId);
  }

  public claimTask(project: AgentTaskScope, taskId: string): void {
    this.#owners.claimTask(project, taskId);
  }

  public assertTaskOwner(project: AgentTaskScope, taskId: string): void {
    this.#owners.assertTaskOwner(project, taskId);
  }

  public isTaskOwner(project: AgentTaskScope, taskId: string): boolean {
    return this.#owners.isTaskOwner(project, taskId);
  }

  public releaseTask(project: AgentTaskScope, taskId: string): void {
    this.#owners.releaseTask(project, taskId);
    for (const [workerTaskId, owner] of this.#reviewWorkerOwners) {
      if (owner.parentTaskId === taskId) {
        this.#reviewWorkerOwners.delete(workerTaskId);
      }
    }
  }

  public releaseProvisionalTask(project: AgentTaskScope, taskId: string): void {
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
