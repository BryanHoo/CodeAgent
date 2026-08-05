import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@code-agent/protocol";
import { AgentEventBuffer } from "./task-runtime.js";
import type { TaskStore } from "./task-store.js";

import type { RecoverTaskSnapshot, TaskRecoveryState } from "./project-runtime-history.js";
import {
  SNAPSHOT_RECOVERY_RETRY_INITIAL_MS,
  SNAPSHOT_RECOVERY_RETRY_MAX_MS,
  isDeltaEvent,
} from "./project-runtime-history.js";

export class TaskEventTarget {
  readonly #buffer = new AgentEventBuffer();
  readonly #onRecoveredSnapshot: (
    response: AgentTaskSnapshotResponse,
    target: TaskEventTarget,
  ) => void;
  readonly #recoverSnapshots = new Set<RecoverTaskSnapshot>();
  readonly #store: TaskStore;
  #frameId: number | undefined;
  #recoveryAttempt = 0;
  #recoveryGeneration = 0;
  #recoveryState: TaskRecoveryState = "ready";
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
    onRecoveredSnapshot: (response: AgentTaskSnapshotResponse, target: TaskEventTarget) => void,
  ) {
    this.#store = store;
    this.#recoverSnapshots.add(recoverSnapshot);
    this.#onRecoveredSnapshot = onRecoveredSnapshot;
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
    if (this.#recoveryState === "disposed") {
      return;
    }
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#clearRetryTimer();
    this.#buffer.drain();
    this.#recoveryAttempt = 0;
    this.#recoveryGeneration += 1;
    this.#recoveryState = "ready";
  }

  public apply(event: AgentEvent): void {
    if (this.#recoveryState !== "ready") {
      return;
    }
    if (isDeltaEvent(event)) {
      if (!this.#buffer.push(event)) {
        this.requestRecovery();
        return;
      }
      this.#frameId ??= requestAnimationFrame(() => {
        this.#frameId = undefined;
        this.#store.getState().applyEvents(this.#buffer.drain());
      });
      return;
    }
    this.#flushThrough(event.sequence);
    this.#store.getState().applyEvents([event]);
  }

  public dispose(): void {
    this.#recoveryState = "disposed";
    this.#recoveryGeneration += 1;
    this.#clearRetryTimer();
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
  }

  public requestRecovery(): void {
    if (this.#recoveryState !== "ready") {
      return;
    }
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#startRecoveryAttempt();
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    // Socket 连通不代表 Snapshot 已校准，恢复状态优先于底层传输状态。
    const visibleState =
      state === "connected" && this.#recoveryState !== "ready" ? "reconnecting" : state;
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
    this.#store.getState().applyEvents(this.#buffer.flushThrough(sequence));
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
    const recoverSnapshot = this.#recoverSnapshots.values().next().value;
    if (recoverSnapshot === undefined) {
      this.#scheduleRecoveryRetry();
      return;
    }

    this.#recoveryState = "recovering";
    this.#store.getState().setConnectionState("reconnecting");
    const recoveryGeneration = this.#recoveryGeneration;
    void Promise.resolve(recoverSnapshot())
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
        // 只有权威 Snapshot 完成 Hydrate 后，Runtime 才能重新接收并回放实时事件。
        this.#onRecoveredSnapshot(response, this);
      })
      .catch(() => {
        if (
          this.#recoveryState === "recovering" &&
          recoveryGeneration === this.#recoveryGeneration
        ) {
          this.#scheduleRecoveryRetry();
        }
      });
  }
}
