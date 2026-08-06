import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentContextUsage, AgentReviewTarget, AgentTask } from "@code-agent/protocol";

import type { PendingCodexRequest } from "./codex-protocol-mapping.js";

/** 集中拥有所有 Task 级运行状态，确保释放时不会遗漏只增不减的 Map。 */
export class TaskRuntimeState {
  public readonly activeReviewTargets = new Map<string, AgentReviewTarget>();
  public readonly activeReviewTurnIds = new Map<string, string>();
  public readonly activeReviewWorkerTaskIds = new Set<string>();
  public readonly reviewWorkerOutputTaskIds = new Set<string>();
  public readonly reviewWorkerTaskIds = new Map<string, string>();
  public readonly reviewWorkerTurnIds = new Map<string, string>();
  public readonly reviewWorkerParentTaskIds = new Map<string, string>();
  public readonly contextUsage = new Map<string, AgentContextUsage>();
  public readonly ephemeralTaskIds = new Set<string>();
  public readonly pendingTaskEvents = new Map<string, AgentProviderEvent[]>();
  public readonly pendingTaskReads = new Map<string, number>();
  public readonly pendingTaskServerRequests = new Map<string, PendingCodexRequest[]>();
  public readonly projectTaskIds = new Set<string>();
  public readonly resumedTaskIds = new Set<string>();
  public readonly resumePromises = new Map<string, Promise<void>>();
  public readonly runningTaskIds = new Set<string>();
  public readonly unmaterializedTasks = new Map<string, AgentTask>();

  public hasLifecycleObligations(taskId: string, hasPendingRequest: boolean): boolean {
    return (
      this.runningTaskIds.has(taskId) ||
      this.pendingTaskReads.has(taskId) ||
      this.resumePromises.has(taskId) ||
      (this.pendingTaskServerRequests.get(taskId)?.length ?? 0) > 0 ||
      hasPendingRequest
    );
  }

  public clearTask(taskId: string): void {
    this.activeReviewTargets.delete(taskId);
    this.activeReviewTurnIds.delete(taskId);
    this.activeReviewWorkerTaskIds.delete(taskId);
    this.reviewWorkerOutputTaskIds.delete(taskId);
    this.reviewWorkerTaskIds.delete(taskId);
    this.reviewWorkerTurnIds.delete(taskId);
    this.reviewWorkerParentTaskIds.delete(taskId);
    for (const [workerTaskId, parentTaskId] of this.reviewWorkerParentTaskIds) {
      if (parentTaskId === taskId) {
        this.reviewWorkerParentTaskIds.delete(workerTaskId);
      }
    }
    this.contextUsage.delete(taskId);
    this.ephemeralTaskIds.delete(taskId);
    this.pendingTaskEvents.delete(taskId);
    this.pendingTaskReads.delete(taskId);
    this.pendingTaskServerRequests.delete(taskId);
    this.projectTaskIds.delete(taskId);
    this.resumedTaskIds.delete(taskId);
    this.resumePromises.delete(taskId);
    this.runningTaskIds.delete(taskId);
    this.unmaterializedTasks.delete(taskId);
  }

  public clear(): void {
    this.activeReviewTargets.clear();
    this.activeReviewTurnIds.clear();
    this.activeReviewWorkerTaskIds.clear();
    this.reviewWorkerOutputTaskIds.clear();
    this.reviewWorkerTaskIds.clear();
    this.reviewWorkerTurnIds.clear();
    this.reviewWorkerParentTaskIds.clear();
    this.contextUsage.clear();
    this.ephemeralTaskIds.clear();
    this.pendingTaskEvents.clear();
    this.pendingTaskReads.clear();
    this.pendingTaskServerRequests.clear();
    this.projectTaskIds.clear();
    this.resumedTaskIds.clear();
    this.resumePromises.clear();
    this.runningTaskIds.clear();
    this.unmaterializedTasks.clear();
  }
}
