import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentEvent, AgentTaskSnapshotResponse, EventCheckpoint } from "@code-agent/protocol";
import type { CodeAgentRuntimeClient } from "../../projects/project-queries.js";
import { hasActiveProjectTask, type TaskActivityMap } from "./task-activity.js";
import type { TaskStore } from "./task-store.js";

import {
  ProjectEventHistory,
  type ProjectEventRuntimeOptions,
  type RecoverTaskSnapshot,
} from "./project-runtime-history.js";

import { TaskEventTarget } from "./project-runtime-recovery.js";

type ProjectRuntimeCallbacks = Readonly<{
  getTaskActivity: () => TaskActivityMap;
  onActivityEvent: (projectId: string, event: AgentEvent) => void;
  onIdle: (runtime: ProjectEventRuntime) => void;
  onSnapshot: (response: AgentTaskSnapshotResponse) => void;
}>;

export class ProjectEventRuntime {
  readonly #callbacks: ProjectRuntimeCallbacks;
  readonly #client: CodeAgentRuntimeClient;
  readonly #eventHistory: ProjectEventHistory;
  readonly #idleTimeoutMs: number;
  readonly #projectId: string;
  readonly #targets = new Map<TaskStore, TaskEventTarget>();
  #connectionCleanup: (() => void) | undefined;
  #connectionState: AgentEventConnectionState = "closed";
  #disposed = false;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #lastAccessAt = Date.now();
  #latestSequence = 0;
  #latestSnapshotTaskId: string | undefined;
  #recoveringSnapshot = false;
  #sessionId: string | undefined;
  #snapshotRecoveryRequired = false;

