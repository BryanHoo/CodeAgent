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

import { estimateRetainedBytes, getUtf8ByteLength } from "../../../shared/memory/byte-lru.js";

const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES = 10_000;
export const MAX_TASK_COMMAND_OUTPUT_BYTES = 8 * 1_048_576;
export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
const RETAINED_COMMAND_OUTPUT_MARKER = "[较早的命令输出已按内存预算清理]";

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
  commandOutputAccessByItemId: Readonly<Record<string, number>>;
  commandOutputAccessSequence: number;
  commandOutputBytes: number;
  connectionState: AgentEventConnectionState;
  error: Error | null;
  hydrate: (response: TaskStoreHydrationResponse) => void;
  itemIdsByTurnId: Readonly<Record<string, readonly string[]>>;
  itemStructureRevision: number;
  itemTurnIdsById: Readonly<Record<string, string>>;
  itemsById: Readonly<Record<string, AgentItem>>;
  pendingRequestIds: readonly string[];
  pendingRequestsById: Readonly<Record<string, PendingRequest>>;
  projectId: string;
  reconstructSnapshot: () => ReconstructedTaskSnapshot | undefined;
  setConnectionState: (connectionState: AgentEventConnectionState) => void;
  setError: (error: Error | null) => void;
  snapshotMetadata: TaskSnapshotMetadata | null;
  taskId: string;
  turnIds: readonly string[];
  turnsById: Readonly<Record<string, NormalizedAgentTurn>>;
}

export type TaskStore = StoreApi<TaskStoreState>;

type NormalizedTaskData = Pick<
  TaskStoreState,
  | "checkpoint"
  | "commandOutputAccessByItemId"
  | "commandOutputAccessSequence"
  | "commandOutputBytes"
  | "itemIdsByTurnId"
  | "itemStructureRevision"
  | "itemTurnIdsById"
  | "itemsById"
  | "pendingRequestIds"
  | "pendingRequestsById"
  | "snapshotMetadata"
  | "turnIds"
  | "turnsById"
>;

function normalizeSnapshot(response: TaskStoreHydrationResponse): NormalizedTaskData {
  const { pendingRequests, turns, ...snapshotMetadata } = response.snapshot;
  const turnIds: string[] = [];
  const turnsById: Record<string, NormalizedAgentTurn> = {};
  const itemIdsByTurnId: Record<string, readonly string[]> = {};
  const itemTurnIdsById: Record<string, string> = {};
  const itemsById: Record<string, AgentItem> = {};

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
      itemsById[item.id] = item;
    }
  }

  const pendingRequestIds = pendingRequests.map((request) => request.requestId);
  const pendingRequestsById = Object.fromEntries(
    pendingRequests.map((request) => [request.requestId, request]),
  );

  const boundedCommandOutputs = enforceCommandOutputBudget(
    itemsById,
    {},
    0,
    Object.keys(itemsById),
  );

  return {
    checkpoint: response.checkpoint,
    ...boundedCommandOutputs,
    itemIdsByTurnId,
    itemStructureRevision: 0,
    itemTurnIdsById,
    pendingRequestIds,
    pendingRequestsById,
    snapshotMetadata,
    turnIds,
    turnsById,
  };
}

function sliceUtf8Tail(value: string, maxBytes: number): string {
  const encodedValue = new TextEncoder().encode(value);
  let startIndex = Math.max(0, encodedValue.length - maxBytes);

  // 跳过 UTF-8 续字节，避免截断后产生乱码。
  while (startIndex < encodedValue.length) {
    const currentByte = encodedValue[startIndex];
    if (currentByte === undefined || (currentByte & 0xc0) !== 0x80) {
      break;
    }
    startIndex += 1;
  }
  return new TextDecoder().decode(encodedValue.subarray(startIndex));
}

