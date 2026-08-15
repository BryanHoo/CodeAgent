import type { AgentItem, AgentTurn } from "@code-agent/protocol";

import { shouldRenderTimelineItem } from "./task-timeline-running.js";

export const COMPLETED_TURN_RECENT_OPERATION_LIMIT = 20;

export type CompletedTurnProcess = Readonly<{
  completedOperationCount: number;
  failedOperationCount: number;
  fileCount: number;
  hiddenItemIds: readonly string[];
  recentOperationItemIds: readonly string[];
}>;

const EMPTY_COMPLETED_TURN_PROCESS: CompletedTurnProcess = {
  completedOperationCount: 0,
  failedOperationCount: 0,
  fileCount: 0,
  hiddenItemIds: [],
  recentOperationItemIds: [],
};

type OperationOutcome = "completed" | "failed" | undefined;

function resolveOperationOutcome(item: AgentItem): OperationOutcome {
  if (item.type === "approval_review") {
    if (item.status === "approved") return "completed";
    return item.status === "in_progress" ? undefined : "failed";
  }
  if (item.type === "activity") {
    if (item.status === undefined || item.status === "completed") return "completed";
    return item.status === "pending" || item.status === "running" ? undefined : "failed";
  }
  if (item.type !== "command" && item.type !== "runtime_status" && item.type !== "tool") {
    return undefined;
  }
  if (item.status === "completed") return "completed";
  return item.status === "pending" || item.status === "running" ? undefined : "failed";
}

function isCompletedTurnProcessItem(item: AgentItem, hasFinalAnswer: boolean): boolean {
  if (!shouldRenderTimelineItem(item)) return false;
  if (item.type === "message") {
    return item.role === "assistant" && item.phase === "commentary";
  }
  if (item.type === "review") return false;
  if (item.type === "plan") return hasFinalAnswer;
  return true;
}

export function resolveCompletedTurnProcess(
  items: readonly AgentItem[],
  turnStatus: AgentTurn["status"],
): CompletedTurnProcess {
  if (turnStatus === "running") return EMPTY_COMPLETED_TURN_PROCESS;

  const finalAnswerIndex = items.findLastIndex(
    (item) => item.type === "message" && item.role === "assistant" && item.phase === "final_answer",
  );
  // 没有最终回答时，结构化 Item 本身仍是唯一结果，不能用空摘要替代其内容。
  if (finalAnswerIndex < 0) return EMPTY_COMPLETED_TURN_PROCESS;
  const processBoundary = finalAnswerIndex;
  const hasFinalAnswer = true;
  const hiddenItemIds: string[] = [];
  const recentOperationRing = new Array<string>(COMPLETED_TURN_RECENT_OPERATION_LIMIT);
  let operationCount = 0;
  const filePaths = new Set<string>();
  let completedOperationCount = 0;
  let failedOperationCount = 0;

  // 单次扫描同时完成分类和摘要，避免为超大 Turn 建立多份中间 Item 数组。
  for (let index = 0; index < processBoundary; index += 1) {
    const item = items[index];
    if (item === undefined || !isCompletedTurnProcessItem(item, hasFinalAnswer)) continue;

    hiddenItemIds.push(item.id);
    if (item.type === "file_change") {
      for (const change of item.changes) filePaths.add(change.path);
      continue;
    }

    const outcome = resolveOperationOutcome(item);
    if (outcome !== undefined) {
      recentOperationRing[operationCount % COMPLETED_TURN_RECENT_OPERATION_LIMIT] = item.id;
      operationCount += 1;
      if (outcome === "completed") completedOperationCount += 1;
      if (outcome === "failed") failedOperationCount += 1;
    }
  }

  const recentOperationCount = Math.min(operationCount, COMPLETED_TURN_RECENT_OPERATION_LIMIT);
  const recentOperationItemIds = Array.from({ length: recentOperationCount }, (_, index) => {
    const ringIndex =
      operationCount <= COMPLETED_TURN_RECENT_OPERATION_LIMIT
        ? index
        : (operationCount + index) % COMPLETED_TURN_RECENT_OPERATION_LIMIT;
    return recentOperationRing[ringIndex] ?? "";
  });

  return {
    completedOperationCount,
    failedOperationCount,
    fileCount: filePaths.size,
    hiddenItemIds,
    recentOperationItemIds,
  };
}
