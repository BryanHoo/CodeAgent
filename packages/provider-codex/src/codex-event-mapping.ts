import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentMessageAttachment, AgentReviewTarget } from "@code-agent/protocol";

import {
  CODEX_NOTIFICATION_METHODS,
  CodexProtocolMappingError,
  expectRecord,
  expectString,
} from "./codex-mapping-common.js";
import { mapAgentItem, mapApprovalReviewItem } from "./codex-item-mapping.js";
import { mapContextUsage, mapAgentTurn } from "./codex-task-mapping.js";
import {
  createReviewItem,
  inferReviewTargetFromPrompt,
  mapReviewHint,
  markStartedItemRunning,
} from "./codex-tool-mapping.js";

export function mapCodexNotification(
  method: string,
  value: unknown,
  mapImage: (
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ) => AgentMessageAttachment | undefined,
  mapText: (
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ) => AgentMessageAttachment | undefined,
  reviewTarget?: AgentReviewTarget,
  explicitTurnId?: string,
  reviewWorker = false,
  suppressReviewResult = false,
  explicitTaskId?: string,
): AgentProviderEvent | undefined {
  if (!CODEX_NOTIFICATION_METHODS.has(method)) {
    return undefined;
  }

  const params = expectRecord(value, `Codex ${method} params`);
  const taskId = explicitTaskId ?? expectString(params["threadId"], `Codex ${method} threadId`);

  if (method === "thread/tokenUsage/updated") {
    return {
      payload: { usage: mapContextUsage(params["tokenUsage"]) },
      taskId,
      turnId: explicitTurnId ?? expectString(params["turnId"], "Codex token usage turnId"),
      type: "usage.updated",
    };
  }

  if (method === "turn/started" || method === "turn/completed") {
    const turn = mapAgentTurn(
      params["turn"],
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
      reviewTarget,
      explicitTurnId,
      reviewWorker,
      suppressReviewResult,
    );
    return {
      payload: { turn },
      taskId,
      turnId: turn.id,
      type: method === "turn/started" ? "turn.started" : "turn.completed",
    };
  }

  const turnId = explicitTurnId ?? expectString(params["turnId"], `Codex ${method} turnId`);
  if (method === "error") {
    const error = expectRecord(params["error"], "Codex error notification error");
    if (typeof params["willRetry"] !== "boolean") {
      throw new CodexProtocolMappingError("Codex error notification willRetry must be a boolean");
    }
    return {
      payload: {
        message: expectString(error["message"], "Codex error notification message"),
        willRetry: params["willRetry"],
      },
      taskId,
      turnId,
      type: "provider.error",
    };
  }

  if (
    method === "item/autoApprovalReview/started" ||
    method === "item/autoApprovalReview/completed"
  ) {
    const item = mapApprovalReviewItem(params);
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: method === "item/autoApprovalReview/started" ? "item.started" : "item.completed",
    };
  }

  if (method === "item/started") {
    const nativeItem = expectRecord(params["item"], "Codex started item");
    if (nativeItem["type"] === "enteredReviewMode") {
      const item = createReviewItem(
        turnId,
        reviewTarget ?? mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint")),
      );
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.started" };
    }
    // 文本与推理由专用 Delta 创建；结构化操作必须立即交付当前运行状态。
    if (
      nativeItem["type"] === "userMessage" ||
      nativeItem["type"] === "agentMessage" ||
      nativeItem["type"] === "reasoning" ||
      nativeItem["type"] === "exitedReviewMode"
    ) {
      return undefined;
    }
    const item = markStartedItemRunning(mapAgentItem(nativeItem));
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.started",
    };
  }

  if (method === "item/completed") {
    const nativeItem = expectRecord(params["item"], "Codex completed item");
    const promptReviewTarget = inferReviewTargetFromPrompt(nativeItem);
    if (nativeItem["type"] === "userMessage" && reviewTarget !== undefined) {
      return undefined;
    }
    if (nativeItem["type"] === "enteredReviewMode" || promptReviewTarget !== undefined) {
      const target =
        reviewTarget ??
        promptReviewTarget ??
        mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint"));
      const item = createReviewItem(turnId, target);
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.completed" };
    }
    const item = mapAgentItem(
      nativeItem,
      new Map(),
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
    );
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.completed",
    };
  }

  const itemId = expectString(params["itemId"], `Codex ${method} itemId`);
  const delta = expectString(params["delta"], `Codex ${method} delta`);
  if (method === "item/agentMessage/delta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "message.delta" };
  }
  if (method === "item/commandExecution/outputDelta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "command.output_delta" };
  }
  return {
    itemId,
    payload: {
      delta,
      field: method === "item/reasoning/summaryTextDelta" ? "summary" : "content",
    },
    taskId,
    turnId,
    type: "reasoning.delta",
  };
}
