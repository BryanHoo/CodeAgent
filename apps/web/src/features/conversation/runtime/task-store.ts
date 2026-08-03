import type { AgentEventConnectionState } from "@code-agent/client";
import type {
  AgentEvent,
  AgentItem,
  AgentTaskSnapshot,
  AgentTurn,
  EventCheckpoint,
  PendingRequest,
} from "@code-agent/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";

const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES = 10_000;
export const MAX_TASK_COMMAND_OUTPUT_BYTES = 8 * 1_048_576;
export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
export const MAX_RETAINED_TERMINAL_REQUESTS = 20;
export const PENDING_COMMAND_LABEL = "__CODE_AGENT_PENDING_COMMAND__";
export const RETAINED_COMMAND_OUTPUT_MARKER = "__CODE_AGENT_RETAINED_COMMAND_OUTPUT__";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const retainedCommandOutputMarkerBytes = textEncoder.encode(
  RETAINED_COMMAND_OUTPUT_MARKER,
).byteLength;

export type NormalizedAgentTurn = Omit<AgentTurn, "items">;
export type TaskSnapshotMetadata = Omit<AgentTaskSnapshot, "pendingRequests" | "turns">;
export type ReconstructedTaskSnapshot = Omit<AgentTaskSnapshot, "pendingRequests"> &
  Readonly<{ pendingRequests: readonly PendingRequest[] }>;
export type TaskStoreHydrationResponse = Readonly<{
  checkpoint: EventCheckpoint;
  snapshot: ReconstructedTaskSnapshot;
}>;

export interface TaskStoreIdentity {
  projectId: string;
  taskId: string;
}

export interface TaskStoreState {
  applyEvents: (events: readonly AgentEvent[]) => void;
  checkpoint: EventCheckpoint | null;
  commandOutputAccessByItemId: Map<string, number>;
  commandOutputAccessSequence: number;
  commandOutputBytesByItemId: Map<string, number>;
  commandOutputBytes: number;
  connectionState: AgentEventConnectionState;
  error: Error | null;
  hydrate: (response: TaskStoreHydrationResponse) => void;
  itemIdsByTurnId: Readonly<Record<string, readonly string[]>>;
  itemStoresById: Map<string, TaskItemStore>;
  itemStructureRevision: number;
  itemTurnIdsById: Readonly<Record<string, string>>;
  getItem: (itemId: string) => AgentItem | undefined;
  pendingRequestIds: readonly string[];
  pendingRequestsById: Readonly<Record<string, PendingRequest>>;
  projectId: string;
  reconcile: (response: TaskStoreHydrationResponse) => void;
  reconstructSnapshot: () => ReconstructedTaskSnapshot | undefined;
  setConnectionState: (connectionState: AgentEventConnectionState) => void;
  setError: (error: Error | null) => void;
  snapshotMetadata: TaskSnapshotMetadata | null;
  taskId: string;
  turnIds: readonly string[];
  turnsById: Readonly<Record<string, NormalizedAgentTurn>>;
}

export type TaskStore = StoreApi<TaskStoreState>;

export interface TaskItemStoreState {
  revision: number;
}

type DeltaEvent = Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "reasoning.delta" }
>;

export interface TaskItemStore extends StoreApi<TaskItemStoreState> {
  appendDelta: (event: DeltaEvent) => boolean;
  peek: () => AgentItem;
  publish: () => void;
  read: () => AgentItem;
  replace: (item: AgentItem) => void;
}

type StreamedTextField = "content" | "output" | "summary" | "text";

