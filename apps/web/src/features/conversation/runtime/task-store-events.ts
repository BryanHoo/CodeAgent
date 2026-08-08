import type { AgentEvent, AgentItem } from "@code-agent/protocol";

import {
  MAX_RETAINED_TASK_NOTICES,
  PENDING_COMMAND_LABEL,
  createTaskItemStore,
  readTaskItem,
  retainPendingRequest,
  type TaskItemStore,
  type TaskStoreState,
} from "./task-store-core.js";
import { mergeRealtimeExpandedSkill } from "./task-store-skill.js";
export function getTouchedCommandOutputItemIds(
  previousState: TaskStoreState,
  nextState: TaskStoreState,
  event: AgentEvent,
): readonly string[] | undefined {
  if (event.type === "command.output_delta") {
    return [event.itemId];
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    return event.payload.item.type === "command" ||
      previousState.commandOutputBytesByItemId.has(event.itemId)
      ? [event.itemId]
      : undefined;
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return [
      ...(previousState.itemIdsByTurnId[event.turnId] ?? []),
      ...(nextState.itemIdsByTurnId[event.turnId] ?? []),
    ];
  }
  return undefined;
}
function createDeltaItem(event: Extract<AgentEvent, { itemId: string }>): AgentItem | undefined {
  switch (event.type) {
    case "message.delta":
      return {
        id: event.itemId,
        role: "assistant",
        text: "",
        type: "message",
      };
    case "reasoning.delta":
      return {
        content: "",
        id: event.itemId,
        summary: "",
        type: "reasoning",
      };
    case "plan.delta":
      return {
        id: event.itemId,
        text: "",
        type: "plan",
      };
    case "command.output_delta": {
      return {
        command: PENDING_COMMAND_LABEL,
        cwd: "",
        id: event.itemId,
        output: "",
        outputTruncated: false,
        status: "running",
        type: "command",
      };
    }
    default:
      return undefined;
  }
}
function replaceTurnItems(
  state: TaskStoreState,
  turnId: string,
  items: readonly AgentItem[],
  changedItemStores: Set<TaskItemStore>,
): Pick<TaskStoreState, "itemIdsByTurnId" | "itemTurnIdsById"> {
  const previousItemIds = state.itemIdsByTurnId[turnId] ?? [];
  const replacedItemIds = new Set(previousItemIds);
  const nextItemIds = new Set(items.map((item) => item.id));
  const itemTurnIdsById: Record<string, string> = {};
  for (const itemId of state.itemStoresById.keys()) {
    if (!replacedItemIds.has(itemId)) {
      const owningTurnId = state.itemTurnIdsById[itemId];
      if (owningTurnId !== undefined) {
        itemTurnIdsById[itemId] = owningTurnId;
      }
    }
  }
  for (const item of items) {
    const existingTurnId = itemTurnIdsById[item.id];
    if (existingTurnId !== undefined && existingTurnId !== turnId) {
      throw new Error(`Agent item ${item.id} is shared by multiple turns`);
    }
    itemTurnIdsById[item.id] = turnId;
  }
  for (const itemId of previousItemIds) {
    if (!nextItemIds.has(itemId)) {
      state.itemStoresById.delete(itemId);
    }
  }
  for (const item of items) {
    const itemStore = state.itemStoresById.get(item.id);
    if (itemStore === undefined) {
      state.itemStoresById.set(item.id, createTaskItemStore(item));
    } else {
      itemStore.replace(item);
      changedItemStores.add(itemStore);
    }
  }
  return {
    itemIdsByTurnId: {
      ...state.itemIdsByTurnId,
      [turnId]: items.map((item) => item.id),
    },
    itemTurnIdsById,
  };
}
function mergeTerminalTurnItems(
  state: TaskStoreState,
  turnId: string,
  terminalItems: readonly AgentItem[],
): readonly AgentItem[] {
  const submittedUserItemId = `submitted-user-${turnId}`;
  const terminalUserItem = terminalItems.find(
    (item) => item.type === "message" && item.role === "user",
  );
  const currentItems: AgentItem[] = [];
  const seenCurrentItemIds = new Set<string>();
  for (const itemId of state.itemIdsByTurnId[turnId] ?? []) {
    const currentItem = readTaskItem(state, itemId);
    if (currentItem === undefined) {
      continue;
    }
    // 启动响应可能缺少用户 Item；终态到达后由真实实体接管本地提交占位符。
    const resolvedItem =
      currentItem.id === submittedUserItemId && terminalUserItem !== undefined
        ? terminalUserItem
        : currentItem;
    if (!seenCurrentItemIds.has(resolvedItem.id)) {
      seenCurrentItemIds.add(resolvedItem.id);
      currentItems.push(resolvedItem);
    }
  }

  const currentItemIds = new Set(currentItems.map((item) => item.id));
  const terminalItemsById = new Map(terminalItems.map((item) => [item.id, item]));
  const terminalItemsBeforeCurrentId = new Map<string, AgentItem[]>();
  let pendingTerminalItems: AgentItem[] = [];
  for (const terminalItem of terminalItems) {
    if (!currentItemIds.has(terminalItem.id)) {
      pendingTerminalItems.push(terminalItem);
      continue;
    }
    if (pendingTerminalItems.length > 0) {
      terminalItemsBeforeCurrentId.set(terminalItem.id, pendingTerminalItems);
      pendingTerminalItems = [];
    }
  }

  // 已展示 Item 不移动；终态新增 Item 依照下一个共同实体插入，兼顾两条有序序列。
  return [
    ...currentItems.flatMap((item) => [
      ...(terminalItemsBeforeCurrentId.get(item.id) ?? []),
      terminalItemsById.get(item.id) ?? item,
    ]),
    ...pendingTerminalItems,
  ];
}

