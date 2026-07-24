import type {
  AgentCapabilities,
  AgentEvent,
  AgentAttachmentMediaType,
  AgentModelPage,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
  PendingRequest,
  ResolvePendingRequestRequest,
} from "@code-agent/protocol";

export type ListAgentTasksInput = Readonly<{
  cursor?: string;
  limit?: number;
}>;

export type AgentProviderTurnInput = Readonly<{
  images: readonly Readonly<{
    mediaType: AgentAttachmentMediaType;
    url: string;
  }>[];
  text: string;
}>;

type AgentEventTransportField = "provider" | "sequence" | "sessionId" | "timestamp" | "version";

export type AgentProviderEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, AgentEventTransportField>
    : never
  : never;

export type AgentProviderEventListener = (event: AgentProviderEvent) => void;

export type ResolvePendingRequestInput = Readonly<
  ResolvePendingRequestRequest & { requestId: string }
>;

export type PendingRequestResolutionErrorCode = "expired" | "mismatch" | "not_found" | "resolved";

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
  getCapabilities(): Promise<AgentCapabilities>;
  listModels(): Promise<AgentModelPage>;
  listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage>;
  // Promise 完成前须让 Snapshot 包含此前状态并同步交付对应通知，使 checkpoint 保持一致。
  readTask(taskId: string): Promise<AgentTaskSnapshot | undefined>;
  resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest>;
  rollbackLatestTurn(taskId: string): Promise<void>;
  startTask(): Promise<AgentTask>;
  startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn>;
  interruptTurn(taskId: string, turnId: string): Promise<void>;
  subscribeEvents(listener: AgentProviderEventListener): () => void;
}