function createTaskItemStore(initialItem: AgentItem): TaskItemStore {
  let baseItem = initialItem;
  // Delta 热路径只追加 Chunk；完整字符串仅在目标 Item 被读取时延迟物化并缓存。
  const chunksByField = new Map<StreamedTextField, string[]>();
  let contentGeneration = 0;
  let materializedGeneration = 0;
  let materializedItem = initialItem;
  const store = createStore<TaskItemStoreState>()(() => ({ revision: 0 }));

  function appendChunk(field: StreamedTextField, delta: string): void {
    const chunks = chunksByField.get(field);
    if (chunks === undefined) {
      chunksByField.set(field, [delta]);
    } else {
      chunks.push(delta);
    }
    contentGeneration += 1;
  }

  return Object.assign(store, {
    appendDelta(event: DeltaEvent): boolean {
      if (event.type === "message.delta") {
        if (baseItem.type !== "message" || baseItem.role !== "assistant") {
          return false;
        }
        appendChunk("text", event.payload.delta);
        return true;
      }
      if (event.type === "reasoning.delta") {
        if (baseItem.type !== "reasoning") {
          return false;
        }
        appendChunk(event.payload.field, event.payload.delta);
        return true;
      }
      if (baseItem.type !== "command") {
        return false;
      }
      appendChunk("output", event.payload.delta);
      return true;
    },
    peek: (): AgentItem => baseItem,
    publish(): void {
      store.setState((state) => ({ revision: state.revision + 1 }));
    },
    read(): AgentItem {
      if (materializedGeneration === contentGeneration) {
        return materializedItem;
      }
      let nextItem = baseItem;
      if (baseItem.type === "message") {
        const chunks = chunksByField.get("text");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: [baseItem.text, ...chunks].join("") };
        }
      } else if (baseItem.type === "reasoning") {
        const contentChunks = chunksByField.get("content");
        const summaryChunks = chunksByField.get("summary");
        if (contentChunks !== undefined || summaryChunks !== undefined) {
          nextItem = {
            ...baseItem,
            content:
              contentChunks === undefined
                ? baseItem.content
                : [baseItem.content, ...contentChunks].join(""),
            summary:
              summaryChunks === undefined
                ? baseItem.summary
                : [baseItem.summary, ...summaryChunks].join(""),
          };
        }
      } else if (baseItem.type === "command") {
        const chunks = chunksByField.get("output");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, output: [baseItem.output ?? "", ...chunks].join("") };
        }
      }
      materializedItem = nextItem;
      materializedGeneration = contentGeneration;
      return materializedItem;
    },
    replace(item: AgentItem): void {
      baseItem = item;
      chunksByField.clear();
      contentGeneration += 1;
    },
  });
}

type NormalizedTaskData = Pick<
  TaskStoreState,
  | "checkpoint"
  | "commandOutputAccessByItemId"
  | "commandOutputAccessSequence"
  | "commandOutputBytesByItemId"
  | "commandOutputBytes"
  | "itemIdsByTurnId"
  | "itemStoresById"
  | "itemStructureRevision"
  | "itemTurnIdsById"
  | "pendingRequestIds"
  | "pendingRequestsById"
  | "snapshotMetadata"
  | "turnIds"
  | "turnsById"
>;

type PendingRequestState = Pick<TaskStoreState, "pendingRequestIds" | "pendingRequestsById">;

function retainPendingRequest(
  state: PendingRequestState,
  request: PendingRequest,
): PendingRequestState {
  const requestAlreadyExists = state.pendingRequestsById[request.requestId] !== undefined;
  let pendingRequestIds = state.pendingRequestIds;
  if (request.status !== "pending") {
    // 终态按事件到达顺序移到末尾，容量淘汰基于实际结束时间而非创建时间。
    pendingRequestIds = [
      ...state.pendingRequestIds.filter((requestId) => requestId !== request.requestId),
      request.requestId,
    ];
  } else if (!requestAlreadyExists) {
    pendingRequestIds = [...state.pendingRequestIds, request.requestId];
  }
  const pendingRequestsById = {
    ...state.pendingRequestsById,
    [request.requestId]: request,
  };
  const terminalRequestIds = pendingRequestIds.filter(
    (requestId) => pendingRequestsById[requestId]?.status !== "pending",
  );
  const evictedRequestIds = new Set(terminalRequestIds.slice(0, -MAX_RETAINED_TERMINAL_REQUESTS));
  if (evictedRequestIds.size === 0) {
    return { pendingRequestIds, pendingRequestsById };
  }

  // 活动请求全部保留；终态只保留最近一段，避免长会话持续扩大 Store 和 Timeline 遍历量。
  return {
    pendingRequestIds: pendingRequestIds.filter((requestId) => !evictedRequestIds.has(requestId)),
    pendingRequestsById: Object.fromEntries(
      Object.entries(pendingRequestsById).filter(
        ([requestId]) => !evictedRequestIds.has(requestId),
      ),
    ),
  };
}

