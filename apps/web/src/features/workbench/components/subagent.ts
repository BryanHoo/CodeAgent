import type { AgentItem, AgentItemStatus } from "@code-agent/protocol";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { TaskStatus } from "../../../shared/ai-elements/task.js";

export type SubagentOperationName =
  "agent/close" | "agent/resume" | "agent/send_input" | "agent/spawn" | "agent/wait";

export type SubagentOperation = Readonly<{
  agents: readonly SubagentOperationAgent[];
  model?: string;
  name: SubagentOperationName;
  prompt?: string;
  reasoningEffort?: string;
}>;

export type SubagentOperationAgent = Readonly<{
  message?: string;
  nickname?: string;
  status: AgentItemStatus;
  taskId: string;
}>;

export type SubagentContextEntry = Readonly<{
  model?: string;
  nickname: string;
  reasoningEffort?: string;
  status: AgentItemStatus;
  taskId: string;
}>;

export type SubagentSelection = Readonly<{
  status: AgentItemStatus;
  taskId: string;
}>;

export const subagentOperationTitles: Readonly<Record<SubagentOperationName, string>> = {
  "agent/close": "关闭子代理",
  "agent/resume": "恢复子代理",
  "agent/send_input": "向子代理发送消息",
  "agent/spawn": "启动子代理",
  "agent/wait": "等待子代理",
};

function isStructuredRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentItemStatus(value: unknown): value is AgentItemStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "declined" ||
    value === "interrupted"
  );
}

export function parseSubagentOperation(
  item: Extract<AgentItem, { type: "tool" }>,
): SubagentOperation | null {
  if (!(item.name in subagentOperationTitles)) {
    return null;
  }
  const input = isStructuredRecord(item.input) ? item.input : {};
  const output = isStructuredRecord(item.output) ? item.output : {};
  const nativeAgents = Array.isArray(output["agents"]) ? output["agents"] : [];
  const agents = nativeAgents.flatMap((value) => {
    if (!isStructuredRecord(value)) {
      return [];
    }
    const taskId = value["taskId"];
    const status = value["status"];
    if (typeof taskId !== "string" || !isAgentItemStatus(status)) {
      return [];
    }
    const message = value["message"];
    const nickname = value["nickname"];
    return [
      {
        ...(typeof message === "string" ? { message } : {}),
        ...(typeof nickname === "string" ? { nickname } : {}),
        status,
        taskId,
      },
    ];
  });
  return {
    agents,
    ...(typeof input["model"] === "string" ? { model: input["model"] } : {}),
    name: item.name as SubagentOperationName,
    ...(typeof input["prompt"] === "string" ? { prompt: input["prompt"] } : {}),
    ...(typeof input["reasoningEffort"] === "string"
      ? { reasoningEffort: input["reasoningEffort"] }
      : {}),
  };
}

export function collectSubagents(
  snapshot: RuntimeTaskSnapshot | undefined,
): readonly SubagentContextEntry[] {
  if (snapshot === undefined) {
    return [];
  }

  const entriesByTaskId = new Map<string, SubagentContextEntry>();
  for (const turn of snapshot.turns) {
    for (const item of turn.items) {
      if (item.type !== "tool") {
        continue;
      }
      const operation = parseSubagentOperation(item);
      if (operation === null) {
        continue;
      }
      if (operation.name === "agent/close") {
        for (const agent of operation.agents) {
          entriesByTaskId.delete(agent.taskId);
        }
        continue;
      }
      for (const agent of operation.agents) {
        const existingEntry = entriesByTaskId.get(agent.taskId);
        // 后续 wait/resume 只刷新状态，不丢失 spawn 阶段提供的任务元数据。
        entriesByTaskId.set(agent.taskId, {
          ...(existingEntry?.model === undefined ? {} : { model: existingEntry.model }),
          ...(existingEntry?.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: existingEntry.reasoningEffort }),
          ...(operation.model === undefined ? {} : { model: operation.model }),
          ...(operation.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: operation.reasoningEffort }),
          nickname:
            agent.nickname ??
            existingEntry?.nickname ??
            `子代理 ${String(entriesByTaskId.size + 1)}`,
          status: agent.status,
          taskId: agent.taskId,
        });
      }
    }
  }
  return [...entriesByTaskId.values()];
}

export function formatSubagentModel(model: string): string {
  return model
    .split("-")
    .map((segment) =>
      segment === "gpt" ? "GPT" : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
    )
    .join("-");
}

export function toSubagentTaskStatus(status: AgentItemStatus): TaskStatus {
  if (status === "pending") {
    return "pending";
  }
  if (status === "running") {
    return "in_progress";
  }
  if (status === "failed" || status === "declined" || status === "interrupted") {
    return "error";
  }
  return "completed";
}

export function resolveSubagentOperationStatus(
  operationStatus: AgentItemStatus,
  agents: SubagentOperation["agents"],
): TaskStatus {
  if (agents.some((agent) => agent.status === "running" || agent.status === "pending")) {
    return "in_progress";
  }
  if (
    agents.some(
      (agent) =>
        agent.status === "failed" || agent.status === "declined" || agent.status === "interrupted",
    )
  ) {
    return "error";
  }
  return toSubagentTaskStatus(operationStatus);
}

export function formatSubagentOperationSummary(
  operationStatus: AgentItemStatus,
  agents: SubagentOperation["agents"],
): string {
  if (agents.length === 0) {
    return operationStatus === "pending" || operationStatus === "running"
      ? "正在协调子代理"
      : "子代理操作已完成";
  }
  const countLabel = `${String(agents.length)} 个子代理`;
  const taskStatus = resolveSubagentOperationStatus(operationStatus, agents);
  if (taskStatus === "in_progress" || taskStatus === "pending") {
    return `${countLabel}正在执行`;
  }
  if (taskStatus === "error") {
    return `${countLabel}执行失败`;
  }
  return `${countLabel}已完成`;
}
