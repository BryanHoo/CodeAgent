import { isRecord } from "./codex-protocol-mapping.js";

export function readTaskId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value["threadId"] === "string") {
    return value["threadId"];
  }
  const thread = value["thread"];
  return isRecord(thread) && typeof thread["id"] === "string" ? thread["id"] : undefined;
}

export function readNotificationTurnId(method: string, value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (method === "turn/started" || method === "turn/completed") {
    const turn = value["turn"];
    return isRecord(turn) && typeof turn["id"] === "string" ? turn["id"] : undefined;
  }
  return typeof value["turnId"] === "string" ? value["turnId"] : undefined;
}

export function readNotificationItemType(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return undefined;
  }
  const type = value["item"]["type"];
  return typeof type === "string" ? type : undefined;
}

export function isFinalAgentMessage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return false;
  }
  const item = value["item"];
  return (
    item["phase"] !== "commentary" &&
    typeof item["text"] === "string" &&
    item["text"].trim().length > 0
  );
}

export function isCommentaryAgentMessage(value: unknown): boolean {
  return isRecord(value) && isRecord(value["item"]) && value["item"]["phase"] === "commentary";
}

export function isReviewerFailureFallback(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return false;
  }
  // Codex 会先发该占位终态，再由 reviewer 子 Thread 给出真正的中断或失败原因。
  return value["item"]["review"] === "Reviewer failed to output a response.";
}

export function readReviewWorkerThread(
  value: unknown,
): Readonly<{ parentTaskId: string; workerTaskId: string }> | undefined {
  if (!isRecord(value) || !isRecord(value["thread"])) {
    return undefined;
  }
  const thread = value["thread"];
  const source = thread["source"];
  if (
    typeof thread["id"] !== "string" ||
    typeof thread["parentThreadId"] !== "string" ||
    !isRecord(source) ||
    source["subAgent"] !== "review"
  ) {
    return undefined;
  }
  return {
    parentTaskId: thread["parentThreadId"],
    workerTaskId: thread["id"],
  };
}