export function applyAcceptedEvent(
  state: TaskStoreState,
  event: AgentEvent,
  changedItemStores: Set<TaskItemStore>,
): Partial<TaskStoreState> {
  const snapshotMetadata = state.snapshotMetadata;
  if (snapshotMetadata === null) {
    return {};
  }

  const checkpoint = { sequence: event.sequence, sessionId: event.sessionId };
  switch (event.type) {
    case "turn.started": {
      const { items, ...normalizedTurn } = event.payload.turn;
      return {
        checkpoint,
        ...replaceTurnItems(state, event.turnId, items, changedItemStores),
        snapshotMetadata: {
          ...snapshotMetadata,
          status: "running",
          updatedAt: event.timestamp,
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        turnIds: [...state.turnIds.filter((turnId) => turnId !== event.turnId), event.turnId],
        turnsById: { ...state.turnsById, [event.turnId]: normalizedTurn },
      };
    }
    case "message.delta":
    case "plan.delta":
    case "reasoning.delta":
    case "command.output_delta": {
      const currentTurn = state.turnsById[event.turnId];
      if (currentTurn === undefined) {
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      // 新输出证明可重试故障已经恢复；已失败 Turn 的确认错误继续保留。
      const turnsById =
        currentTurn.status === "running" && currentTurn.error !== null
          ? { ...state.turnsById, [event.turnId]: { ...currentTurn, error: null } }
          : state.turnsById;
      const currentItemStore = state.itemStoresById.get(event.itemId);
      if (currentItemStore !== undefined && state.itemTurnIdsById[event.itemId] !== event.turnId) {
        throw new Error(`Agent item ${event.itemId} belongs to another turn`);
      }
      if (currentItemStore !== undefined) {
        if (currentItemStore.appendDelta(event)) {
          changedItemStores.add(currentItemStore);
        }
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          turnsById,
        };
      }
      const createdItem = createDeltaItem(event);
      if (createdItem === undefined) {
        return { checkpoint };
      }
      const createdItemStore = createTaskItemStore(createdItem);
      createdItemStore.appendDelta(event);
      state.itemStoresById.set(event.itemId, createdItemStore);
      changedItemStores.add(createdItemStore);
      return {
        checkpoint,
        itemIdsByTurnId: {
          ...state.itemIdsByTurnId,
          [event.turnId]: [...(state.itemIdsByTurnId[event.turnId] ?? []), event.itemId],
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        itemTurnIdsById: { ...state.itemTurnIdsById, [event.itemId]: event.turnId },
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        turnsById,
      };
    }
    case "tool.progress": {
      const currentItemStore = state.itemStoresById.get(event.itemId);
      if (currentItemStore === undefined || state.itemTurnIdsById[event.itemId] !== event.turnId) {
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      const currentItem = currentItemStore.read();
      if (currentItem.type !== "tool") {
        return { checkpoint };
      }
      currentItemStore.replace({ ...currentItem, progress: event.payload.message });
      changedItemStores.add(currentItemStore);
      return {
        checkpoint,
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
    case "file_change.updated": {
      const currentItemStore = state.itemStoresById.get(event.itemId);
      if (currentItemStore !== undefined) {
        if (state.itemTurnIdsById[event.itemId] !== event.turnId) {
          throw new Error(`Agent item ${event.itemId} belongs to another turn`);
        }
        const currentItem = currentItemStore.read();
        if (currentItem.type !== "file_change") {
          return { checkpoint };
        }
        currentItemStore.replace({
          ...currentItem,
          changes: event.payload.changes,
          status: "running",
        });
        changedItemStores.add(currentItemStore);
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      if (state.turnsById[event.turnId] === undefined) {
        return { checkpoint };
      }
      const createdItemStore = createTaskItemStore({
        changes: event.payload.changes,
        id: event.itemId,
        status: "running",
        type: "file_change",
      });
      state.itemStoresById.set(event.itemId, createdItemStore);
      changedItemStores.add(createdItemStore);
      return {
        checkpoint,
        itemIdsByTurnId: {
          ...state.itemIdsByTurnId,
          [event.turnId]: [...(state.itemIdsByTurnId[event.turnId] ?? []), event.itemId],
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        itemTurnIdsById: { ...state.itemTurnIdsById, [event.itemId]: event.turnId },
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
    case "turn.diff_updated":
      return {
        checkpoint,
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        turnDiffsById: { ...state.turnDiffsById, [event.turnId]: event.payload.diff },
      };
    case "task.notice":
      return {
        checkpoint,
        notices: [...state.notices, event].slice(-MAX_RETAINED_TASK_NOTICES),
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    case "item.started":
    case "item.completed": {
      if (state.turnsById[event.turnId] === undefined) {
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      const currentItemStore = state.itemStoresById.get(event.itemId);
      const itemAlreadyExists = currentItemStore !== undefined;
      if (itemAlreadyExists && state.itemTurnIdsById[event.itemId] !== event.turnId) {
        throw new Error(`Agent item ${event.itemId} belongs to another turn`);
      }
      const currentItemIds = state.itemIdsByTurnId[event.turnId] ?? [];
      const previousItemId = currentItemIds.at(-1);
      const previousItemStore =
        previousItemId === undefined ? undefined : state.itemStoresById.get(previousItemId);
      const mergedExpandedSkill = mergeRealtimeExpandedSkill(
        previousItemStore?.read(),
        event.payload.item,
      );
      if (mergedExpandedSkill !== undefined && previousItemStore !== undefined) {
        // Codex 将 Skill 展开为紧邻用户项；实时链路原位合并，避免产生第二个用户气泡。
        previousItemStore.replace(mergedExpandedSkill);
        changedItemStores.add(previousItemStore);
        return {
          checkpoint,
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
        };
      }
      const submittedUserItemId = `submitted-user-${event.turnId}`;
      const replacesSubmittedUserItem =
        event.payload.item.type === "message" &&
        event.payload.item.role === "user" &&
        currentItemIds.includes(submittedUserItemId);
      const nextItemIds = replacesSubmittedUserItem
        ? currentItemIds
            .filter((itemId) => itemId !== submittedUserItemId)
            .concat(itemAlreadyExists ? [] : event.itemId)
        : itemAlreadyExists
          ? currentItemIds
          : [...currentItemIds, event.itemId];
      // Provider 用户项到达后原子移除提交占位，避免同一输入重复展示。
      if (replacesSubmittedUserItem) {
        state.itemStoresById.delete(submittedUserItemId);
      }
      const retainedItemTurnIds = replacesSubmittedUserItem
        ? Object.fromEntries(
            Object.entries(state.itemTurnIdsById).filter(
              ([itemId]) => itemId !== submittedUserItemId,
            ),
          )
        : state.itemTurnIdsById;
      if (currentItemStore === undefined) {
        state.itemStoresById.set(event.itemId, createTaskItemStore(event.payload.item));
      } else {
        currentItemStore.replace(event.payload.item);
        changedItemStores.add(currentItemStore);
      }
      return {
        checkpoint,
        itemIdsByTurnId:
          nextItemIds === currentItemIds
            ? state.itemIdsByTurnId
            : { ...state.itemIdsByTurnId, [event.turnId]: nextItemIds },
        itemStructureRevision: state.itemStructureRevision + 1,
        itemTurnIdsById: { ...retainedItemTurnIds, [event.itemId]: event.turnId },
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
    case "turn.completed": {
      const currentTurn = state.turnsById[event.turnId];
      const nonRetryingProviderError = currentTurn?.status === "failed" ? currentTurn.error : null;
      // 失败终态缺少错误时，保留此前不可重试的 Provider 错误。
      const completedTurn =
        event.payload.turn.error === null && nonRetryingProviderError !== null
          ? { ...event.payload.turn, error: nonRetryingProviderError }
          : event.payload.turn;
      const { items: terminalItems, ...normalizedTurn } = completedTurn;
      const items = mergeTerminalTurnItems(state, event.turnId, terminalItems);
      return {
        checkpoint,
        ...(currentTurn === undefined
          ? {}
          : replaceTurnItems(state, event.turnId, items, changedItemStores)),
        snapshotMetadata: {
          ...snapshotMetadata,
          status: completedTurn.status === "failed" ? "failed" : "idle",
          updatedAt: event.timestamp,
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        turnDiffsById: Object.fromEntries(
          Object.entries(state.turnDiffsById).filter(([turnId]) => turnId !== event.turnId),
        ),
        turnsById:
          currentTurn === undefined
            ? state.turnsById
            : { ...state.turnsById, [event.turnId]: normalizedTurn },
      };
    }
    case "plan.updated":
      return {
        checkpoint,
        snapshotMetadata: {
          ...snapshotMetadata,
          plan: event.payload.plan,
          updatedAt: event.timestamp,
        },
      };
    case "usage.updated":
      return {
        checkpoint,
        snapshotMetadata: {
          ...snapshotMetadata,
          contextUsage: event.payload.usage,
          updatedAt: event.timestamp,
        },
      };
    case "provider.error": {
      const currentTurn = state.turnsById[event.turnId];
      const turnsById =
        currentTurn === undefined
          ? state.turnsById
          : {
              ...state.turnsById,
              [event.turnId]: {
                ...currentTurn,
                error: event.payload.message,
                status: event.payload.willRetry ? currentTurn.status : ("failed" as const),
              },
            };
      return {
        checkpoint,
        snapshotMetadata: event.payload.willRetry
          ? snapshotMetadata
          : { ...snapshotMetadata, status: "failed", updatedAt: event.timestamp },
        turnsById,
      };
    }
    case "pending_request.created":
    case "pending_request.resolved":
    case "pending_request.expired": {
      const request = event.payload.request;
      return {
        checkpoint,
        ...retainPendingRequest(state, request),
        snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
      };
    }
  }
}
