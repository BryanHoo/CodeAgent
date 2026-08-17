import type {
  AgentApprovalPolicy,
  AgentApprovalsReviewer,
  AgentCapabilities,
  AgentAttachmentMediaType,
  AgentBackgroundTerminalPage,
  AgentEvent,
  AgentImageMediaType,
  AgentMcpServerPage,
  AgentModelPage,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentSkillPage,
  AgentSkillReference,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
  AgentReviewTarget,
  AgentSandboxMode,
  PendingRequest,
  ResolvePendingRequestRequest,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  StartOfficialProviderLoginResponse,
  UploadAgentFeedbackRequest,
  Project,
} from "@code-agent/protocol";

export type AgentRuntimeDefaultSettings = Readonly<{
  approvalPolicy?: AgentApprovalPolicy;
  approvalsReviewer?: AgentApprovalsReviewer;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: AgentSandboxMode;
}>;

export type ListAgentTasksInput = Readonly<{
  cursor?: string;
  limit?: number;
  pinnedOnly?: true;
}>;

export type StartAgentTaskOptions = Readonly<{
  ephemeral?: boolean;
}>;

export type AgentProviderTurnInput = Readonly<{
  files: readonly Readonly<{
    mediaType: string;
    name: string;
    path: string;
  }>[];
  images: readonly Readonly<{
    mediaType: AgentImageMediaType;
    url: string;
  }>[];
  // 仅供 Server 内部的结构化任务使用，浏览器协议不接受任意 Schema。
  outputSchema?: Readonly<Record<string, unknown>>;
  skills: readonly AgentSkillReference[];
  text: string;
  textAttachments: readonly Readonly<{
    name: string;
    text: string;
  }>[];
}>;

export type AgentProviderAttachment = Readonly<{
  content: Uint8Array;
  mediaType: AgentAttachmentMediaType;
  name: string;
  size: number;
}>;

type AgentEventTransportField = "provider" | "sequence" | "sessionId" | "timestamp" | "version";

export type AgentProviderEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, AgentEventTransportField>
    : never
  : never;

export type AgentProviderEventListener = (event: AgentProviderEvent) => void;

export type AgentProviderEventSubscriptionOptions = Readonly<{
  // 临时 Task 仅供 Server 内部流程消费，默认不能进入浏览器事件流。
  includeEphemeral?: boolean;
}>;

// Provider Snapshot 不包含本地设置，Server 在交付 HTTP Snapshot 时统一合并持久化结果。
export type AgentProviderTaskSnapshot = Omit<AgentTaskSnapshot, "settings">;

export type ResolvePendingRequestInput = Readonly<
  ResolvePendingRequestRequest & { requestId: string }
>;

export type PendingRequestResolutionErrorCode = "expired" | "mismatch" | "not_found" | "resolved";
export type AgentTaskUnsubscribeStatus = "busy" | "notLoaded" | "notSubscribed" | "unsubscribed";

export class PendingRequestResolutionError extends Error {
  public constructor(
    public readonly code: PendingRequestResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PendingRequestResolutionError";
  }
}

// Core 只声明 Provider 无关能力，具体 RPC、传输顺序与进程生命周期留在外层。
export interface AgentProvider {
  archiveTask(taskId: string): Promise<void>;
  compactTask(taskId: string): Promise<void>;
  forkTask(taskId: string, lastTurnId?: string): Promise<AgentTask>;
  getCapabilities(): Promise<AgentCapabilities>;
  listModels(): Promise<AgentModelPage>;
  listMcpServers(taskId: string): Promise<AgentMcpServerPage>;
  listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage>;
  listSkills(): Promise<AgentSkillPage>;
  listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage>;
  pinTask(taskId: string, pinned: boolean): Promise<AgentTask>;
  readSandboxMode(): Promise<AgentSandboxMode>;
  // Promise 完成前须让 Snapshot 包含此前状态并同步交付对应通知，使 checkpoint 保持一致。
  readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined>;
  // 附件二进制只通过已验证的 Task 作用域读取，不进入统一 Snapshot。
  readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined>;
  reloadMcpServers(taskId: string): Promise<AgentMcpServerPage>;
  renameTask(taskId: string, title: string): Promise<void>;
  resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest>;
  startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn>;
  startTask(options?: StartAgentTaskOptions): Promise<AgentTask>;
  startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn>;
  steerTurn(taskId: string, turnId: string, input: AgentProviderTurnInput): Promise<void>;
  interruptTurn(taskId: string, turnId: string): Promise<void>;
  subscribeEvents(
    listener: AgentProviderEventListener,
    options?: AgentProviderEventSubscriptionOptions,
  ): () => void;
  terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean>;
  unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus>;
  uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void>;
}

// Runtime 负责全局资源和订阅，Project Adapter 只暴露已校验的项目作用域能力。
export interface AgentRuntimeProvider {
  cancelProviderLogin(loginId: string): Promise<AgentProviderConnectionMutationResponse>;
  configureCustomProvider(
    input: ConfigureCustomProviderRequest,
  ): Promise<ConfigureCustomProviderResponse>;
  forProject(project: Project): AgentProvider;
  getCapabilities(): Promise<AgentCapabilities>;
  listModels(): Promise<AgentModelPage>;
  logoutProvider(): Promise<AgentProviderConnectionMutationResponse>;
  readDefaultSettings(): Promise<AgentRuntimeDefaultSettings>;
  readProviderConnection(): Promise<AgentProviderConnectionStatus>;
  releaseProject(projectId: string): Promise<void>;
  startOfficialProviderLogin(): Promise<StartOfficialProviderLoginResponse>;
}