function boundCommandOutput(value: string): Readonly<{
  output: string;
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

  if (new TextEncoder().encode(output).byteLength > MAX_COMMAND_OUTPUT_BYTES) {
    output = sliceUtf8Tail(output, MAX_COMMAND_OUTPUT_BYTES);
    outputTruncated = true;
  }
  return { output, outputTruncated };
}

type CommandOutputBudgetState = Pick<
  TaskStoreState,
  "commandOutputAccessByItemId" | "commandOutputAccessSequence" | "commandOutputBytes" | "itemsById"
>;

function enforceCommandOutputBudget(
  sourceItemsById: Readonly<Record<string, AgentItem>>,
  previousAccessByItemId: Readonly<Record<string, number>>,
  previousAccessSequence: number,
  touchedItemIds: readonly string[],
): CommandOutputBudgetState {
  const touchedItemIdSet = new Set(touchedItemIds);
  const commandOutputAccessByItemId: Record<string, number> = {};
  let commandOutputAccessSequence = previousAccessSequence;
  let commandOutputBytes = 0;
  let itemsById = sourceItemsById;
  const commandItemIds: string[] = [];

  for (const [itemId, item] of Object.entries(sourceItemsById)) {
    if (item.type !== "command" || item.output === undefined) {
      continue;
    }
    const boundedOutput = boundCommandOutput(item.output);
    if (
      boundedOutput.output !== item.output ||
      (boundedOutput.outputTruncated && !item.outputTruncated)
    ) {
      itemsById = {
        ...itemsById,
        [itemId]: {
          ...item,
          output: boundedOutput.output,
          outputTruncated: item.outputTruncated || boundedOutput.outputTruncated,
        },
      };
    }
    const previousAccess = previousAccessByItemId[itemId];
    if (touchedItemIdSet.has(itemId) || previousAccess === undefined) {
      commandOutputAccessSequence += 1;
      commandOutputAccessByItemId[itemId] = commandOutputAccessSequence;
    } else {
      commandOutputAccessByItemId[itemId] = previousAccess;
    }
    commandOutputBytes += getUtf8ByteLength(boundedOutput.output);
    commandItemIds.push(itemId);
  }

  const leastRecentlyUsedItemIds = commandItemIds.toSorted(
    (leftItemId, rightItemId) =>
      (commandOutputAccessByItemId[leftItemId] ?? 0) -
      (commandOutputAccessByItemId[rightItemId] ?? 0),
  );
  for (const itemId of leastRecentlyUsedItemIds) {
    if (commandOutputBytes <= MAX_TASK_COMMAND_OUTPUT_BYTES) {
      break;
    }
    const item = itemsById[itemId];
    if (item?.type !== "command" || item.output === undefined) {
      continue;
    }
    const previousOutputBytes = getUtf8ByteLength(item.output);
    const retainedMarkerBytes = getUtf8ByteLength(RETAINED_COMMAND_OUTPUT_MARKER);
    itemsById = {
      ...itemsById,
      [itemId]: {
        ...item,
        output: RETAINED_COMMAND_OUTPUT_MARKER,
        outputTruncated: true,
      },
    };
    commandOutputBytes -= previousOutputBytes - retainedMarkerBytes;
  }

  return {
    commandOutputAccessByItemId,
    commandOutputAccessSequence,
    commandOutputBytes,
    itemsById,
  };
}

function getTouchedCommandOutputItemIds(event: AgentEvent): readonly string[] | undefined {
  if (event.type === "command.output_delta") {
    return [event.itemId];
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    return event.payload.item.type === "command" ? [event.itemId] : undefined;
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    // Turn 终态会整体替换 Item，即使没有 Command 也需要清除旧访问记录。
    return event.payload.turn.items
      .filter((item) => item.type === "command")
      .map((item) => item.id);
  }
  return undefined;
}

