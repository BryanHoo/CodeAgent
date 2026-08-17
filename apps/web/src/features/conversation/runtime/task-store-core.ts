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

import { CommandOutputBuffer, type CommandOutputView } from "./command-output-buffer.js";

export const MAX_TASK_COMMAND_OUTPUT_BYTES = 8 * 1_048_576;
export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
export const MAX_RETAINED_TERMINAL_REQUESTS = 20;
export const MAX_RETAINED_TASK_NOTICES = 20;
export const PENDING_COMMAND_LABEL = "__CODE_AGENT_PENDING_COMMAND__";
export const RETAINED_COMMAND_OUTPUT_MARKER = "__CODE_AGENT_RETAINED_COMMAND_OUTPUT__";
const textEncoder = new TextEncoder();
const retainedCommandOutputMarkerBytes = textEncoder.encode(
  RETAINED_COMMAND_OUTPUT_MARKER,
).byteLength;

export type NormalizedAgentTurn = Omit<AgentTurn, "items">;
export type TaskNotice = Extract<AgentEvent, { type: "task.notice" }>;
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
  notices: readonly TaskNotice[];
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
  turnDiffsById: Readonly<Record<string, string>>;
}

export type TaskStore = StoreApi<TaskStoreState>;

export interface TaskItemStoreState {
  revision: number;
}

type DeltaEvent = Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
>;

export interface TaskItemStore extends StoreApi<TaskItemStoreState> {
  appendDelta: (event: DeltaEvent) => boolean;
  peek: () => AgentItem;
  publish: () => void;
  read: () => AgentItem;
  readCommandOutput: () => CommandOutputView | undefined;
  replace: (item: AgentItem) => void;
}

type StreamedTextField = "content" | "plan" | "summary" | "text";

function createBaseItem(item: AgentItem): AgentItem {
  if (item.type !== "command" || item.output === RETAINED_COMMAND_OUTPUT_MARKER) {
    return item;
  }
  const baseCommand = { ...item };
  delete baseCommand.output;
  return baseCommand;
}

export function createTaskItemStore(initialItem: AgentItem): TaskItemStore {
  let baseItem = createBaseItem(initialItem);
  // Delta 热路径只追加 Chunk；完整字符串仅在目标 Item 被读取时延迟物化并缓存。
  const chunksByField = new Map<StreamedTextField, string[]>();
  let contentGeneration = 0;
  let materializedGeneration = initialItem.type === "command" ? -1 : 0;
  let materializedItem = baseItem;
  let summarySectionIndex: number | undefined;
  let commandOutputBuffer =
    initialItem.type === "command"
      ? new CommandOutputBuffer(initialItem.output, initialItem.outputTruncated)
      : undefined;
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
        if (event.payload.field === "summary" && event.payload.sectionIndex !== undefined) {
          const currentSummary = [baseItem.summary, ...(chunksByField.get("summary") ?? [])].join(
            "",
          );
          const startsNewSection =
            summarySectionIndex === undefined
              ? event.payload.sectionIndex > 0
              : event.payload.sectionIndex !== summarySectionIndex;
          if (startsNewSection && currentSummary.length > 0) {
            // Codex 只传分段索引；用空行保留摘要段落边界，避免不同主题粘连。
            appendChunk("summary", "\n\n");
          }
          summarySectionIndex = event.payload.sectionIndex;
        }
        appendChunk(event.payload.field, event.payload.delta);
        return true;
      }
      if (event.type === "plan.delta") {
        if (baseItem.type !== "plan") {
          return false;
        }
        appendChunk("plan", event.payload.delta);
        return true;
      }
      if (baseItem.type !== "command") {
        return false;
      }
      commandOutputBuffer?.append(event.payload.delta);
      contentGeneration += 1;
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
        const commandOutput = commandOutputBuffer?.getView();
        if (commandOutput !== undefined) {
          nextItem = {
            ...baseItem,
            ...(commandOutput.hasOutput ? { output: commandOutput.materialize() } : {}),
            outputTruncated: commandOutput.outputTruncated,
          };
        }
      } else if (baseItem.type === "plan") {
        const chunks = chunksByField.get("plan");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: [baseItem.text, ...chunks].join("") };
        }
      }
      materializedItem = nextItem;
      materializedGeneration = contentGeneration;
      return materializedItem;
    },
    readCommandOutput(): CommandOutputView | undefined {
      return commandOutputBuffer?.getView();
    },
    replace(item: AgentItem): void {
      baseItem = createBaseItem(item);
      chunksByField.clear();
      summarySectionIndex = undefined;
      commandOutputBuffer =
        item.type === "command"
          ? new CommandOutputBuffer(item.output, item.outputTruncated)
          : undefined;
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
  | "notices"
  | "pendingRequestIds"
  | "pendingRequestsById"
  | "snapshotMetadata"
  | "turnIds"
  | "turnDiffsById"
  | "turnsById"
>;

type PendingRequestState = Pick<TaskStoreState, "pendingRequestIds" | "pendingRequestsById">;

export function retainPendingRequest(
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

export function readTaskItem(state: TaskStoreState, itemId: string): AgentItem | undefined {
  return state.itemStoresById.get(itemId)?.read();
}

export function normalizeSnapshot(response: TaskStoreHydrationResponse): NormalizedTaskData {
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
    notices: [],
    ...pendingRequestState,
    snapshotMetadata,
    turnIds,
    turnDiffsById: {},
    turnsById,
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

export function updateCommandOutputBudget(
  input: CommandOutputBudgetInput,
): CommandOutputBudgetState {
  const commandOutputAccessByItemId = input.previousBudget.commandOutputAccessByItemId;
  const commandOutputBytesByItemId = input.previousBudget.commandOutputBytesByItemId;
  let commandOutputAccessSequence = input.previousBudget.commandOutputAccessSequence;
  let commandOutputBytes = input.previousBudget.commandOutputBytes;

  for (const itemId of new Set(input.touchedItemIds)) {
    const previousOutputBytes = commandOutputBytesByItemId.get(itemId) ?? 0;
    const itemStore = input.sourceItemStoresById.get(itemId);
    const commandOutput = itemStore?.readCommandOutput();
    if (!commandOutput?.hasOutput) {
      commandOutputAccessByItemId.delete(itemId);
      commandOutputBytesByItemId.delete(itemId);
      commandOutputBytes -= previousOutputBytes;
      continue;
    }

    commandOutputAccessSequence += 1;
    commandOutputAccessByItemId.set(itemId, commandOutputAccessSequence);
    commandOutputBytesByItemId.set(itemId, commandOutput.outputBytes);
    commandOutputBytes += commandOutput.outputBytes - previousOutputBytes;
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
    const item = itemStore?.peek();
    if (itemStore === undefined || item?.type !== "command") {
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
