import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentContextUsage, AgentReviewTarget, AgentTask } from "@code-agent/protocol";

import type { PendingCodexRequest } from "./codex-protocol-mapping.js";

/** 集中拥有所有 Task 级运行状态，确保释放时不会遗漏只增不减的 Map。 */
export class TaskRuntimeState {
  public readonly activeReviewTargets = new Map<string, AgentReviewTarget>();
  public readonly contextUsage = new Map<string, AgentContextUsage>();
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
    this.contextUsage.delete(taskId);
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
    this.contextUsage.clear();
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