function createDeltaItem(event: Extract<AgentEvent, { itemId: string }>): AgentItem | undefined {
  switch (event.type) {
    case "message.delta":
      return {
        id: event.itemId,
        role: "assistant",
        text: event.payload.delta,
        type: "message",
      };
    case "reasoning.delta":
      return {
        content: event.payload.field === "content" ? event.payload.delta : "",
        id: event.itemId,
        summary: event.payload.field === "summary" ? event.payload.delta : "",
        type: "reasoning",
      };
    case "command.output_delta": {
      const boundedOutput = boundCommandOutput(event.payload.delta);
      return {
        command: "正在执行命令",
        cwd: "",
        id: event.itemId,
        output: boundedOutput.output,
        outputTruncated: boundedOutput.outputTruncated,
        status: "running",
        type: "command",
      };
    }
    default:
      return undefined;
  }
}

function updateDeltaItem(currentItem: AgentItem, event: AgentEvent): AgentItem {
  if (event.type === "message.delta") {
    return currentItem.type === "message" && currentItem.role === "assistant"
      ? { ...currentItem, text: `${currentItem.text}${event.payload.delta}` }
      : currentItem;
  }
  if (event.type === "reasoning.delta") {
    return currentItem.type === "reasoning"
      ? {
          ...currentItem,
          [event.payload.field]: `${currentItem[event.payload.field]}${event.payload.delta}`,
        }
      : currentItem;
  }
  if (event.type === "command.output_delta" && currentItem.type === "command") {
    const boundedOutput = boundCommandOutput(`${currentItem.output ?? ""}${event.payload.delta}`);
    return {
      ...currentItem,
      output: boundedOutput.output,
      outputTruncated: currentItem.outputTruncated || boundedOutput.outputTruncated,
    };
  }
  return currentItem;
}