  public constructor(
    projectId: string,
    client: CodeAgentRuntimeClient,
    callbacks: ProjectRuntimeCallbacks,
    options: ProjectEventRuntimeOptions,
  ) {
    this.#projectId = projectId;
    this.#client = client;
    this.#callbacks = callbacks;
    this.#idleTimeoutMs = options.idleTimeoutMs;
    this.#eventHistory = new ProjectEventHistory({
      maxBytes: options.maxEventHistoryBytes,
      maxEvents: options.maxEventHistoryEvents,
    });
  }

  public attachTaskStore(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
  ): () => void {
    this.#assertSnapshotProject(response);
    const storeState = store.getState();
    if (storeState.projectId !== this.#projectId || storeState.taskId !== response.snapshot.id) {
      throw new Error("Task store identity does not match the Project Runtime snapshot");
    }

    this.#touch();
    storeState.reconcile(response);
    let target = this.#targets.get(store);
    if (target === undefined) {
      target = new TaskEventTarget(store, recoverSnapshot, (recoveredResponse, recoveredTarget) => {
        this.#hydrateRecoveredSnapshot(recoveredResponse, store, recoveredTarget);
      });
      this.#targets.set(store, target);
    } else {
      target.addConsumer(recoverSnapshot);
    }
    target.resetForSnapshot();
    target.setConnectionState(
      this.#connectionState === "closed" ? "connecting" : this.#connectionState,
    );
    this.observeSnapshot(response);
    this.#replayEvents(response.checkpoint, target);

    let attached = true;
    return () => {
      if (!attached) {
        return;
      }
      attached = false;
      const currentTarget = this.#targets.get(store);
      if (currentTarget !== target || currentTarget.removeConsumer(recoverSnapshot) > 0) {
        return;
      }
      currentTarget.dispose();
      this.#targets.delete(store);
      this.#touch();
      this.#reevaluateIdleRelease();
    };
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearIdleTimer();
    this.#stopConnection();
    for (const target of this.#targets.values()) {
      target.dispose();
    }
    this.#targets.clear();
    this.#clearEventHistory();
  }

  public forgetTask(taskId: string): void {
    if (this.#latestSnapshotTaskId === taskId) {
      this.#latestSnapshotTaskId = undefined;
    }
    this.#reevaluateIdleRelease();
  }

  public markAccess(): void {
    this.#touch();
    this.#reevaluateIdleRelease();
  }

  public observeSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#assertSnapshotProject(response);
    this.#latestSnapshotTaskId = response.snapshot.id;
    this.#snapshotRecoveryRequired = false;
    this.#touch();
    this.#ensureConnection(response.checkpoint);
    for (const target of this.#targets.values()) {
      if (target.sessionId !== response.checkpoint.sessionId) {
        target.requestRecovery();
      } else {
        target.setConnectionState(this.#connectionState);
      }
    }
    this.#reevaluateIdleRelease();
  }

  #appendEventHistory(event: AgentEvent): void {
    // 有界历史用于补齐 Snapshot 请求期间到达的事件，超出预算后由 Snapshot 恢复兜底。
    this.#eventHistory.append(event);
  }

  #assertSnapshotProject(response: AgentTaskSnapshotResponse): void {
    if (response.snapshot.projectId !== this.#projectId) {
      throw new Error("Snapshot Project does not match the Project Runtime");
    }
  }

  #clearEventHistory(): void {
    this.#eventHistory.reset();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer !== undefined) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }

  #ensureConnection(checkpoint: EventCheckpoint): void {
    if (this.#disposed) {
      return;
    }
    if (this.#connectionCleanup !== undefined && this.#sessionId === checkpoint.sessionId) {
      return;
    }
    this.#stopConnection();
    this.#sessionId = checkpoint.sessionId;
    this.#latestSequence = checkpoint.sequence;
    this.#eventHistory.reset(checkpoint.sequence);

    // 连接只在 Project Runtime 创建一次，Sidebar 与所有 Task Store 消费同一事件源。
    const cleanup = this.#client.subscribeEvents({
      afterSequence: checkpoint.sequence,
      onConnectionState: (state) => {
        this.#connectionState = state;
        if (state === "reconnecting") {
          this.#snapshotRecoveryRequired = true;
        }
        const visibleState =
          state === "closed" && this.#snapshotRecoveryRequired ? "reconnecting" : state;
        for (const target of this.#targets.values()) {
          target.setConnectionState(visibleState);
        }
        if (state === "reconnecting") {
          this.#requestSnapshotRecovery();
        }
      },
      onError: (error) => {
        for (const target of this.#targets.values()) {
          target.setError(error);
        }
      },
      onEvent: (event) => {
        this.#latestSequence = event.sequence;
        this.#appendEventHistory(event);
        this.#callbacks.onActivityEvent(this.#projectId, event);
        // 先更新轻量 Activity，再只向同 taskId 的详细 Store 分发，避免重复解析和跨 Task 缓冲。
        for (const [store, target] of this.#targets) {
          if (store.getState().taskId === event.taskId) {
            target.apply(event);
          }
        }
        if (event.type === "turn.completed" && !this.#hasTaskConsumers(event.taskId)) {
          void this.#client.unsubscribeTask(this.#projectId, event.taskId).catch(() => undefined);
        }
        this.#reevaluateIdleRelease();
      },
      onResyncRequired: () => {
        this.#snapshotRecoveryRequired = true;
        this.#stopConnection();
        this.#connectionState = "reconnecting";
        for (const target of this.#targets.values()) {
          target.setConnectionState("reconnecting");
        }
        this.#requestSnapshotRecovery();
      },
      projectId: this.#projectId,
      sessionId: checkpoint.sessionId,
    });
    this.#connectionCleanup = cleanup;
  }

  #hasTaskConsumers(taskId: string): boolean {
    for (const store of this.#targets.keys()) {
      if (store.getState().taskId === taskId) {
        return true;
      }
    }
    return false;
  }

  #hydrateRecoveredSnapshot(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    target: TaskEventTarget,
  ): void {
    if (this.#targets.get(store) !== target) {
      return;
    }
    this.#assertSnapshotProject(response);
    const storeState = store.getState();
    if (storeState.projectId !== this.#projectId || storeState.taskId !== response.snapshot.id) {
      throw new Error("Task store identity does not match the recovered snapshot");
    }

    storeState.reconcile(response);
    target.resetForSnapshot();
    this.#callbacks.onSnapshot(response);
    this.#replayEvents(response.checkpoint, target);
  }

  #reevaluateIdleRelease(): void {
    this.#clearIdleTimer();
    if (
      this.#disposed ||
      this.#connectionCleanup === undefined ||
      this.#targets.size > 0 ||
      hasActiveProjectTask(this.#callbacks.getTaskActivity(), this.#projectId)
    ) {
      return;
    }
    // 只有无详细消费者、无运行 Task、无待审批且超过空闲期时才释放 Project 连接。
    const remainingIdleMs = this.#idleTimeoutMs - (Date.now() - this.#lastAccessAt);
    if (remainingIdleMs <= 0) {
      this.dispose();
      this.#callbacks.onIdle(this);
      return;
    }
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      this.#reevaluateIdleRelease();
    }, remainingIdleMs);
  }

  #replayEvents(checkpoint: EventCheckpoint, target: TaskEventTarget): void {
    if (checkpoint.sessionId !== this.#sessionId) {
      target.requestRecovery();
      return;
    }
    if (
      checkpoint.sequence < this.#eventHistory.floorSequence &&
      checkpoint.sequence < this.#latestSequence
    ) {
      // Snapshot checkpoint 早于客户端保留窗口时禁止猜测缺失事件，直接请求权威快照。
      target.requestRecovery();
      return;
    }
    this.#eventHistory.forEachAfter(checkpoint.sequence, (event) => {
      if (event.taskId === target.taskId) {
        target.apply(event);
      }
    });
  }

  #requestSnapshotRecovery(): void {
    if (this.#targets.size > 0) {
      for (const target of this.#targets.values()) {
        target.requestRecovery();
      }
      return;
    }
    const taskId = this.#latestSnapshotTaskId;
    if (taskId === undefined || this.#recoveringSnapshot) {
      return;
    }
    this.#recoveringSnapshot = true;
    void this.#client
      .readTask(this.#projectId, taskId)
      .then((response) => {
        this.#callbacks.onSnapshot(response);
      })
      .catch(() => undefined)
      .finally(() => {
        this.#recoveringSnapshot = false;
      });
  }

  #stopConnection(): void {
    const cleanup = this.#connectionCleanup;
    this.#connectionCleanup = undefined;
    cleanup?.();
    this.#connectionState = "closed";
  }

  #touch(): void {
    this.#lastAccessAt = Date.now();
    this.#clearIdleTimer();
  }
}
