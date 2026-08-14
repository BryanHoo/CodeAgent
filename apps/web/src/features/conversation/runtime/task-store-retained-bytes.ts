import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";

import type { TaskItemStore, TaskStoreState } from "./task-store-core.js";

const ITEM_COLLECTION_BASE_BYTES = 32;
const ITEM_COLLECTION_SLOT_BYTES = 8;
const MAP_BASE_BYTES = 48;
const MAP_ENTRY_BYTES = 32;
const TASK_STORE_BASE_BYTES = 48;

const retainedFieldNames = [
  "checkpoint",
  "commandOutputAccessByItemId",
  "commandOutputBytesByItemId",
  "itemIdsByTurnId",
  "itemTurnIdsById",
  "notices",
  "pendingRequestIds",
  "pendingRequestsById",
  "snapshotMetadata",
  "turnIds",
  "turnDiffsById",
  "turnsById",
] as const;

type RetainedFieldName = (typeof retainedFieldNames)[number];
type RetainedTaskData = Pick<
  TaskStoreState,
  RetainedFieldName | "commandOutputAccessSequence" | "itemStoresById" | "itemStructureRevision"
>;

function estimateMapRetainedBytes(value: ReadonlyMap<unknown, unknown>): number {
  let retainedBytes = MAP_BASE_BYTES;
  for (const [key, entryValue] of value) {
    retainedBytes +=
      MAP_ENTRY_BYTES + estimateRetainedBytes(key) + estimateRetainedBytes(entryValue);
  }
  return retainedBytes;
}

function estimateFieldRetainedBytes(value: unknown): number {
  return value instanceof Map ? estimateMapRetainedBytes(value) : estimateRetainedBytes(value);
}

export class TaskStoreRetainedBytesTracker {
  readonly #fieldBytes = new Map<RetainedFieldName, number>();
  readonly #itemBytesByStore = new Map<TaskItemStore, number>();
  #itemBytes = 0;
  #retainedBytes = TASK_STORE_BASE_BYTES;

  public constructor(data: RetainedTaskData) {
    this.replace(data);
  }

  public get retainedBytes(): number {
    return this.#retainedBytes;
  }

  public replace(data: RetainedTaskData): number {
    this.#fieldBytes.clear();
    this.#itemBytes = 0;
    this.#retainedBytes = TASK_STORE_BASE_BYTES;
    for (const fieldName of retainedFieldNames) {
      const fieldBytes = estimateFieldRetainedBytes(data[fieldName]);
      this.#fieldBytes.set(fieldName, fieldBytes);
      this.#retainedBytes += fieldBytes;
    }
    this.#replaceItems(data.itemStoresById);
    return this.#retainedBytes;
  }

  public update(
    previousData: RetainedTaskData,
    nextData: RetainedTaskData,
    changedItemStores: ReadonlySet<TaskItemStore>,
  ): number {
    const structureChanged = previousData.itemStructureRevision !== nextData.itemStructureRevision;
    const commandBudgetChanged =
      previousData.commandOutputAccessSequence !== nextData.commandOutputAccessSequence;

    for (const fieldName of retainedFieldNames) {
      const forceUpdate =
        (structureChanged &&
          (fieldName === "itemIdsByTurnId" || fieldName === "itemTurnIdsById")) ||
        (commandBudgetChanged &&
          (fieldName === "commandOutputAccessByItemId" ||
            fieldName === "commandOutputBytesByItemId"));
      if (!forceUpdate && previousData[fieldName] === nextData[fieldName]) {
        continue;
      }
      this.#updateField(fieldName, nextData[fieldName]);
    }

    for (const itemStore of changedItemStores) {
      const previousBytes = this.#itemBytesByStore.get(itemStore);
      const nextBytes = itemStore.getEstimatedRetainedBytes();
      if (previousBytes === undefined) {
        this.#itemBytes += ITEM_COLLECTION_SLOT_BYTES + nextBytes;
        this.#retainedBytes += ITEM_COLLECTION_SLOT_BYTES + nextBytes;
      } else {
        this.#itemBytes += nextBytes - previousBytes;
        this.#retainedBytes += nextBytes - previousBytes;
      }
      this.#itemBytesByStore.set(itemStore, nextBytes);
    }
    if (this.#itemBytesByStore.size !== nextData.itemStoresById.size) {
      // 删除或同量替换 Item 时重建轻量索引，不读取或复制 Item Payload。
      this.#replaceItems(nextData.itemStoresById);
    }
    return this.#retainedBytes;
  }

  #replaceItems(itemStoresById: ReadonlyMap<string, TaskItemStore>): void {
    let itemBytes = ITEM_COLLECTION_BASE_BYTES + itemStoresById.size * ITEM_COLLECTION_SLOT_BYTES;
    this.#itemBytesByStore.clear();
    for (const itemStore of itemStoresById.values()) {
      const retainedBytes = itemStore.getEstimatedRetainedBytes();
      this.#itemBytesByStore.set(itemStore, retainedBytes);
      itemBytes += retainedBytes;
    }

    this.#retainedBytes += itemBytes - this.#itemBytes;
    this.#itemBytes = itemBytes;
  }

  #updateField(fieldName: RetainedFieldName, value: unknown): void {
    const previousBytes = this.#fieldBytes.get(fieldName) ?? 0;
    const nextBytes = estimateFieldRetainedBytes(value);
    this.#fieldBytes.set(fieldName, nextBytes);
    this.#retainedBytes += nextBytes - previousBytes;
  }
}