function replaceTurnItems(
  state: TaskStoreState,
  turnId: string,
  items: readonly AgentItem[],
): Pick<TaskStoreState, "itemIdsByTurnId" | "itemTurnIdsById" | "itemsById"> {
  const previousItemIds = state.itemIdsByTurnId[turnId] ?? [];
  const replacedItemIds = new Set(previousItemIds);
  const itemsById: Record<string, AgentItem> = {};
  const itemTurnIdsById: Record<string, string> = {};
  for (const [itemId, item] of Object.entries(state.itemsById)) {
    if (!replacedItemIds.has(itemId)) {
      itemsById[itemId] = item;
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
    itemsById[item.id] = item;
    itemTurnIdsById[item.id] = turnId;
  }
  return {
    itemIdsByTurnId: {
      ...state.itemIdsByTurnId,
      [turnId]: items.map((item) => item.id),
    },
    itemTurnIdsById,
    itemsById,
  };
}

function mergeInterruptedTurnItems(
  state: TaskStoreState,
  turnId: string,
  terminalItems: readonly AgentItem[],
): readonly AgentItem[] {
  const terminalItemsById = new Map(terminalItems.map((item) => [item.id, item]));
  const mergedItems = (state.itemIdsByTurnId[turnId] ?? []).flatMap((itemId) => {
    const terminalItem = terminalItemsById.get(itemId);
    if (terminalItem !== undefined) {
      terminalItemsById.delete(itemId);
      return [terminalItem];
    }
    const streamedItem = state.itemsById[itemId];
    return streamedItem === undefined ? [] : [streamedItem];
  });

  // 中断终态可能只携带部分 Item；终态覆盖同 ID 实体，同时保留已展示的流式内容。
  return [...mergedItems, ...terminalItemsById.values()];
}

function applyAcceptedEvent(state: TaskStoreState, event: AgentEvent): Partial<TaskStoreState> {
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
        ...replaceTurnItems(state, event.turnId, items),
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
      const currentItem = state.itemsById[event.itemId];
      if (currentItem !== undefined && state.itemTurnIdsById[event.itemId] !== event.turnId) {
        throw new Error(`Agent item ${event.itemId} belongs to another turn`);
      }
      if (currentItem !== undefined) {
        const updatedItem = updateDeltaItem(currentItem, event);
        return {
          checkpoint,
          itemsById:
            updatedItem === currentItem
              ? state.itemsById
              : { ...state.itemsById, [event.itemId]: updatedItem },
          snapshotMetadata: { ...snapshotMetadata, updatedAt: event.timestamp },
          turnsById,
        };
      }
      const createdItem = createDeltaItem(event);
      if (createdItem === undefined) {
        return { checkpoint };
      }
      return {
        checkpoint,
        itemIdsByTurnId: {
          ...state.itemIdsByTurnId,
          [event.turnId]: [...(state.itemIdsByTurnId[event.turnId] ?? []), event.itemId],
        },
        itemStructureRevision: state.itemStructureRevision + 1,
        itemTurnIdsById: { ...state.itemTurnIdsById, [event.itemId]: event.turnId },
        itemsById: { ...state.itemsById, [event.itemId]: createdItem },
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
      const itemAlreadyExists = state.itemsById[event.itemId] !== undefined;
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
      const retainedItems = replacesSubmittedUserItem
        ? Object.fromEntries(
            Object.entries(state.itemsById).filter(([itemId]) => itemId !== submittedUserItemId),
          )
        : state.itemsById;
      const retainedItemTurnIds = replacesSubmittedUserItem
        ? Object.fromEntries(
            Object.entries(state.itemTurnIdsById).filter(
              ([itemId]) => itemId !== submittedUserItemId,
            ),
          )
        : state.itemTurnIdsById;
      const itemsById = { ...retainedItems, [event.itemId]: event.payload.item };
      return {
        checkpoint,
        itemIdsByTurnId:
          nextItemIds === currentItemIds
            ? state.itemIdsByTurnId
            : { ...state.itemIdsByTurnId, [event.turnId]: nextItemIds },
        itemStructureRevision: state.itemStructureRevision + 1,
        itemTurnIdsById: { ...retainedItemTurnIds, [event.itemId]: event.turnId },
        itemsById,
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
      const items =
        completedTurn.status === "interrupted"
          ? mergeInterruptedTurnItems(state, event.turnId, terminalItems)
          : terminalItems;
      return {
        checkpoint,
        ...(currentTurn === undefined ? {} : replaceTurnItems(state, event.turnId, items)),
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
      const requestAlreadyExists = state.pendingRequestsById[request.requestId] !== undefined;
      return {
        checkpoint,
        pendingRequestIds: requestAlreadyExists
          ? state.pendingRequestIds
          : [...state.pendingRequestIds, request.requestId],
        pendingRequestsById: {
          ...state.pendingRequestsById,
          [request.requestId]: request,
        },
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
      return request === undefined ? [] : [request];
    }),
    turns: state.turnIds.flatMap((turnId) => {
      const turn = state.turnsById[turnId];
      if (turn === undefined) {
        return [];
      }
      const items = (state.itemIdsByTurnId[turnId] ?? []).flatMap((itemId) => {
        const item = state.itemsById[itemId];
        return item === undefined ? [] : [item];
      });
      return [{ ...turn, items }];
    }),
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
          commandOutputAccessByItemId: {},
          commandOutputAccessSequence: 0,
          commandOutputBytes: 0,
          itemIdsByTurnId: {},
          itemStructureRevision: 0,
          itemTurnIdsById: {},
          itemsById: {},
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
          nextState = { ...nextState, ...applyAcceptedEvent(nextState, event) };
          const touchedCommandOutputItemIds = getTouchedCommandOutputItemIds(event);
          if (touchedCommandOutputItemIds !== undefined) {
            nextState = {
              ...nextState,
              ...enforceCommandOutputBudget(
                nextState.itemsById,
                nextState.commandOutputAccessByItemId,
                nextState.commandOutputAccessSequence,
                touchedCommandOutputItemIds,
              ),
            };
          }
        }
        return nextState;
      });
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
    commandOutputAccessByItemId: state.commandOutputAccessByItemId,
    itemIdsByTurnId: state.itemIdsByTurnId,
    itemTurnIdsById: state.itemTurnIdsById,
    itemsById: state.itemsById,
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