function normalizeSnapshot(response: TaskStoreHydrationResponse): NormalizedTaskData {
  const { pendingRequests, turns, ...snapshotMetadata } = response.snapshot;
  const turnIds: string[] = [];
  const turnsById: Record<string, NormalizedAgentTurn> = {};
  const itemIdsByTurnId: Record<string, readonly string[]> = {};
  const itemTurnIdsById: Record<string, string> = {};
  const itemStoresById = new Map<string, TaskItemStore>();

  for (const turn of turns) {
    const { items, ...normalizedTurn } = turn;
    turnIds.push(turn.id);
    turnsById[turn.id] = normalizedTurn;
    itemIdsByTurnId[turn.id] = items.map((item) => item.id);
    for (const item of items) {
      const existingTurnId = itemTurnIdsById[item.id];
      if (existingTurnId !== undefined && existingTurnId !== turn.id) {
        throw new Error(`Agent item ${item.id} is shared by multiple turns`);
      }
      itemTurnIdsById[item.id] = turn.id;
      itemStoresById.set(item.id, createTaskItemStore(item));
    }
  }

  let pendingRequestState: PendingRequestState = {
    pendingRequestIds: [],
    pendingRequestsById: {},
  };
  for (const request of pendingRequests) {
    pendingRequestState = retainPendingRequest(pendingRequestState, request);
  }

  const boundedCommandOutputs = updateCommandOutputBudget({
    previousBudget: {
      commandOutputAccessByItemId: new Map<string, number>(),
      commandOutputAccessSequence: 0,
      commandOutputBytes: 0,
      commandOutputBytesByItemId: new Map<string, number>(),
    },
    sourceItemStoresById: itemStoresById,
    touchedItemIds: [...itemStoresById.keys()],
  });

  return {
    checkpoint: response.checkpoint,
    ...boundedCommandOutputs,
    itemIdsByTurnId,
    itemStoresById,
    itemStructureRevision: 0,
    itemTurnIdsById,
    ...pendingRequestState,
    snapshotMetadata,
    turnIds,
    turnsById,
  };
}

function sliceUtf8Tail(
  encodedValue: Uint8Array,
  maxBytes: number,
): Readonly<{
  output: string;
  outputBytes: number;
}> {
  let startIndex = Math.max(0, encodedValue.length - maxBytes);

  // 跳过 UTF-8 续字节，避免截断后产生乱码。
  while (startIndex < encodedValue.length) {
    const currentByte = encodedValue[startIndex];
    if (currentByte === undefined || (currentByte & 0xc0) !== 0x80) {
      break;
    }
    startIndex += 1;
  }
  const retainedValue = encodedValue.subarray(startIndex);
  return {
    output: textDecoder.decode(retainedValue),
    outputBytes: retainedValue.byteLength,
  };
}

function boundCommandOutput(value: string): Readonly<{
  output: string;
  outputBytes: number;
  outputTruncated: boolean;
}> {
  let output = value;
  let outputTruncated = false;
  let newlineCount = 0;

  for (let characterIndex = output.length - 1; characterIndex >= 0; characterIndex -= 1) {
    if (output.charCodeAt(characterIndex) !== 10) {
      continue;
    }
    newlineCount += 1;
    if (newlineCount === MAX_COMMAND_OUTPUT_LINES) {
      output = output.slice(characterIndex + 1);
      outputTruncated = true;
      break;
    }
  }

  const encodedOutput = textEncoder.encode(output);
  if (encodedOutput.byteLength <= MAX_COMMAND_OUTPUT_BYTES) {
    return { output, outputBytes: encodedOutput.byteLength, outputTruncated };
  }
  return {
    ...sliceUtf8Tail(encodedOutput, MAX_COMMAND_OUTPUT_BYTES),
    outputTruncated: true,
  };
}

