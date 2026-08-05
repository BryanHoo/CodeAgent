import type { PendingRequest } from "@code-agent/protocol";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import {
  Conversation,
  ConversationScrollButton,
  ConversationVirtualList,
} from "../../../shared/ai-elements/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/ai-elements/message.js";
import type { NormalizedAgentTurn, TaskStore } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { ChangedFilesCard } from "./task-timeline-file-changes.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import {
  StoredRunningReplyStatus,
  StoredTimelineItemContent,
  StoredUserMessage,
  groupStoredTurnTimelineItems,
} from "./task-timeline-store-items.js";
import {
  MessageMetadata,
  TimelineState,
  TurnProcessingTime,
  getMessageTimestamp,
} from "./task-timeline-status.js";

const getTurnIdKey = (turnId: string) => turnId;

export function StoredAssistantGroup({
  canRollback,
  itemIds,
  lastTurnItemId,
  latestSnapshotTimestamp,
  onOpenFileDiff,
  onForkTask,
  onBuildPlan,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  projectId,
  showProcessingTime,
  showRunningShimmer,
  store,
  taskId,
  turn,
}: Readonly<{
  canRollback: boolean;
  itemIds: readonly string[];
  lastTurnItemId: string | undefined;
  latestSnapshotTimestamp: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onForkTask?: ForkTaskAction;
  onBuildPlan?: BuildPlanAction;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  projectId: string;
  showProcessingTime: boolean;
  showRunningShimmer: boolean;
  store: TaskStore;
  taskId: string;
  turn: NormalizedAgentTurn;
}>) {
  // 完成态聚合只在 Turn 终态或 Item 顺序变化时执行，不参与文本 Delta。
  const itemStoresById = store.getState().itemStoresById;
  const assistantTextParts: string[] = [];
  const responseFileChanges: AgentFileChange[] = [];
  if (turn.status !== "running") {
    for (const itemId of itemIds) {
      const item = itemStoresById.get(itemId)?.read();
      if (item?.type === "message" && item.role === "assistant") {
        assistantTextParts.push(item.text);
      } else if (item?.type === "file_change" && item.status === "completed") {
        responseFileChanges.push(...item.changes);
      }
    }
  }
  const assistantText = assistantTextParts.join("\n\n");

  return (
    <Message from="assistant">
      {showProcessingTime ? (
        <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
      ) : null}
      <div className="w-full space-y-4">
        {itemIds.map((itemId) => (
          <StoredTimelineItemContent
            isLastTurnItem={itemId === lastTurnItemId}
            itemId={itemId}
            key={itemId}
            {...(onBuildPlan === undefined ? {} : { onBuildPlan })}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnStatus={turn.status}
          />
        ))}
        {showRunningShimmer ? <StoredRunningReplyStatus itemIds={itemIds} store={store} /> : null}
      </div>
      {turn.status !== "running" && responseFileChanges.length > 0 ? (
        <ChangedFilesCard
          canRollback={canRollback}
          changes={responseFileChanges}
          onOpenFileDiff={onOpenFileDiff}
          onReviewFileChanges={onReviewFileChanges}
          onRollback={(idempotencyKey) => onRollbackTurn(turn.id, idempotencyKey)}
        />
      ) : null}
      {turn.status !== "running" && assistantText.trim().length > 0 ? (
        <MessageMetadata
          {...(onForkTask === undefined ? {} : { onForkTask })}
          text={assistantText}
          timestamp={getMessageTimestamp("assistant", turn, latestSnapshotTimestamp)}
        />
      ) : null}
    </Message>
  );
}

