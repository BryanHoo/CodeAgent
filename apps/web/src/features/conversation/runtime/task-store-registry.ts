import {
  MAX_RETAINED_TASK_RUNTIME_BYTES,
  type TaskStore,
  type TaskStoreIdentity,
} from "./task-store-core.js";

import { createTaskStore } from "./task-store-factory.js";

interface TaskStoreRegistryEntry {
  consumers: number;
  identity: TaskStoreIdentity;
  registryKey: string;
  retainedBytes: number;
  store: TaskStore;
  unsubscribe: () => void;
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
  readonly #inactiveEntries = new Map<string, TaskStoreRegistryEntry>();
  readonly #maxRetainedBytes: number;
  readonly #maxRetainedStores: number;
  readonly #onEvict: TaskStoreRegistryOptions["onEvict"];
  #retainedBytes = 0;

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
      const store = this.#createStore({ projectId, taskId });
      entry = {
        consumers: 0,
        identity: { projectId, taskId },
        registryKey,
        retainedBytes: store.getState().estimatedRetainedBytes,
        store,
        unsubscribe: () => undefined,
      };
      const subscribedEntry = entry;
      entry.unsubscribe = store.subscribe((state, previousState) => {
        if (state.estimatedRetainedBytes !== previousState.estimatedRetainedBytes) {
          this.#updateInactiveBytes(subscribedEntry, state.estimatedRetainedBytes);
        }
      });
      this.#entries.set(registryKey, entry);
    } else if (entry.consumers === 0) {
      this.#removeInactiveEntry(entry);
    }
    entry.consumers += 1;
    return entry.store;
  }

  public release(projectId: string, taskId: string): boolean {
    const entry = this.#entries.get(createRegistryKey(projectId, taskId));
    if (entry === undefined || entry.consumers === 0) {
      return false;
    }
    entry.consumers -= 1;
    if (entry.consumers === 0) {
      entry.retainedBytes = entry.store.getState().estimatedRetainedBytes;
      this.#inactiveEntries.set(entry.registryKey, entry);
      this.#retainedBytes += entry.retainedBytes;
      this.#evictIfNeeded();
    }
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
    this.#removeInactiveEntry(entry);
    this.#deleteEntry(entry);
    return true;
  }

  #evictIfNeeded(): void {
    while (
      this.#inactiveEntries.size > this.#maxRetainedStores ||
      this.#retainedBytes > this.#maxRetainedBytes
    ) {
      // Map 迭代首项即最久未访问的空闲 Store，无需构造候选数组或排序。
      const oldestEntry = this.#inactiveEntries.values().next().value;
      if (oldestEntry === undefined) {
        return;
      }
      this.#removeInactiveEntry(oldestEntry);
      this.#deleteEntry(oldestEntry);
    }
  }

  #deleteEntry(entry: TaskStoreRegistryEntry): void {
    this.#entries.delete(entry.registryKey);
    entry.unsubscribe();
    this.#onEvict?.(entry.identity, entry.store);
  }

  #removeInactiveEntry(entry: TaskStoreRegistryEntry): void {
    if (!this.#inactiveEntries.delete(entry.registryKey)) {
      return;
    }
    this.#retainedBytes -= entry.retainedBytes;
  }

  #updateInactiveBytes(entry: TaskStoreRegistryEntry, retainedBytes: number): void {
    if (entry.consumers > 0 || !this.#inactiveEntries.has(entry.registryKey)) {
      return;
    }
    this.#retainedBytes += retainedBytes - entry.retainedBytes;
    entry.retainedBytes = retainedBytes;
    this.#evictIfNeeded();
  }
}

export function estimateTaskStoreRetainedBytes(store: TaskStore): number {
  return store.getState().estimatedRetainedBytes;
}

function createRegistryKey(projectId: string, taskId: string): string {
  return JSON.stringify([projectId, taskId]);
}

export function createTaskStoreRegistry(options: TaskStoreRegistryOptions = {}): TaskStoreRegistry {
  return new TaskStoreRegistry(options);
}