type CommandOutputBudgetState = Pick<
  TaskStoreState,
  | "commandOutputAccessByItemId"
  | "commandOutputAccessSequence"
  | "commandOutputBytes"
  | "commandOutputBytesByItemId"
>;

type CommandOutputBudgetInput = Readonly<{
  previousBudget: Pick<
    TaskStoreState,
    | "commandOutputAccessByItemId"
    | "commandOutputAccessSequence"
    | "commandOutputBytes"
    | "commandOutputBytesByItemId"
  >;
  changedItemStores?: Set<TaskItemStore>;
  sourceItemStoresById: ReadonlyMap<string, TaskItemStore>;
  touchedItemIds: readonly string[];
}>;

function updateCommandOutputBudget(input: CommandOutputBudgetInput): CommandOutputBudgetState {
  const commandOutputAccessByItemId = input.previousBudget.commandOutputAccessByItemId;
  const commandOutputBytesByItemId = input.previousBudget.commandOutputBytesByItemId;
  let commandOutputAccessSequence = input.previousBudget.commandOutputAccessSequence;
  let commandOutputBytes = input.previousBudget.commandOutputBytes;

  for (const itemId of new Set(input.touchedItemIds)) {
    const previousOutputBytes = commandOutputBytesByItemId.get(itemId) ?? 0;
    const itemStore = input.sourceItemStoresById.get(itemId);
    const item = itemStore?.read();
    if (itemStore === undefined || item?.type !== "command" || item.output === undefined) {
      commandOutputAccessByItemId.delete(itemId);
      commandOutputBytesByItemId.delete(itemId);
      commandOutputBytes -= previousOutputBytes;
      continue;
    }

    const boundedOutput = boundCommandOutput(item.output);
    if (
      boundedOutput.output !== item.output ||
      (boundedOutput.outputTruncated && !item.outputTruncated)
    ) {
      itemStore.replace({
        ...item,
        output: boundedOutput.output,
        outputTruncated: item.outputTruncated || boundedOutput.outputTruncated,
      });
      input.changedItemStores?.add(itemStore);
    }
    commandOutputAccessSequence += 1;
    commandOutputAccessByItemId.set(itemId, commandOutputAccessSequence);
    commandOutputBytesByItemId.set(itemId, boundedOutput.outputBytes);
    commandOutputBytes += boundedOutput.outputBytes - previousOutputBytes;
  }

  if (commandOutputBytes <= MAX_TASK_COMMAND_OUTPUT_BYTES) {
    return {
      commandOutputAccessByItemId,
      commandOutputAccessSequence,
      commandOutputBytes,
      commandOutputBytesByItemId,
    };
  }

  // 仅在任务预算溢出时遍历 LRU 索引，流式热路径无需扫描全部 Timeline Item。
  const leastRecentlyUsedItemIds = [...commandOutputAccessByItemId.keys()].toSorted(
    (leftItemId, rightItemId) =>
      (commandOutputAccessByItemId.get(leftItemId) ?? 0) -
      (commandOutputAccessByItemId.get(rightItemId) ?? 0),
  );
  for (const itemId of leastRecentlyUsedItemIds) {
    if (commandOutputBytes <= MAX_TASK_COMMAND_OUTPUT_BYTES) {
      break;
    }
    const itemStore = input.sourceItemStoresById.get(itemId);
    const item = itemStore?.read();
    if (itemStore === undefined || item?.type !== "command" || item.output === undefined) {
      continue;
    }
    const previousOutputBytes = commandOutputBytesByItemId.get(itemId) ?? 0;
    itemStore.replace({
      ...item,
      output: RETAINED_COMMAND_OUTPUT_MARKER,
      outputTruncated: true,
    });
    input.changedItemStores?.add(itemStore);
    commandOutputBytesByItemId.set(itemId, retainedCommandOutputMarkerBytes);
    commandOutputBytes -= previousOutputBytes - retainedCommandOutputMarkerBytes;
  }

  return {
    commandOutputAccessByItemId,
    commandOutputAccessSequence,
    commandOutputBytes,
    commandOutputBytesByItemId,
  };
}

