import type { AgentCapabilities, AgentTaskPage, AgentTaskSnapshot } from "@code-agent/protocol";

export type ListAgentTasksInput = Readonly<{
  cursor?: string;
  limit?: number;
}>;

// Core 只声明 Provider 无关的只读能力，具体 RPC 与进程生命周期留在 Adapter。
export interface AgentProvider {
  getCapabilities(): Promise<AgentCapabilities>;
  listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage>;
  readTask(taskId: string): Promise<AgentTaskSnapshot | undefined>;
}
