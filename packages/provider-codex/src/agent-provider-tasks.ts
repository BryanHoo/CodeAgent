import type {
  AgentProviderAttachment,
  AgentProviderEventListener,
  AgentProviderEventSubscriptionOptions,
  AgentProviderTaskSnapshot,
  AgentTaskUnsubscribeStatus,
  ReadAgentTaskInput,
  ResolvePendingRequestInput,
} from "@code-agent/core";
import type { PendingRequest } from "@code-agent/protocol";
import { readCodexTranscriptTurnSkills } from "./codex-transcript.js";
import {
  CodexProtocolMappingError,
  attachTranscriptSkills,
  expectRecord,
  expectString,
  isRecord,
  mapAgentTurns,
  mapThreadStatus,
} from "./codex-protocol-mapping.js";

import { CodexAgentProviderTurns } from "./agent-provider-turns.js";
import {
  createUnmaterializedTaskSnapshot,
  isProjectThread,
  isThreadNotLoadedError,
  isThreadNotMaterializedError,
  mapAgentTask,
} from "./agent-provider-base.js";
import {
  decodeTaskTurnCursor,
  encodeTaskTurnCursor,
  readNativeTaskTurnPage,
  readThreadHistoryMode,
} from "./task-history-pagination.js";

export abstract class CodexAgentProviderTasks extends CodexAgentProviderTurns {
  public async readTask(
    taskId: string,
    input: ReadAgentTaskInput = {},
  ): Promise<AgentProviderTaskSnapshot | undefined> {
    this.runtime.pendingTaskReads.set(taskId, (this.runtime.pendingTaskReads.get(taskId) ?? 0) + 1);
    let projectOwnershipVerified = false;
    try {
      const cursor = decodeTaskTurnCursor(input);
      let nativeResponse: unknown;
      try {
        nativeResponse = await this.client.request("thread/read", {
          includeTurns: false,
          threadId: taskId,
        });
      } catch (error) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (unmaterializedTask !== undefined && isThreadNotMaterializedError(error)) {
          // 首条用户消息落盘前仍返回本地已知的新 Task，避免首屏读取竞态。
          projectOwnershipVerified = true;
          this.promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        // Codex 用明确的 RPC 错误表示 Task 不存在，其他连接与协议错误继续向上传播。
        if (isThreadNotLoadedError(error)) {
          return undefined;
        }
        throw error;
      }
      const response = expectRecord(nativeResponse, "thread/read response");
      const thread = expectRecord(response["thread"], "thread/read thread");
      if (!(await isProjectThread(thread, this.project))) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (
          unmaterializedTask !== undefined &&
          thread["id"] === unmaterializedTask.id &&
          thread["projectId"] === null
        ) {
          // Codex 0.149 的内存快照会在首条消息落盘前暂时省略已分配的 projectId。
          projectOwnershipVerified = true;
          this.promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.promotePendingServerRequests(taskId);
      const task = await mapAgentTask(thread, this.project);
      let nativePage: Awaited<ReturnType<typeof readNativeTaskTurnPage>>;
      try {
        nativePage = await readNativeTaskTurnPage(
          this.client,
          taskId,
          readThreadHistoryMode(thread),
          cursor.turnCursor,
        );
      } catch (error) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (
          cursor.turnCursor === undefined &&
          unmaterializedTask !== undefined &&
          isThreadNotMaterializedError(error)
        ) {
          // Codex 首条消息前允许读取元数据，但分页历史尚不可用。
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        throw error;
      }
      const reviewPage = await this.readReviewWorkerTurns(
        taskId,
        nativePage.turns,
        cursor.reviewOffset,
      );
      const transcriptSkillsByTurnId = await readCodexTranscriptTurnSkills(taskId);
      // Store 为未变化的来源复用随机授权 ID，重复读取不能使已交付的 Snapshot 图片失效。
      const turns = mapAgentTurns(
        reviewPage.turns,
        (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
        (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
      ).map((turn) => attachTranscriptSkills(turn, transcriptSkillsByTurnId.get(turn.id) ?? []));
      const status = turns.some((turn) => turn.status === "running")
        ? "running"
        : mapThreadStatus(thread["status"]);
      const runningReviewTurn = turns.findLast(
        (turn) => turn.status === "running" && turn.items.some((item) => item.type === "review"),
      );
      const runningReviewItem = runningReviewTurn?.items.find((item) => item.type === "review");
      if (runningReviewTurn !== undefined && runningReviewItem?.type === "review") {
        // 服务重启或页面刷新后，从规范化 Snapshot 恢复后续实时通知所需的父级映射。
        this.runtime.activeReviewTargets.set(taskId, runningReviewItem.target);
        this.runtime.activeReviewTurnIds.set(taskId, runningReviewTurn.id);
        this.runtime.activeReviewWorkerTaskIds.add(taskId);
      }
      if (status === "running") {
        this.runtime.runningTaskIds.add(taskId);
      } else {
        this.runtime.runningTaskIds.delete(taskId);
      }
      const snapshot: AgentProviderTaskSnapshot = {
        ...task,
        contextUsage: this.runtime.contextUsage.get(taskId) ?? null,
        plan: this.runtime.plans.get(taskId) ?? null,
        pendingRequests: this.pendingLifecycle.pendingForTask(taskId),
        status,
        turns,
        turnsNextCursor: encodeTaskTurnCursor(
          nativePage.nextTurnCursor,
          cursor.reviewOffset + reviewPage.reviewCount,
        ),
      };
      return snapshot;
    } finally {
      this.finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  protected async readReviewWorkerTurns(
    taskId: string,
    parentTurns: readonly unknown[],
    reviewOffset: number,
  ): Promise<Readonly<{ reviewCount: number; turns: unknown[] }>> {
    const reviewTurnIndexes = parentTurns.flatMap((turn, turnIndex) => {
      const nativeTurn = expectRecord(turn, "Codex turn");
      const items = nativeTurn["items"];
      return Array.isArray(items) &&
        items.some((item) => isRecord(item) && item["type"] === "enteredReviewMode")
        ? [turnIndex]
        : [];
    });
    if (reviewTurnIndexes.length === 0) {
      return { reviewCount: 0, turns: [...parentTurns] };
    }

    const workerThreads: unknown[] = [];
    const seenCursors = new Set<string>();
    let listCursor: string | undefined;
    do {
      const listResponse = expectRecord(
        await this.client.request("thread/list", {
          ...(listCursor === undefined ? {} : { cursor: listCursor }),
          limit: 100,
          parentThreadId: taskId,
          sortDirection: "asc",
          sortKey: "created_at",
          sourceKinds: ["subAgentReview"],
        }),
        "review worker thread/list response",
      );
      if (!Array.isArray(listResponse["data"])) {
        throw new CodexProtocolMappingError("review worker thread/list data must be an array");
      }
      workerThreads.push(...listResponse["data"].map((value: unknown) => value));
      const nextCursor = listResponse["nextCursor"];
      if (nextCursor === null) {
        listCursor = undefined;
      } else {
        const next = expectString(nextCursor, "review worker thread/list next cursor");
        if (next === listCursor || seenCursors.has(next)) {
          throw new CodexProtocolMappingError(
            "review worker thread/list returned a repeated cursor",
          );
        }
        seenCursors.add(next);
        listCursor = next;
      }
    } while (listCursor !== undefined);

    const workerEnd = Math.max(0, workerThreads.length - reviewOffset);
    const workerStart = Math.max(0, workerEnd - reviewTurnIndexes.length);
    const selectedWorkerThreads = workerThreads.slice(workerStart, workerEnd);

    if (selectedWorkerThreads.length > reviewTurnIndexes.length) {
      throw new CodexProtocolMappingError("review worker pagination is inconsistent");
    }

    const workerTurnGroups: unknown[][] = [];
    for (const workerThreadValue of selectedWorkerThreads) {
      const workerThread = expectRecord(workerThreadValue, "Codex review worker thread");
      const workerTaskId = expectString(workerThread["id"], "Codex review worker thread id");
      const workerResponse = expectRecord(
        await this.client.request("thread/read", {
          includeTurns: false,
          threadId: workerTaskId,
        }),
        "review worker thread/read response",
      );
      const loadedWorkerThread = expectRecord(
        workerResponse["thread"],
        "Codex loaded review worker thread",
      );
      const workerPage = await readNativeTaskTurnPage(
        this.client,
        workerTaskId,
        readThreadHistoryMode(loadedWorkerThread),
      );
      const workerTurns = workerPage.turns;
      this.runtime.reviewWorkerParentTaskIds.set(workerTaskId, taskId);
      this.runtime.reviewWorkerTaskIds.set(taskId, workerTaskId);
      const runningWorkerTurn = workerTurns.findLast((turn) => {
        const nativeTurn = expectRecord(turn, "Codex review worker turn");
        return nativeTurn["status"] === "inProgress";
      });
      if (runningWorkerTurn !== undefined) {
        this.runtime.reviewWorkerTurnIds.set(
          taskId,
          expectString(
            expectRecord(runningWorkerTurn, "Codex running review worker turn")["id"],
            "Codex running review worker turn id",
          ),
        );
      }
      workerTurnGroups.push(workerTurns);
    }

    const turns: unknown[] = [];
    let workerIndex = 0;
    for (let turnIndex = 0; turnIndex < parentTurns.length; turnIndex += 1) {
      turns.push(parentTurns[turnIndex]);
      if (reviewTurnIndexes[workerIndex] === turnIndex) {
        turns.push(...(workerTurnGroups[workerIndex] ?? []));
        workerIndex += 1;
      }
    }
    return { reviewCount: reviewTurnIndexes.length, turns };
  }

  public async readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      return undefined;
    }
    return this.historicalAttachments.read(taskId, attachmentId);
  }

  public async resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    return this.pendingLifecycle.resolve(input);
  }

  public subscribeEvents(
    listener: AgentProviderEventListener,
    options: AgentProviderEventSubscriptionOptions = {},
  ): () => void {
    const listeners =
      options.includeEphemeral === true
        ? this.eventListenersIncludingEphemeral
        : this.eventListeners;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      return "notLoaded";
    }
    if (this.hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }
    const terminals = await this.listBackgroundTerminals(taskId);
    if (terminals.data.length > 0 || this.hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }

    const response = expectRecord(
      await this.client.request("thread/unsubscribe", { threadId: taskId }),
      "thread/unsubscribe response",
    );
    const status = expectString(response["status"], "thread/unsubscribe status");
    if (status !== "notLoaded" && status !== "notSubscribed" && status !== "unsubscribed") {
      throw new CodexProtocolMappingError("thread/unsubscribe returned an unknown status");
    }
    this.clearTaskRuntimeState(taskId);
    return status;
  }
}