function readTaskItem(state: TaskStoreState, itemId: string): AgentItem | undefined {
  return state.itemStoresById.get(itemId)?.read();
}

function getTouchedCommandOutputItemIds(
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

function applyAcceptedEvent(
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
        turnsById:
          currentTurn === undefined
            ? state.turnsById
            : { ...state.turnsById, [event.turnId]: normalizedTurn },
      };
    }
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

function reconstructSnapshot(state: TaskStoreState): ReconstructedTaskSnapshot | undefined {
  if (state.snapshotMetadata === null) {
    return undefined;
  }
  return {
    ...state.snapshotMetadata,
    pendingRequests: state.pendingRequestIds.flatMap((requestId) => {
      const request = state.pendingRequestsById[requestId];
      // 兼容快照遵守 HTTP Schema，只重建仍可操作的 pending 请求。
      return request?.status === "pending" ? [request] : [];
    }),
    turns: state.turnIds.flatMap((turnId) => {
      const turn = state.turnsById[turnId];
      if (turn === undefined) {
        return [];
      }
      const items = (state.itemIdsByTurnId[turnId] ?? []).flatMap((itemId) => {
        const item = readTaskItem(state, itemId);
        return item === undefined ? [] : [item];
      });
      return [{ ...turn, items }];
    }),
  };
}

function retainSnapshotTurnItems(currentTurn: AgentTurn, snapshotTurn: AgentTurn): AgentItem[] {
  const snapshotItemsById = new Map(snapshotTurn.items.map((item) => [item.id, item]));
  const submittedUserItemId = `submitted-user-${snapshotTurn.id}`;
  const snapshotUserItem = snapshotTurn.items.find(
    (item) => item.type === "message" && item.role === "user",
  );
  const retainedItems = currentTurn.items.map((currentItem) => {
    if (currentItem.id === submittedUserItemId && snapshotUserItem !== undefined) {
      snapshotItemsById.delete(snapshotUserItem.id);
      return snapshotUserItem;
    }
    const snapshotItem = snapshotItemsById.get(currentItem.id);
    if (snapshotItem === undefined) {
      return currentItem;
    }
    snapshotItemsById.delete(currentItem.id);
    return snapshotItem;
  });

  // Snapshot 可能只包含持久化摘要；保留同一 Turn 已接收的操作，并追加 Snapshot 新增实体。
  return [...retainedItems, ...snapshotItemsById.values()];
}

function reconcileSnapshot(
  state: TaskStoreState,
  response: TaskStoreHydrationResponse,
): TaskStoreHydrationResponse {
  const currentSnapshot = reconstructSnapshot(state);
  if (currentSnapshot === undefined) {
    return response;
  }
  const currentTurnsById = new Map(currentSnapshot.turns.map((turn) => [turn.id, turn]));
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      // Snapshot 缺失整个 Turn 表示权威历史已移除；只在仍存在的 Turn 内做非破坏性 Item 合并。
      turns: response.snapshot.turns.map((snapshotTurn) => {
        const currentTurn = currentTurnsById.get(snapshotTurn.id);
        return currentTurn === undefined
          ? snapshotTurn
          : {
              ...snapshotTurn,
              items: retainSnapshotTurnItems(currentTurn, snapshotTurn),
            };
      }),
    },
  };
}

