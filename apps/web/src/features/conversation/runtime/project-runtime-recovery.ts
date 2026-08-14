import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { showErrorToast } from "../../../shared/errors/error-toast.js";
import { AgentEventBuffer } from "./task-runtime.js";
import type { TaskStore } from "./task-store.js";

import type {
  RealtimePerformanceObserver,
  RecoverTaskSnapshot,
  TaskRecoveryState,
} from "./project-runtime-history.js";
import {
  SNAPSHOT_RECOVERY_RETRY_INITIAL_MS,
  SNAPSHOT_RECOVERY_RETRY_MAX_MS,
  isDeltaEvent,
} from "./project-runtime-history.js";

export class SnapshotRecoveryController<T> {
  readonly #onRecovered: (value: T) => void;
  readonly #onRecovering: () => void;
  readonly #recoverSnapshot: () => Promise<T | undefined>;
  #recoveryAttempt = 0;
  #recoveryGeneration = 0;
  #recoveryState: TaskRecoveryState = "ready";
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    recoverSnapshot: () => Promise<T | undefined>,
    onRecovered: (value: T) => void,
    onRecovering: () => void = () => undefined,
  ) {
    this.#recoverSnapshot = recoverSnapshot;
    this.#onRecovered = onRecovered;
    this.#onRecovering = onRecovering;
  }

  public get isReady(): boolean {
    return this.#recoveryState === "ready";
  }

  public dispose(): void {
    this.#recoveryState = "disposed";
    this.#recoveryGeneration += 1;
    this.#clearRetryTimer();
  }

  public requestRecovery(): void {
    if (this.#recoveryState !== "ready") {
      return;
    }
    this.#startRecoveryAttempt();
  }

  public reset(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#clearRetryTimer();
    this.#recoveryAttempt = 0;
    this.#recoveryGeneration += 1;
    this.#recoveryState = "ready";
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  #scheduleRecoveryRetry(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#recoveryState = "waiting_to_retry";
    const retryDelay = Math.min(
      SNAPSHOT_RECOVERY_RETRY_INITIAL_MS * 2 ** this.#recoveryAttempt,
      SNAPSHOT_RECOVERY_RETRY_MAX_MS,
    );
    this.#recoveryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#startRecoveryAttempt();
    }, retryDelay);
  }

  #startRecoveryAttempt(): void {
    if (this.#recoveryState === "disposed") {
      return;
    }
    this.#recoveryState = "recovering";
    this.#onRecovering();
    const recoveryGeneration = this.#recoveryGeneration;
    let recovery: Promise<T | undefined>;
    try {
      recovery = Promise.resolve(this.#recoverSnapshot());
    } catch (error) {
      showErrorToast(error);
      if (recoveryGeneration === this.#recoveryGeneration) {
        this.#scheduleRecoveryRetry();
      }
      return;
    }
    void recovery
      .then((response) => {
        if (
          this.#recoveryState !== "recovering" ||
          recoveryGeneration !== this.#recoveryGeneration
        ) {
          return;
        }
        if (response === undefined) {
          this.#scheduleRecoveryRetry();
          return;
        }
        // 只允许当前代次的权威 Snapshot 完成恢复，过期请求不能覆盖新连接基线。
        this.#onRecovered(response);
      })
      .catch((error: unknown) => {
        showErrorToast(error);
        if (
          this.#recoveryState === "recovering" &&
          recoveryGeneration === this.#recoveryGeneration
        ) {
          this.#scheduleRecoveryRetry();
        }
      });
  }
}

export class TaskEventTarget {
  readonly #buffer = new AgentEventBuffer();
  readonly #onRecoveredSnapshot: (
    response: AgentTaskSnapshotResponse,
    target: TaskEventTarget,
  ) => void;
  readonly #recoverSnapshots = new Set<RecoverTaskSnapshot>();
  readonly #recovery: SnapshotRecoveryController<AgentTaskSnapshotResponse>;
  readonly #onPerformanceSample: RealtimePerformanceObserver | undefined;
  readonly #store: TaskStore;
  #frameId: number | undefined;

  public constructor(
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
    onRecoveredSnapshot: (response: AgentTaskSnapshotResponse, target: TaskEventTarget) => void,
    onPerformanceSample?: RealtimePerformanceObserver,
  ) {
    this.#store = store;
    this.#recoverSnapshots.add(recoverSnapshot);
    this.#onRecoveredSnapshot = onRecoveredSnapshot;
    this.#onPerformanceSample = onPerformanceSample;
    this.#recovery = new SnapshotRecoveryController(
      async () => this.#recoverSnapshots.values().next().value?.(),
      (response) => {
        this.#onRecoveredSnapshot(response, this);
      },
      () => {
        this.#store.getState().setConnectionState("reconnecting");
      },
    );
  }

  public get sessionId(): string | undefined {
    return this.#store.getState().checkpoint?.sessionId;
  }

  public get taskId(): string {
    return this.#store.getState().taskId;
  }

  public addConsumer(recoverSnapshot: RecoverTaskSnapshot): void {
    this.#recoverSnapshots.add(recoverSnapshot);
  }

  public removeConsumer(recoverSnapshot: RecoverTaskSnapshot): number {
    this.#recoverSnapshots.delete(recoverSnapshot);
    return this.#recoverSnapshots.size;
  }

  public resetForSnapshot(): void {
    // 新 Snapshot 是当前 Store 的权威基线，清除旧帧并允许后续事件重新进入增量路径。
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#recovery.reset();
  }

  public apply(event: AgentEvent): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (isDeltaEvent(event)) {
      if (!this.#buffer.push(event)) {
        this.requestRecovery();
        return;
      }
      this.#frameId ??= requestAnimationFrame(() => {
        this.#frameId = undefined;
        this.#commit(this.#buffer.drain());
      });
      return;
    }
    this.#flushThrough(event.sequence);
    this.#commit([event]);
  }

  public dispose(): void {
    this.#recovery.dispose();
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
  }

  public requestRecovery(): void {
    if (!this.#recovery.isReady) {
      return;
    }
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#recovery.requestRecovery();
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    // Socket 连通不代表 Snapshot 已校准，恢复状态优先于底层传输状态。
    const visibleState = state === "connected" && !this.#recovery.isReady ? "reconnecting" : state;
    this.#store.getState().setConnectionState(visibleState);
    if (visibleState === "connected") {
      this.#store.getState().setError(null);
    }
  }

  public setError(error: Error): void {
    this.#store.getState().setError(error);
  }

  #flushThrough(sequence: number): void {
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#commit(this.#buffer.flushThrough(sequence));
  }

  #commit(events: readonly AgentEvent[]): void {
    this.#store.getState().applyEvents(events);
    if (this.#onPerformanceSample === undefined || events.length === 0) return;
    const at = performance.now();
    for (const event of events) {
      this.#onPerformanceSample({ at, point: "store_committed", sequence: event.sequence });
    }
  }
}
