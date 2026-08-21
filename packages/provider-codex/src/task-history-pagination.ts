import type { ReadAgentTaskInput } from "@code-agent/core";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

export const TASK_TURN_PAGE_LIMIT = 10;
const TASK_ITEM_PAGE_LIMIT = 100;
const MAX_TASK_TURN_CURSOR_BYTES = 8_192;

export type CodexThreadHistoryMode = "legacy" | "paginated";

export type TaskTurnCursorState = Readonly<{
  reviewOffset: number;
  turnCursor?: string;
}>;

export type NativeTaskTurnPage = Readonly<{
  nextTurnCursor: string | null;
  turns: unknown[];
}>;

export function readThreadHistoryMode(thread: Record<string, unknown>): CodexThreadHistoryMode {
  const historyMode = expectString(thread["historyMode"], "Codex thread historyMode");
  if (historyMode !== "legacy" && historyMode !== "paginated") {
    throw new CodexProtocolMappingError("Codex thread historyMode is invalid");
  }
  return historyMode;
}

export function decodeTaskTurnCursor(input: ReadAgentTaskInput = {}): TaskTurnCursorState {
  if (input.cursor === undefined) {
    return { reviewOffset: 0 };
  }
  if (Buffer.byteLength(input.cursor, "utf8") > MAX_TASK_TURN_CURSOR_BYTES) {
    throw new CodexProtocolMappingError("Task turn cursor is too large");
  }
  try {
    const value = expectRecord(
      JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
      "Task turn cursor",
    );
    const reviewOffset = value["reviewOffset"];
    const turnCursor = value["turnCursor"];
    if (
      value["version"] !== 1 ||
      !Number.isSafeInteger(reviewOffset) ||
      (reviewOffset as number) < 0 ||
      typeof turnCursor !== "string" ||
      turnCursor.length === 0
    ) {
      throw new CodexProtocolMappingError("Task turn cursor is invalid");
    }
    return { reviewOffset: reviewOffset as number, turnCursor };
  } catch (error) {
    if (error instanceof CodexProtocolMappingError) {
      throw error;
    }
    throw new CodexProtocolMappingError("Task turn cursor is invalid");
  }
}

export function encodeTaskTurnCursor(
  turnCursor: string | null,
  reviewOffset: number,
): string | null {
  if (turnCursor === null) {
    return null;
  }
  return Buffer.from(JSON.stringify({ reviewOffset, turnCursor, version: 1 }), "utf8").toString(
    "base64url",
  );
}

async function readTurnItems(
  client: CodexRpcClient,
  threadId: string,
  turnId: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = expectRecord(
      await client.request("thread/items/list", {
        ...(cursor === undefined ? {} : { cursor }),
        limit: TASK_ITEM_PAGE_LIMIT,
        sortDirection: "asc",
        threadId,
        turnId,
      }),
      "thread/items/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("thread/items/list data must be an array");
    }
    for (const value of response["data"]) {
      const entry = expectRecord(value, "Codex thread item entry");
      if (expectString(entry["turnId"], "Codex thread item turn id") !== turnId) {
        throw new CodexProtocolMappingError("thread/items/list returned a different turn");
      }
      items.push(expectRecord(entry["item"], "Codex thread item"));
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor === null) {
      cursor = undefined;
    } else {
      const next = expectString(nextCursor, "thread/items/list next cursor");
      if (next === cursor || seenCursors.has(next)) {
        throw new CodexProtocolMappingError("thread/items/list returned a repeated cursor");
      }
      seenCursors.add(next);
      cursor = next;
    }
  } while (cursor !== undefined);
  return items;
}

export async function readNativeTaskTurnPage(
  client: CodexRpcClient,
  threadId: string,
  historyMode: CodexThreadHistoryMode,
  turnCursor?: string,
): Promise<NativeTaskTurnPage> {
  const response = expectRecord(
    await client.request("thread/turns/list", {
      ...(turnCursor === undefined ? {} : { cursor: turnCursor }),
      itemsView: historyMode === "paginated" ? "notLoaded" : "full",
      limit: TASK_TURN_PAGE_LIMIT,
      sortDirection: "desc",
      threadId,
    }),
    "thread/turns/list response",
  );
  if (!Array.isArray(response["data"])) {
    throw new CodexProtocolMappingError("thread/turns/list data must be an array");
  }
  const turns = await Promise.all(
    response["data"].map(async (value) => {
      const turn = expectRecord(value, "Codex turn");
      if (historyMode === "legacy") {
        if (!Array.isArray(turn["items"])) {
          throw new CodexProtocolMappingError("Codex legacy turn items must be an array");
        }
        return turn;
      }
      const turnId = expectString(turn["id"], "Codex turn id");
      return { ...turn, items: await readTurnItems(client, threadId, turnId), itemsView: "full" };
    }),
  );
  const nextCursor = response["nextCursor"];
  const nextTurnCursor =
    nextCursor === null ? null : expectString(nextCursor, "thread/turns/list next cursor");
  if (nextTurnCursor !== null && (nextTurnCursor.length === 0 || nextTurnCursor === turnCursor)) {
    throw new CodexProtocolMappingError("thread/turns/list returned a repeated cursor");
  }
  return {
    nextTurnCursor,
    // Codex 默认返回 newest-first，Provider 边界统一恢复时间正序。
    turns: turns.reverse(),
  };
}
