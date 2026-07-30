import type { AgentEventConnectionState } from "@code-agent/client";
import type {
  AgentEvent,
  AgentTask,
  AgentTaskSnapshotResponse,
  EventCheckpoint,
} from "@code-agent/protocol";

import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
import {
  createBrowserTaskNotifier,
  type TaskNotifier,
} from "../../notifications/browser-task-notifier.js";
import type { CodeAgentRuntimeClient } from "../../projects/project-queries.js";
import {
  clearTaskAttention,
  hasActiveProjectTask,
  recordRunningTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  removeTaskActivity,
  type TaskActivityMap,
} from "./task-activity.js";
import { AgentEventBuffer } from "./task-runtime.js";
import type { TaskStore } from "./task-store.js";

export const PROJECT_RUNTIME_IDLE_TIMEOUT_MS = 2 * 60_000;
const MAX_PROJECT_EVENT_HISTORY_BYTES = 4 * 1_048_576;
const MAX_PROJECT_EVENT_HISTORY_EVENTS = 2_048;
const MAX_TASK_TITLES = 2_048;

type ActivityListener = () => void;
type RecoverTaskSnapshot = () => void;

type ProjectEventRuntimeOptions = Required<
  Pick<
    ProjectRuntimeManagerOptions,
    "idleTimeoutMs" | "maxEventHistoryBytes" | "maxEventHistoryEvents"
  >
>;

export type ProjectRuntimeManagerOptions = Readonly<{
  idleTimeoutMs?: number;
  maxEventHistoryBytes?: number;
  maxEventHistoryEvents?: number;
  onTaskMetadataChanged?: (
    projectId: string,
    taskId: string,
    reason: "assistant_reply_started" | "turn_completed",
  ) => void;
  taskNotifier?: TaskNotifier;
}>;

type BufferedProjectEvent = Readonly<{
  event: AgentEvent;
  retainedBytes: number;
}>;