export function StoreTurnTimelineSection({
  canRollback,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onRollbackTurn,
  projectId,
  store,
  taskId,
  turnId,
  turnIndex,
  suppressEmptyRunningStatus,
}: Readonly<{
  canRollback: boolean;
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  projectId: string;
  store: TaskStore;
  taskId: string;
  turnId: string;
  turnIndex: number;
  suppressEmptyRunningStatus: boolean;
}>) {
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const itemIds = useStore(store, (state) => state.itemIdsByTurnId[turnId] ?? []);
  if (turn === undefined) {
    return null;
  }
  const latestSnapshotTimestamp = store.getState().snapshotMetadata?.updatedAt ?? "";
  const timelineGroups = groupStoredTurnTimelineItems(itemIds, store.getState().itemStoresById);
  const firstAssistantGroupIndex = timelineGroups.findIndex((group) => group.type === "assistant");
  const hasAssistantItems = firstAssistantGroupIndex >= 0;
  const latestAssistantGroupIndex = timelineGroups.findLastIndex(
    (group) => group.type === "assistant",
  );
  const lastTurnItemId = itemIds.at(-1);

  return (
    <section
      aria-label={`Turn ${String(turnIndex + 1)}`}
      className="space-y-4"
      data-status={turn.status}
    >
      {timelineGroups.map((group, groupIndex) =>
        group.type === "user" ? (
          <StoredUserMessage
            itemId={group.itemId}
            key={group.itemId}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            onOpenSourceFile={onOpenSourceFile}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ) : (
          <StoredAssistantGroup
            canRollback={canRollback && turn.status === "completed"}
            itemIds={group.itemIds}
            key={group.key}
            lastTurnItemId={lastTurnItemId}
            latestSnapshotTimestamp={latestSnapshotTimestamp}
            {...(turn.status === "completed" && onBuildPlan !== undefined ? { onBuildPlan } : {})}
            onOpenFileDiff={onOpenFileDiff}
            {...(turn.status === "completed" &&
            groupIndex === latestAssistantGroupIndex &&
            onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            onRollbackTurn={onRollbackTurn}
            projectId={projectId}
            showProcessingTime={groupIndex === firstAssistantGroupIndex}
            showRunningShimmer={
              turn.status === "running" && groupIndex === timelineGroups.length - 1
            }
            store={store}
            taskId={taskId}
            turn={turn}
          />
        ),
      )}
      {turn.status === "running" && !hasAssistantItems && !suppressEmptyRunningStatus ? (
        <Message from="assistant">
          <TurnProcessingTime completedAt={turn.completedAt} startedAt={turn.startedAt} />
          <RunningReplyStatus />
        </Message>
      ) : null}
      {turn.error === null ? null : (
        <div
          className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
          role="alert"
        >
          <p>{turn.error}</p>
        </div>
      )}
    </section>
  );
}

export function StorePendingRequestList({
  connected,
  onResolvePendingRequest,
  store,
}: Readonly<{
  connected: boolean;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  store: TaskStore;
}>) {
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const visiblePendingRequests = pendingRequestIds.flatMap((requestId) => {
    const request = pendingRequestsById[requestId];
    return request === undefined || request.status === "resolved" ? [] : [request];
  });
  const firstPendingIndex = visiblePendingRequests.findIndex(
    (request) => request.status === "pending",
  );

  return visiblePendingRequests.map((request, index) => (
    <PendingRequestCard
      interactive={connected && request.status === "pending" && index === firstPendingIndex}
      key={request.requestId}
      onResolve={onResolvePendingRequest}
      request={request}
    />
  ));
}

export function TaskStoreTimeline({
  canRollbackTurns,
  connected,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  onRollbackTurn,
  scrollToBottomSignal,
  store,
  submissionStartedAt,
  submissionTurnId,
}: Readonly<{
  canRollbackTurns: boolean;
  connected: boolean;
  onBuildPlan?: BuildPlanAction;
  onForkTask?: ForkTaskAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onRollbackTurn: (turnId: string, idempotencyKey: string) => Promise<void>;
  scrollToBottomSignal?: number;
  store: TaskStore;
  submissionStartedAt?: string;
  submissionTurnId?: string;
}>) {
  const projectId = store.getState().projectId;
  const taskId = store.getState().taskId;
  const turnIds = useStore(store, (state) => state.turnIds);
  const pendingRequestIds = useStore(store, (state) => state.pendingRequestIds);
  const pendingRequestsById = useStore(store, (state) => state.pendingRequestsById);
  const hasVisiblePendingRequest = pendingRequestIds.some(
    (requestId) => pendingRequestsById[requestId]?.status !== "resolved",
  );
  const submissionHandoffState = useStore(store, (state) => {
    if (submissionTurnId === undefined) {
      return "awaiting-turn";
    }
    const turn = state.turnsById[submissionTurnId];
    if (turn === undefined) {
      return "awaiting-turn";
    }
    if (turn.status !== "running") {
      return "finished";
    }
    const groups = groupStoredTurnTimelineItems(
      state.itemIdsByTurnId[submissionTurnId] ?? [],
      state.itemStoresById,
    );
    return groups.some((group) => group.type === "assistant")
      ? "assistant-started"
      : "awaiting-assistant";
  });
  // HTTP 返回不代表回复已经可见；首个 Assistant Item 到达前由稳定尾部持续承载运行态。
  const showPendingSubmission =
    submissionStartedAt !== undefined &&
    (submissionHandoffState === "awaiting-turn" || submissionHandoffState === "awaiting-assistant");
  if (turnIds.length === 0 && !hasVisiblePendingRequest && !showPendingSubmission) {
    return (
      <TimelineState message={i18n.t("timeline.noHistory", { ns: "conversation" })} role="status" />
    );
  }
  const latestTurnId = turnIds.at(-1);

  return (
    <Conversation
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      conversationId={`${projectId}:${taskId}`}
      {...(scrollToBottomSignal === undefined ? {} : { scrollToBottomSignal })}
    >
      <ConversationVirtualList
        {...(hasVisiblePendingRequest || showPendingSubmission
          ? {
              footer: (
                <>
                  {hasVisiblePendingRequest ? (
                    <StorePendingRequestList
                      connected={connected}
                      onResolvePendingRequest={onResolvePendingRequest}
                      store={store}
                    />
                  ) : null}
                  {showPendingSubmission ? (
                    <Message from="assistant">
                      <TurnProcessingTime completedAt={null} startedAt={submissionStartedAt} />
                      <RunningReplyStatus />
                    </Message>
                  ) : null}
                </>
              ),
            }
          : {})}
        getItemKey={getTurnIdKey}
        items={turnIds}
        renderItem={(turnId, turnIndex) => (
          <StoreTurnTimelineSection
            canRollback={connected && canRollbackTurns && turnId === latestTurnId}
            {...(connected && turnId === latestTurnId && onBuildPlan !== undefined
              ? { onBuildPlan }
              : {})}
            {...(connected && turnId === latestTurnId && onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
            onRollbackTurn={onRollbackTurn}
            projectId={projectId}
            store={store}
            taskId={taskId}
            turnId={turnId}
            turnIndex={turnIndex}
            suppressEmptyRunningStatus={showPendingSubmission && turnId === submissionTurnId}
          />
        )}
      />
      <ConversationScrollButton />
    </Conversation>
  );
}
