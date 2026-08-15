import type { PendingRequest } from "@code-agent/protocol";
import { AlertTriangle, Info } from "lucide-react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";

import {
  Conversation,
  ConversationScrollButton,
  ConversationVirtualList,
} from "../../../shared/components/agent/conversation.js";
import { Message, type MessageFileReference } from "../../../shared/components/agent/message.js";
import type { TaskNotice, TaskStore } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

import type { BuildPlanAction, ForkTaskAction } from "./task-timeline-contracts.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import { groupStoredTurnTimelineItems } from "./task-timeline-store-items.js";
import { StoreTurnTimelineSection } from "./task-timeline-store-turn.js";
import { TimelineState, TurnProcessingTime } from "./task-timeline-status.js";

const getTurnIdKey = (turnId: string) => turnId;

function TaskNoticeRow({ notice }: Readonly<{ notice: TaskNotice }>) {
  const isWarning = notice.payload.level === "warning";
  const message =
    notice.payload.code === "model_verification"
      ? i18n.t("timeline.notice.modelVerification", { ns: "conversation" })
      : notice.payload.message;
  const title = i18n.t(`timeline.notice.${notice.payload.code}`, { ns: "conversation" });

  return (
    <div
      className={`flex items-start gap-2 border-l-2 px-3 py-2 text-label leading-5 ${
        isWarning ? "border-warning text-warning" : "border-separator-strong text-muted-foreground"
      }`}
      role={isWarning ? "alert" : "status"}
    >
      {isWarning ? (
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="break-words">{message}</p>
      </div>
    </div>
  );
}

export function StoreTaskNoticeList({ store }: Readonly<{ store: TaskStore }>) {
  const notices = useStore(store, (state) => state.notices);
  return notices.map((notice) => (
    <TaskNoticeRow key={`${notice.sessionId}:${String(notice.sequence)}`} notice={notice} />
  ));
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
  connected,
  onBuildPlan,
  onForkTask,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
  onResolvePendingRequest,
  scrollToBottomSignal,
  store,
  submissionStartedAt,
  submissionTurnId,
}: Readonly<{
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
  const notices = useStore(store, (state) => state.notices);
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
    const groups = groupStoredTurnTimelineItems(
      state.itemIdsByTurnId[submissionTurnId] ?? [],
      state.itemStoresById,
    );
    if (groups.some((group) => group.type === "assistant")) {
      return "assistant-started";
    }
    // completed Snapshot 可能先于 Assistant Item 落盘，只有失败或中断才能提前结束本地提交态。
    return turn.status === "failed" || turn.status === "interrupted"
      ? "finished"
      : "awaiting-assistant";
  });
  // HTTP 返回不代表回复已经可见；首个 Assistant Item 到达前由稳定尾部持续承载运行态。
  const showPendingSubmission =
    submissionStartedAt !== undefined &&
    (submissionHandoffState === "awaiting-turn" || submissionHandoffState === "awaiting-assistant");
  const hasNotices = notices.length > 0;
  if (turnIds.length === 0 && !hasVisiblePendingRequest && !showPendingSubmission && !hasNotices) {
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
        {...(hasVisiblePendingRequest || showPendingSubmission || hasNotices
          ? {
              footer: (
                <>
                  {hasNotices ? <StoreTaskNoticeList store={store} /> : null}
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
            {...(connected && turnId === latestTurnId && onBuildPlan !== undefined
              ? { onBuildPlan }
              : {})}
            {...(connected && turnId === latestTurnId && onForkTask !== undefined
              ? { onForkTask }
              : {})}
            onOpenFileDiff={onOpenFileDiff}
            onOpenSourceFile={onOpenSourceFile}
            onReviewFileChanges={onReviewFileChanges}
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