export function createTaskStore(
  identity: TaskStoreIdentity,
  initialResponse?: TaskStoreHydrationResponse,
): TaskStore {
  const initialData =
    initialResponse === undefined
      ? {
          checkpoint: null,
          commandOutputAccessByItemId: new Map<string, number>(),
          commandOutputAccessSequence: 0,
          commandOutputBytesByItemId: new Map<string, number>(),
          commandOutputBytes: 0,
          itemIdsByTurnId: {},
          itemStoresById: new Map<string, TaskItemStore>(),
          itemStructureRevision: 0,
          itemTurnIdsById: {},
          pendingRequestIds: [],
          pendingRequestsById: {},
          snapshotMetadata: null,
          turnIds: [],
          turnsById: {},
        }
      : normalizeSnapshot(initialResponse);

  if (
    initialResponse !== undefined &&
    (initialResponse.snapshot.projectId !== identity.projectId ||
      initialResponse.snapshot.id !== identity.taskId)
  ) {
    throw new Error("Task store identity does not match the initial snapshot");
  }

  return createStore<TaskStoreState>()((set, get) => ({
    ...initialData,
    applyEvents(events) {
      if (events.length === 0) {
        return;
      }
      const changedItemStores = new Set<TaskItemStore>();
      set((currentState) => {
        let nextState = currentState;
        for (const event of events) {
          const checkpoint = nextState.checkpoint;
          const hasValidSequence =
            checkpoint !== null &&
            event.sessionId === checkpoint.sessionId &&
            event.sequence > checkpoint.sequence;
          // Task、Session 与 Sequence 共同约束事件身份和顺序。
          if (event.taskId !== nextState.taskId || !hasValidSequence) {
            continue;
          }
          const previousState = nextState;
          nextState = {
            ...nextState,
            ...applyAcceptedEvent(nextState, event, changedItemStores),
          };
          const touchedCommandOutputItemIds = getTouchedCommandOutputItemIds(
            previousState,
            nextState,
            event,
          );
          if (touchedCommandOutputItemIds !== undefined) {
            nextState = {
              ...nextState,
              ...updateCommandOutputBudget({
                previousBudget: previousState,
                changedItemStores,
                sourceItemStoresById: nextState.itemStoresById,
                touchedItemIds: touchedCommandOutputItemIds,
              }),
            };
          }
        }
        return nextState;
      });
      // 同一动画帧内的多个 Delta 合并为一次目标 Item 通知，避免重复渲染。
      for (const itemStore of changedItemStores) {
        itemStore.publish();
      }
    },
    connectionState: "connecting",
    error: null,
    hydrate(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set({ ...normalizeSnapshot(response), connectionState: "connecting", error: null });
    },
    projectId: identity.projectId,
    reconcile(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => ({
        ...normalizeSnapshot(reconcileSnapshot(state, response)),
        connectionState: "connecting",
        error: null,
      }));
    },
    getItem: (itemId) => get().itemStoresById.get(itemId)?.read(),
    reconstructSnapshot: () => reconstructSnapshot(get()),
    setConnectionState(connectionState) {
      set({ connectionState });
    },
    setError(error) {
      set({ error });
    },
    taskId: identity.taskId,
  }));
}

interface TaskStoreRegistryEntry {
  consumers: number;
  identity: TaskStoreIdentity;
  lastAccess: number;
  store: TaskStore;
}

export interface TaskStoreRegistryOptions {
  createStore?: (identity: TaskStoreIdentity) => TaskStore;
  maxRetainedBytes?: number;
  maxRetainedStores?: number;
  onEvict?: (identity: TaskStoreIdentity, store: TaskStore) => void;
}

export class TaskStoreRegistry {
  readonly #createStore: (identity: TaskStoreIdentity) => TaskStore;
  readonly #entries = new Map<string, TaskStoreRegistryEntry>();
  readonly #maxRetainedBytes: number;
  readonly #maxRetainedStores: number;
  readonly #onEvict: TaskStoreRegistryOptions["onEvict"];
  #accessSequence = 0;

