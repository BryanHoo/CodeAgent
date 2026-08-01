import type { QueryClient } from "@tanstack/react-query";

import { type CodeAgentGitStatusClient, projectGitStatusQueryOptions } from "./project-queries.js";

export const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 10_000;
export const PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS = 300;

export type ProjectGitActivityReason = "file_changed" | "turn_completed" | "turn_started";

interface ProjectGitStatusCoordinatorOptions {
  readonly fileChangeDebounceMs?: number;
  readonly isPageVisible?: () => boolean;
  readonly pollIntervalMs?: number;
}

interface ProjectPollingState {
  activeTaskIds: Set<string>;
  closed: boolean;
  fileChangeTimer: ReturnType<typeof setTimeout> | undefined;
  inFlight: Promise<void> | undefined;
  pollingSuspended: boolean;
  pollingTimer: ReturnType<typeof setInterval> | undefined;
  projectId: string;
  refreshPending: boolean;
}

function defaultPageVisibility(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export class ProjectGitStatusCoordinator {
  readonly #client: CodeAgentGitStatusClient;
  readonly #fileChangeDebounceMs: number;
  readonly #isPageVisible: () => boolean;
  readonly #pollIntervalMs: number;
  readonly #projects = new Map<string, ProjectPollingState>();
  readonly #queryClient: QueryClient;
  #disposed = false;

  public constructor(
    queryClient: QueryClient,
    client: CodeAgentGitStatusClient,
    options: ProjectGitStatusCoordinatorOptions = {},
  ) {
    this.#queryClient = queryClient;
    this.#client = client;
    this.#fileChangeDebounceMs =
      options.fileChangeDebounceMs ?? PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS;
    this.#isPageVisible = options.isPageVisible ?? defaultPageVisibility;
    this.#pollIntervalMs = options.pollIntervalMs ?? PROJECT_GIT_STATUS_POLL_INTERVAL_MS;
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const state of this.#projects.values()) {
      this.#closeState(state);
    }
    this.#projects.clear();
  }

  public forgetProject(projectId: string): void {
    const state = this.#projects.get(projectId);
    if (state === undefined) {
      return;
    }
    this.#closeState(state);
    this.#projects.delete(projectId);
  }

  public handleActivity(projectId: string, taskId: string, reason: ProjectGitActivityReason): void {
    if (this.#disposed) {
      return;
    }
    const state = this.#getOrCreateState(projectId);
    if (reason === "turn_started") {
      const wasInactive = state.activeTaskIds.size === 0;
      const wasSuspended = state.pollingSuspended;
      state.activeTaskIds.add(taskId);
      state.pollingSuspended = false;
      this.#ensurePolling(state);
      if (wasInactive || wasSuspended) {
        void this.#requestRefresh(state);
      }
      return;
    }

    if (reason === "file_changed") {
      state.activeTaskIds.add(taskId);
      state.pollingSuspended = false;
      this.#ensurePolling(state);
      this.#scheduleFileChangeRefresh(state);
      return;
    }

    state.activeTaskIds.delete(taskId);
    state.pollingSuspended = false;
    this.#clearFileChangeTimer(state);
    if (state.activeTaskIds.size === 0) {
      this.#clearPollingTimer(state);
    }
    // Turn 终态始终补读一次；最后一个 Task 的状态只在该请求完成后释放。
    void this.#requestRefresh(state);
  }

  public async refreshProject(projectId: string): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const state = this.#getOrCreateState(projectId);
    state.pollingSuspended = false;
    await this.#requestRefresh(state);
  }

  #clearFileChangeTimer(state: ProjectPollingState): void {
    if (state.fileChangeTimer !== undefined) {
      clearTimeout(state.fileChangeTimer);
      state.fileChangeTimer = undefined;
    }
  }

  #clearPollingTimer(state: ProjectPollingState): void {
    if (state.pollingTimer !== undefined) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = undefined;
    }
  }

  #closeState(state: ProjectPollingState): void {
    state.closed = true;
    state.refreshPending = false;
    this.#clearFileChangeTimer(state);
    this.#clearPollingTimer(state);
  }

  #ensurePolling(state: ProjectPollingState): void {
    if (
      state.closed ||
      state.pollingSuspended ||
      state.activeTaskIds.size === 0 ||
      state.pollingTimer !== undefined
    ) {
      return;
    }
    state.pollingTimer = setInterval(() => {
      if (this.#isPageVisible()) {
        void this.#requestRefresh(state);
      }
    }, this.#pollIntervalMs);
  }

  #getOrCreateState(projectId: string): ProjectPollingState {
    const current = this.#projects.get(projectId);
    if (current !== undefined) {
      return current;
    }
    const state: ProjectPollingState = {
      activeTaskIds: new Set(),
      closed: false,
      fileChangeTimer: undefined,
      inFlight: undefined,
      pollingSuspended: false,
      pollingTimer: undefined,
      projectId,
      refreshPending: false,
    };
    this.#projects.set(projectId, state);
    return state;
  }

  #requestRefresh(state: ProjectPollingState): Promise<void> {
    if (state.closed || this.#disposed) {
      return Promise.resolve();
    }
    if (state.inFlight !== undefined) {
      state.refreshPending = true;
      return state.inFlight;
    }

    const refresh = this.#queryClient
      .fetchQuery({
        ...projectGitStatusQueryOptions(state.projectId, this.#client),
        staleTime: 0,
      })
      .then(
        () => {
          state.pollingSuspended = false;
        },
        () => {
          state.pollingSuspended = true;
          this.#clearPollingTimer(state);
        },
      )
      .then(() => {
        if (state.closed || this.#disposed) {
          return;
        }
        state.inFlight = undefined;
        if (state.refreshPending) {
          state.refreshPending = false;
          void this.#requestRefresh(state);
          return;
        }
        if (state.activeTaskIds.size > 0 && !state.pollingSuspended) {
          this.#ensurePolling(state);
          return;
        }
        if (state.activeTaskIds.size === 0 && state.fileChangeTimer === undefined) {
          this.#projects.delete(state.projectId);
        }
      });
    state.inFlight = refresh;
    return refresh;
  }

  #scheduleFileChangeRefresh(state: ProjectPollingState): void {
    this.#clearFileChangeTimer(state);
    state.fileChangeTimer = setTimeout(() => {
      state.fileChangeTimer = undefined;
      void this.#requestRefresh(state);
    }, this.#fileChangeDebounceMs);
  }
}
