import { createStore } from "zustand/vanilla";

import {
  createTaskItemStore,
  normalizeSnapshot,
  updateCommandOutputBudget,
  type TaskItemStore,
  type TaskStore,
  type TaskStoreHydrationResponse,
  type TaskStoreIdentity,
  type TaskStoreState,
} from "./task-store-core.js";

import { applyAcceptedEvent, getTouchedCommandOutputItemIds } from "./task-store-events.js";
import { TaskStoreRetainedBytesTracker } from "./task-store-retained-bytes.js";
import { reconcileSnapshot, reconstructSnapshot } from "./task-store-snapshot.js";

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
          notices: [],
          pendingRequestIds: [],
          pendingRequestsById: {},
          snapshotMetadata: null,
          turnIds: [],
          turnDiffsById: {},
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

  const retainedBytesTracker = new TaskStoreRetainedBytesTracker(initialData);

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
        if (nextState === currentState) {
          return currentState;
        }
        return {
          ...nextState,
          estimatedRetainedBytes: retainedBytesTracker.update(
            currentState,
            nextState,
            changedItemStores,
          ),
        };
      });
      // 同一动画帧内的多个 Delta 合并为一次目标 Item 通知，避免重复渲染。
      for (const itemStore of changedItemStores) {
        itemStore.publish();
      }
    },
    connectionState: "connecting",
    error: null,
    estimatedRetainedBytes: retainedBytesTracker.retainedBytes,
    hydrate(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => {
        const normalizedData = normalizeSnapshot(response);
        return {
          ...normalizedData,
          // Snapshot 替换会重建 Turn 与 Item 容器，必须推进修订号以失效兼容快照 memo。
          itemStructureRevision: state.itemStructureRevision + 1,
          connectionState: "connecting",
          error: null,
          estimatedRetainedBytes: retainedBytesTracker.replace(normalizedData),
        };
      });
    },
    prependTurns(cursor, page) {
      if (page.nextCursor === cursor) {
        throw new Error("Task turn page returned a repeated cursor");
      }
      const changedItemStores = new Set<TaskItemStore>();
      set((state) => {
        if (state.snapshotMetadata?.turnsNextCursor !== cursor) {
          return state;
        }
        const turnsById = { ...state.turnsById };
        const itemIdsByTurnId = { ...state.itemIdsByTurnId };
        const itemTurnIdsById = { ...state.itemTurnIdsById };
        const itemStoresById = new Map(state.itemStoresById);
        const prependedTurnIds: string[] = [];
        const touchedItemIds: string[] = [];

        for (const turn of page.data) {
          // Cursor 页可能与实时边界重叠；已存在的 Turn 保留当前权威状态。
          if (turnsById[turn.id] !== undefined) {
            continue;
          }
          const { items, ...normalizedTurn } = turn;
          const itemIds = items.map((item) => item.id);
          for (const item of items) {
            const existingTurnId = itemTurnIdsById[item.id];
            if (existingTurnId !== undefined) {
              throw new Error(`Agent item ${item.id} is shared by multiple turns`);
            }
            const itemStore = createTaskItemStore(item);
            itemTurnIdsById[item.id] = turn.id;
            itemStoresById.set(item.id, itemStore);
            changedItemStores.add(itemStore);
            touchedItemIds.push(item.id);
          }
          prependedTurnIds.push(turn.id);
          turnsById[turn.id] = normalizedTurn;
          itemIdsByTurnId[turn.id] = itemIds;
        }

        const boundedCommandOutputs = updateCommandOutputBudget({
          previousBudget: {
            ...state,
            commandOutputAccessByItemId: new Map(state.commandOutputAccessByItemId),
            commandOutputBytesByItemId: new Map(state.commandOutputBytesByItemId),
          },
          changedItemStores,
          sourceItemStoresById: itemStoresById,
          touchedItemIds,
        });
        const nextState = {
          ...state,
          ...boundedCommandOutputs,
          itemIdsByTurnId,
          itemStoresById,
          itemStructureRevision:
            state.itemStructureRevision + (prependedTurnIds.length === 0 ? 0 : 1),
          itemTurnIdsById,
          snapshotMetadata: {
            ...state.snapshotMetadata,
            turnsNextCursor: page.nextCursor,
          },
          turnIds: [...prependedTurnIds, ...state.turnIds],
          turnsById,
        };
        return {
          ...nextState,
          estimatedRetainedBytes: retainedBytesTracker.update(state, nextState, changedItemStores),
        };
      });
    },
    projectId: identity.projectId,
    reconcile(response) {
      if (
        response.snapshot.projectId !== identity.projectId ||
        response.snapshot.id !== identity.taskId
      ) {
        throw new Error("Task store identity does not match the snapshot");
      }
      set((state) => {
        const normalizedData = normalizeSnapshot(reconcileSnapshot(state, response));
        return {
          ...normalizedData,
          // 即使 Task 元数据未变，缺失或新增 Turn 也必须通知快照消费者重新读取 Store。
          itemStructureRevision: state.itemStructureRevision + 1,
          connectionState: "connecting",
          error: null,
          estimatedRetainedBytes: retainedBytesTracker.replace(normalizedData),
        };
      });
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