function isDeltaEvent(event: AgentEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

function createProjectTaskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

function createProjectTurnKey(projectId: string, taskId: string, turnId: string): string {
  return `${createProjectTaskKey(projectId, taskId)}\u0000${turnId}`;
}

// 每个 Task Store 独立合并动画帧内 Delta；Project Runtime 只共享传输和协议解析。
class TaskEventTarget {
  readonly #buffer = new AgentEventBuffer();
  readonly #recoverSnapshots = new Set<RecoverTaskSnapshot>();
  readonly #store: TaskStore;
  #frameId: number | undefined;
  #pausedForRecovery = false;

  public constructor(store: TaskStore, recoverSnapshot: RecoverTaskSnapshot) {
    this.#store = store;
    this.#recoverSnapshots.add(recoverSnapshot);
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
    this.#pausedForRecovery = false;
  }

  public apply(event: AgentEvent): void {
    if (this.#pausedForRecovery) {
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
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
  }

  public requestRecovery(): void {
    if (this.#pausedForRecovery) {
      return;
    }
    this.#pausedForRecovery = true;
    if (this.#frameId !== undefined) {
      cancelAnimationFrame(this.#frameId);
      this.#frameId = undefined;
    }
    this.#buffer.drain();
    this.#store.getState().setConnectionState("reconnecting");
    this.#recoverSnapshots.values().next().value?.();
  }

  public setConnectionState(state: AgentEventConnectionState): void {
    this.#store.getState().setConnectionState(state);
    if (state === "connected") {
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
}

type ProjectRuntimeCallbacks = Readonly<{
  getTaskActivity: () => TaskActivityMap;
  onActivityEvent: (projectId: string, event: AgentEvent) => void;
  onIdle: (runtime: ProjectEventRuntime) => void;
  onSnapshot: (response: AgentTaskSnapshotResponse) => void;
}>;

class ProjectEventRuntime {
  readonly #callbacks: ProjectRuntimeCallbacks;
  readonly #client: CodeAgentRuntimeClient;
  readonly #idleTimeoutMs: number;
  readonly #maxEventHistoryBytes: number;
  readonly #maxEventHistoryEvents: number;
  readonly #projectId: string;
  readonly #targets = new Map<TaskStore, TaskEventTarget>();
  #connectionCleanup: (() => void) | undefined;
  #connectionState: AgentEventConnectionState = "closed";
  #disposed = false;
  #eventHistory: BufferedProjectEvent[] = [];
  #eventHistoryBytes = 0;
  #historyFloorSequence = 0;
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
    this.#maxEventHistoryBytes = options.maxEventHistoryBytes;
    this.#maxEventHistoryEvents = options.maxEventHistoryEvents;
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
    storeState.hydrate(response);
    let target = this.#targets.get(store);
    if (target === undefined) {
      target = new TaskEventTarget(store, recoverSnapshot);
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
    const retainedBytes = estimateRetainedBytes(event);
    if (retainedBytes > this.#maxEventHistoryBytes || this.#maxEventHistoryEvents === 0) {
      this.#clearEventHistory();
      this.#historyFloorSequence = event.sequence;
      return;
    }
    this.#eventHistory.push({ event, retainedBytes });
    this.#eventHistoryBytes += retainedBytes;
    while (
      this.#eventHistory.length > this.#maxEventHistoryEvents ||
      this.#eventHistoryBytes > this.#maxEventHistoryBytes
    ) {
      const removed = this.#eventHistory.shift();
      if (removed === undefined) {
        break;
      }
      this.#eventHistoryBytes -= removed.retainedBytes;
      this.#historyFloorSequence = removed.event.sequence;
    }
  }

  #assertSnapshotProject(response: AgentTaskSnapshotResponse): void {
    if (response.snapshot.projectId !== this.#projectId) {
      throw new Error("Snapshot Project does not match the Project Runtime");
    }
  }

  #clearEventHistory(): void {
    this.#eventHistory = [];
    this.#eventHistoryBytes = 0;
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
    this.#clearEventHistory();
    this.#sessionId = checkpoint.sessionId;
    this.#latestSequence = checkpoint.sequence;
    this.#historyFloorSequence = checkpoint.sequence;

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
      checkpoint.sequence < this.#historyFloorSequence &&
      checkpoint.sequence < this.#latestSequence
    ) {
      // Snapshot checkpoint 早于客户端保留窗口时禁止猜测缺失事件，直接请求权威快照。
      target.requestRecovery();
      return;
    }
    for (const bufferedEvent of this.#eventHistory) {
      if (
        bufferedEvent.event.taskId === target.taskId &&
        bufferedEvent.event.sequence > checkpoint.sequence
      ) {
        target.apply(bufferedEvent.event);
      }
    }
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

export class ProjectRuntimeManager {
  readonly #activityListeners = new Set<ActivityListener>();
  readonly #idleTimeoutMs: number;
  readonly #maxEventHistoryBytes: number;
  readonly #maxEventHistoryEvents: number;
  readonly #onTaskMetadataChanged: NonNullable<
    ProjectRuntimeManagerOptions["onTaskMetadataChanged"]
  >;
  readonly #projects = new Map<string, ProjectEventRuntime>();
  readonly #taskNotifier: TaskNotifier;
  #taskActivity: TaskActivityMap = new Map();
  readonly #taskTitles = new Map<string, string>();
  readonly #titleRefreshedRunningTurns = new Set<string>();
  #viewedTask: Readonly<{ projectId: string; taskId: string }> | undefined;

  public readonly client: CodeAgentRuntimeClient;

  public constructor(client: CodeAgentRuntimeClient, options: ProjectRuntimeManagerOptions = {}) {
    this.client = client;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? PROJECT_RUNTIME_IDLE_TIMEOUT_MS;
    this.#maxEventHistoryBytes = options.maxEventHistoryBytes ?? MAX_PROJECT_EVENT_HISTORY_BYTES;
    this.#maxEventHistoryEvents = options.maxEventHistoryEvents ?? MAX_PROJECT_EVENT_HISTORY_EVENTS;
    this.#onTaskMetadataChanged = options.onTaskMetadataChanged ?? (() => undefined);
    this.#taskNotifier = options.taskNotifier ?? createBrowserTaskNotifier();
    if (!Number.isSafeInteger(this.#idleTimeoutMs) || this.#idleTimeoutMs < 0) {
      throw new RangeError("Project Runtime idleTimeoutMs must be non-negative");
    }
    if (!Number.isSafeInteger(this.#maxEventHistoryBytes) || this.#maxEventHistoryBytes < 0) {
      throw new RangeError("Project Runtime maxEventHistoryBytes must be non-negative");
    }
    if (!Number.isSafeInteger(this.#maxEventHistoryEvents) || this.#maxEventHistoryEvents < 0) {
      throw new RangeError("Project Runtime maxEventHistoryEvents must be non-negative");
    }
  }

  public attachTaskStore(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
  ): () => void {
    this.#rememberTaskTitle(response.snapshot);
    this.#updateTaskActivity(
      recordTaskActivitySnapshot(
        this.#taskActivity,
        response.snapshot,
        this.#isTaskViewed(response.snapshot.projectId, response.snapshot.id),
      ),
    );
    return this.#getProject(response.snapshot.projectId).attachTaskStore(
      response,
      store,
      recoverSnapshot,
    );
  }

  public dispose(): void {
    for (const project of this.#projects.values()) {
      project.dispose();
    }
    this.#projects.clear();
    this.#activityListeners.clear();
    this.#taskTitles.clear();
    this.#titleRefreshedRunningTurns.clear();
  }

  public forgetTask(projectId: string, taskId: string): void {
    this.#updateTaskActivity(removeTaskActivity(this.#taskActivity, projectId, taskId));
    this.#taskTitles.delete(createProjectTaskKey(projectId, taskId));
    this.#projects.get(projectId)?.forgetTask(taskId);
  }

  public getTaskActivity(): TaskActivityMap {
    return this.#taskActivity;
  }

  public markTaskRunning(projectId: string, taskId: string): void {
    this.#updateTaskActivity(recordRunningTaskActivity(this.#taskActivity, projectId, taskId));
    this.#projects.get(projectId)?.markAccess();
  }

  public observeSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#rememberTaskTitle(response.snapshot);
    this.#updateTaskActivity(
      recordTaskActivitySnapshot(
        this.#taskActivity,
        response.snapshot,
        this.#isTaskViewed(response.snapshot.projectId, response.snapshot.id),
      ),
    );
    this.#getProject(response.snapshot.projectId).observeSnapshot(response);
  }

  public requestNotificationPermission(): Promise<void> {
    return this.#taskNotifier.requestPermission().catch(() => undefined);
  }

  public rememberTaskTitles(tasks: readonly Pick<AgentTask, "id" | "projectId" | "title">[]): void {
    for (const task of tasks) {
      this.#rememberTaskTitle(task);
    }
  }

  public viewTask(projectId: string, taskId?: string): void {
    this.#viewedTask = taskId === undefined ? undefined : { projectId, taskId };
    if (taskId !== undefined) {
      this.#updateTaskActivity(clearTaskAttention(this.#taskActivity, projectId, taskId));
    }
    this.#projects.get(projectId)?.markAccess();
  }

  public subscribeTaskActivity(listener: ActivityListener): () => void {
    this.#activityListeners.add(listener);
    return () => {
      this.#activityListeners.delete(listener);
    };
  }

  #getProject(projectId: string): ProjectEventRuntime {
    let project = this.#projects.get(projectId);
    if (project !== undefined) {
      return project;
    }
    project = new ProjectEventRuntime(
      projectId,
      this.client,
      {
        getTaskActivity: () => this.#taskActivity,
        onActivityEvent: (eventProjectId, event) => {
          const turnKey = createProjectTurnKey(eventProjectId, event.taskId, event.turnId);
          if (event.type === "message.delta" && !this.#titleRefreshedRunningTurns.has(turnKey)) {
            // 首个 Assistant Delta 出现时刷新一次，避免流式 Token 持续触发 HTTP 请求。
            this.#titleRefreshedRunningTurns.add(turnKey);
            if (this.#titleRefreshedRunningTurns.size > MAX_TASK_TITLES) {
              const oldestTurnKey = this.#titleRefreshedRunningTurns.values().next().value;
              if (oldestTurnKey !== undefined) {
                this.#titleRefreshedRunningTurns.delete(oldestTurnKey);
              }
            }
            this.#onTaskMetadataChanged(eventProjectId, event.taskId, "assistant_reply_started");
          }
          if (event.type === "turn.completed") {
            this.#titleRefreshedRunningTurns.delete(turnKey);
            // 标题由 Provider 在 Turn 结束时生成，后台 Task 也必须通知列表读取最新元数据。
            this.#onTaskMetadataChanged(eventProjectId, event.taskId, "turn_completed");
          }
          this.#taskNotifier.notify(
            eventProjectId,
            event,
            this.#taskTitles.get(createProjectTaskKey(eventProjectId, event.taskId)) ?? "Task",
          );
          this.#updateTaskActivity(
            reduceTaskActivityEvent(
              this.#taskActivity,
              eventProjectId,
              event,
              this.#isTaskViewed(eventProjectId, event.taskId),
            ),
          );
        },
        onIdle: (idleProject) => {
          if (this.#projects.get(projectId) === idleProject) {
            this.#projects.delete(projectId);
          }
        },
        onSnapshot: (response) => {
          this.observeSnapshot(response);
        },
      },
      {
        idleTimeoutMs: this.#idleTimeoutMs,
        maxEventHistoryBytes: this.#maxEventHistoryBytes,
        maxEventHistoryEvents: this.#maxEventHistoryEvents,
      },
    );
    this.#projects.set(projectId, project);
    return project;
  }

  #updateTaskActivity(nextActivity: TaskActivityMap): void {
    if (nextActivity === this.#taskActivity) {
      return;
    }
    this.#taskActivity = nextActivity;
    for (const listener of this.#activityListeners) {
      listener();
    }
  }

  #isTaskViewed(projectId: string, taskId: string): boolean {
    return this.#viewedTask?.projectId === projectId && this.#viewedTask.taskId === taskId;
  }

  #rememberTaskTitle(task: Pick<AgentTask, "id" | "projectId" | "title">): void {
    const key = createProjectTaskKey(task.projectId, task.id);
    this.#taskTitles.delete(key);
    this.#taskTitles.set(key, task.title);
    if (this.#taskTitles.size > MAX_TASK_TITLES) {
      const oldestKey = this.#taskTitles.keys().next().value;
      if (oldestKey !== undefined) {
        this.#taskTitles.delete(oldestKey);
      }
    }
  }
}

export function createProjectRuntimeManager(
  client: CodeAgentRuntimeClient,
  options: ProjectRuntimeManagerOptions = {},
): ProjectRuntimeManager {
  return new ProjectRuntimeManager(client, options);
}
