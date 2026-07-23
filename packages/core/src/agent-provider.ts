import type {
  AgentCapabilities,
  AgentEvent,
  AgentTaskPage,
  AgentTaskSnapshot,
} from "@code-agent/protocol";

export type ListAgentTasksInput = Readonly<{
  cursor?: string;
  limit?: number;
}>;

type AgentEventTransportField = "provider" | "sequence" | "sessionId" | "timestamp" | "version";

export type AgentProviderEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, AgentEventTransportField>
    : never
  : never;

export type AgentProviderEventListener = (event: AgentProviderEvent) => void;

// Core 只声明 Provider 无关能力，具体 RPC、传输顺序与进程生命周期留在外层。
export interface AgentProvider {
  getCapabilities(): Promise<AgentCapabilities>;
  listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage>;
  // Promise 完成前须让 Snapshot 包含此前状态并同步交付对应通知，使 checkpoint 保持一致。
  readTask(taskId: string): Promise<AgentTaskSnapshot | undefined>;
  subscribeEvents(listener: AgentProviderEventListener): () => void;
}