  public constructor(options: TaskStoreRegistryOptions = {}) {
    this.#maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_TASK_RUNTIME_BYTES;
    if (!Number.isSafeInteger(this.#maxRetainedBytes) || this.#maxRetainedBytes < 0) {
      throw new RangeError("Task store registry maxRetainedBytes must be non-negative");
    }
    this.#maxRetainedStores = options.maxRetainedStores ?? 20;
    if (!Number.isInteger(this.#maxRetainedStores) || this.#maxRetainedStores < 0) {
      throw new RangeError("Task store registry maxRetainedStores must be a non-negative integer");
    }
    this.#createStore = options.createStore ?? ((identity) => createTaskStore(identity));
    this.#onEvict = options.onEvict;
  }

  public acquire(projectId: string, taskId: string): TaskStore {
    const registryKey = createRegistryKey(projectId, taskId);
    let entry = this.#entries.get(registryKey);
    if (entry === undefined) {
      entry = {
        consumers: 0,
        identity: { projectId, taskId },
        lastAccess: 0,
        store: this.#createStore({ projectId, taskId }),
      };
      this.#entries.set(registryKey, entry);
    }
    entry.consumers += 1;
    entry.lastAccess = ++this.#accessSequence;
    this.#evictIfNeeded();
    return entry.store;
  }

  public release(projectId: string, taskId: string): boolean {
    const entry = this.#entries.get(createRegistryKey(projectId, taskId));
    if (entry === undefined || entry.consumers === 0) {
      return false;
    }
    entry.consumers -= 1;
    entry.lastAccess = ++this.#accessSequence;
    this.#evictIfNeeded();
    return entry.consumers === 0;
  }

  public get size(): number {
    return this.#entries.size;
  }

  public peek(projectId: string, taskId: string): TaskStore | undefined {
    return this.#entries.get(createRegistryKey(projectId, taskId))?.store;
  }

  public remove(projectId: string, taskId: string): boolean {
    const registryKey = createRegistryKey(projectId, taskId);
    const entry = this.#entries.get(registryKey);
    if (entry === undefined || entry.consumers > 0) {
      return false;
    }
    this.#entries.delete(registryKey);
    this.#onEvict?.(entry.identity, entry.store);
    return true;
  }

  #evictIfNeeded(): void {
    const evictionCandidates = [...this.#entries]
      .filter((candidate) => canEvictEntry(candidate[1]))
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
    let retainedBytes = evictionCandidates.reduce(
      (totalBytes, candidate) => totalBytes + estimateTaskStoreRetainedBytes(candidate[1].store),
      0,
    );
    let retainedStores = evictionCandidates.length;
    for (const [registryKey, entry] of evictionCandidates) {
      if (retainedStores <= this.#maxRetainedStores && retainedBytes <= this.#maxRetainedBytes) {
        break;
      }
      // 容量只约束安全静止的未选中 Store，活动 Store 不挤占 LRU 配额。
      const entryBytes = estimateTaskStoreRetainedBytes(entry.store);
      this.#entries.delete(registryKey);
      retainedBytes -= entryBytes;
      retainedStores -= 1;
      this.#onEvict?.(entry.identity, entry.store);
    }
  }
}

export function estimateTaskStoreRetainedBytes(store: TaskStore): number {
  const state = store.getState();
  return estimateRetainedBytes({
    checkpoint: state.checkpoint,
    commandOutputAccessByItemId: [...state.commandOutputAccessByItemId],
    commandOutputBytesByItemId: [...state.commandOutputBytesByItemId],
    itemIdsByTurnId: state.itemIdsByTurnId,
    itemTurnIdsById: state.itemTurnIdsById,
    items: [...state.itemStoresById.values()].map((itemStore) => itemStore.read()),
    pendingRequestIds: state.pendingRequestIds,
    pendingRequestsById: state.pendingRequestsById,
    snapshotMetadata: state.snapshotMetadata,
    turnIds: state.turnIds,
    turnsById: state.turnsById,
  });
}

function createRegistryKey(projectId: string, taskId: string): string {
  return JSON.stringify([projectId, taskId]);
}

function canEvictEntry(entry: TaskStoreRegistryEntry): boolean {
  // 最后一个消费者释放时传输已关闭；后续重开会以权威 Snapshot 重新校准。
  return entry.consumers === 0;
}

export function createTaskStoreRegistry(options: TaskStoreRegistryOptions = {}): TaskStoreRegistry {
  return new TaskStoreRegistry(options);
}
