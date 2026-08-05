import type {
  AgentProviderAttachment,
  AgentProviderEventListener,
  AgentProviderTaskSnapshot,
  AgentTaskUnsubscribeStatus,
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

export abstract class CodexAgentProviderTasks extends CodexAgentProviderTurns {
  public async readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined> {
    this.runtime.pendingTaskReads.set(taskId, (this.runtime.pendingTaskReads.get(taskId) ?? 0) + 1);
    let projectOwnershipVerified = false;
    try {
      let nativeResponse: unknown;
      try {
        nativeResponse = await this.client.request("thread/read", {
          includeTurns: true,
          threadId: taskId,
        });
      } catch (error) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (unmaterializedTask !== undefined && isThreadNotMaterializedError(error)) {
          // Codex 在首条用户消息前不允许 includeTurns，返回已知新 Task 的空快照供首轮校验。
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
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.promotePendingServerRequests(taskId);
      const task = await mapAgentTask(thread, this.project);
      if (!Array.isArray(thread["turns"])) {
        throw new CodexProtocolMappingError("thread/read turns must be an array");
      }
      const nativeTurns = await this.readReviewWorkerTurns(taskId, thread["turns"]);
      const transcriptSkillsByTurnId = await readCodexTranscriptTurnSkills(taskId);
      // Store 为未变化的来源复用随机授权 ID，重复读取不能使已交付的 Snapshot 图片失效。
      const turns = mapAgentTurns(
        nativeTurns,
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
        pendingRequests: this.pendingLifecycle.pendingForTask(taskId),
        status,
        turns,
      };
      return snapshot;
    } finally {
      this.finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  protected async readReviewWorkerTurns(
    taskId: string,
    parentTurns: readonly unknown[],
  ): Promise<unknown[]> {
    const reviewTurnIndexes = parentTurns.flatMap((turn, turnIndex) => {
      const nativeTurn = expectRecord(turn, "Codex turn");
      const items = nativeTurn["items"];
      return Array.isArray(items) &&
        items.some((item) => isRecord(item) && item["type"] === "enteredReviewMode")
        ? [turnIndex]
        : [];
    });
    if (reviewTurnIndexes.length === 0) {
      return [...parentTurns];
    }

    const listResponse = expectRecord(
      await this.client.request("thread/list", {
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

    const workerTurnGroups: unknown[][] = [];
    for (const workerThreadValue of listResponse["data"].slice(0, reviewTurnIndexes.length)) {
      const workerThread = expectRecord(workerThreadValue, "Codex review worker thread");
      const workerTaskId = expectString(workerThread["id"], "Codex review worker thread id");
      const workerResponse = expectRecord(
        await this.client.request("thread/read", {
          includeTurns: true,
          threadId: workerTaskId,
        }),
        "review worker thread/read response",
      );
      const loadedWorkerThread = expectRecord(
        workerResponse["thread"],
        "Codex loaded review worker thread",
      );
      if (!Array.isArray(loadedWorkerThread["turns"])) {
        throw new CodexProtocolMappingError("review worker thread/read turns must be an array");
      }
      const workerTurns = loadedWorkerThread["turns"] as unknown[];
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
    return turns;
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

  public subscribeEvents(listener: AgentProviderEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
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
