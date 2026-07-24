import type { AgentItemStatus, PendingRequest } from "@code-agent/protocol";
import { FilePenLine, FolderGit2 } from "lucide-react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { countFileChangeLines, getFileName, type AgentFileChange } from "../../diff/file-change.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../../shared/ai-elements/conversation.js";
import { Message, MessageContent, MessageResponse } from "../../../shared/ai-elements/message.js";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../../shared/ai-elements/reasoning.js";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolStatus,
} from "../../../shared/ai-elements/tool.js";
import { PendingRequestCard, type PendingRequestResolution } from "./pending-request.js";

type TaskTimelineProps = Readonly<{
  onOpenFileDiff?: (change: AgentFileChange) => void;
  projectName: string;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  runtime?: TaskRuntimeView;
  taskId?: string;
}>;

function EmptyTimeline({ projectName }: Readonly<{ projectName: string }>) {
  return (
    <section className="grid min-h-0 flex-1 place-items-center px-6" aria-label="会话内容">
      <div className="max-w-sm text-center">
        <FolderGit2 className="mx-auto size-9 text-muted-foreground" strokeWidth={1.4} />
        <h2 className="mt-4 text-base font-semibold text-foreground">{projectName}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">选择一个任务查看历史。</p>
      </div>
    </section>
  );
}

function TimelineState({
  message,
  role,
}: Readonly<{ message: string; role?: "alert" | "status" }>) {
  return (
    <section
      aria-label="会话内容"
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </section>
  );
}

export function TaskTimeline({
  onOpenFileDiff,
  onResolvePendingRequest,
  projectName,
  runtime,
  taskId,
}: TaskTimelineProps) {
  if (taskId === undefined) {
    return <EmptyTimeline projectName={projectName} />;
  }
  if (runtime === undefined) {
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  return (
    <ActiveTaskTimeline
      onOpenFileDiff={onOpenFileDiff ?? (() => undefined)}
      onResolvePendingRequest={onResolvePendingRequest ?? (() => Promise.resolve())}
      runtime={runtime}
    />
  );
}

function ActiveTaskTimeline({
  onOpenFileDiff,
  onResolvePendingRequest,
  runtime,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  runtime: TaskRuntimeView;
}>) {
  if (runtime.error !== null) {
    return <TimelineState message="无法加载任务历史" role="alert" />;
  }
  if (runtime.isPending || runtime.snapshot === undefined) {
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  return (
    <>
      {runtime.connectionState === "reconnecting" ? (
        <div
          className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
          role="status"
        >
          实时连接恢复中
        </div>
      ) : null}
      <TaskSnapshotTimeline
        connected={runtime.connectionState === "connected"}
        onOpenFileDiff={onOpenFileDiff}
        onResolvePendingRequest={onResolvePendingRequest}
        snapshot={runtime.snapshot}
      />
    </>
  );
}

function toToolStatus(status: AgentItemStatus): ToolStatus {
  if (status === "pending" || status === "running") {
    return "running";
  }
  if (status === "failed" || status === "declined" || status === "interrupted") {
    return "failed";
  }
  return "completed";
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function extractReasoningSteps(summary: string): string[] {
  const emphasizedSteps = [...summary.matchAll(/\*\*([^*\n]+)\*\*/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((step) => step.length > 0);

  if (emphasizedSteps.length > 0) {
    return emphasizedSteps;
  }

  return summary
    .split(/\n+/)
    .map((step) =>
      step
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+]\s+/, ""),
    )
    .filter((step) => step.length > 0);
}

const fileChangeOperationLabels: Readonly<Record<AgentFileChange["kind"], string>> = {
  create: "已创建",
  delete: "已删除",
  update: "已编辑",
};

function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const operationLabel = fileChangeOperationLabels[change.kind];
  const { additions, removals } = countFileChangeLines(change);

  return (
    <button
      aria-haspopup="dialog"
      aria-label={`${operationLabel} ${fileName}，新增 ${String(additions)} 行，删除 ${String(removals)} 行，打开 Diff`}
      className="flex min-h-9 w-full items-center gap-2 rounded-control bg-control px-2.5 text-left text-label text-foreground transition-colors hover:bg-control-hover"
      data-file-change={change.kind}
      onClick={() => {
        onOpen(change);
      }}
      type="button"
    >
      <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{operationLabel}</span>
      <span className="min-w-0 truncate font-medium" title={change.path}>
        {fileName}
      </span>
      <span className="ml-auto shrink-0 text-diff-added">+{additions}</span>
      <span className="shrink-0 text-diff-removed">-{removals}</span>
    </button>
  );
}

export function TaskSnapshotTimeline({
  connected = true,
  onOpenFileDiff = () => undefined,
  onResolvePendingRequest = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  connected?: boolean;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onResolvePendingRequest?: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  snapshot: RuntimeTaskSnapshot;
}>) {
  if (snapshot.turns.length === 0 && snapshot.pendingRequests.length === 0) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }
  const firstPendingIndex = snapshot.pendingRequests.findIndex(
    (candidate) => candidate.status === "pending",
  );

  return (
    <Conversation aria-label="会话内容">
      <ConversationContent>
        {snapshot.turns.map((turn, turnIndex) => (
          <section
            aria-label={`Turn ${String(turnIndex + 1)}`}
            className="space-y-3"
            data-status={turn.status}
            key={turn.id}
          >
            {turn.error === null ? null : (
              <div
                className="rounded-surface bg-control px-3 py-2 text-label leading-5 text-danger"
                role="alert"
              >
                <p className="font-medium">Turn 执行失败</p>
                <p className="mt-1">{turn.error}</p>
              </div>
            )}
            {turn.items.map((item, itemIndex) => {
              switch (item.type) {
                case "message":
                  return (
                    <Message from={item.role} key={item.id}>
                      <MessageContent className={item.role === "assistant" ? "w-full" : ""}>
                        <MessageResponse>{item.text}</MessageResponse>
                      </MessageContent>
                    </Message>
                  );
                case "reasoning": {
                  const reasoningSteps = extractReasoningSteps(item.summary);
                  const reasoningTitle = reasoningSteps.at(-1) ?? "推理";
                  const trimmedReasoningContent = item.content.trim();
                  const contentRepeatsSummary =
                    trimmedReasoningContent.length > 0 &&
                    extractReasoningSteps(trimmedReasoningContent).join("\n") ===
                      reasoningSteps.join("\n");
                  const reasoningContent =
                    trimmedReasoningContent.length > 0 && !contentRepeatsSummary
                      ? trimmedReasoningContent
                      : reasoningSteps.length > 1
                        ? item.summary
                        : "";
                  const isStreamingReasoning =
                    turn.status === "running" && itemIndex === turn.items.length - 1;
                  const hasReasoningContent = reasoningContent.length > 0;

                  return (
                    <Reasoning
                      collapsible={hasReasoningContent}
                      isStreaming={isStreamingReasoning}
                      key={item.id}
                    >
                      <ReasoningTrigger expandable={hasReasoningContent}>
                        {reasoningTitle}
                      </ReasoningTrigger>
                      <ReasoningContent>{reasoningContent}</ReasoningContent>
                    </Reasoning>
                  );
                }
                case "command":
                  return (
                    <Tool key={item.id}>
                      <ToolHeader status={toToolStatus(item.status)}>{item.command}</ToolHeader>
                      <ToolContent>
                        <pre className="whitespace-pre-wrap">{item.output ?? item.cwd}</pre>
                        {item.outputTruncated ? (
                          <p className="mt-2 text-warning">输出已截断，仅显示最新内容。</p>
                        ) : null}
                      </ToolContent>
                    </Tool>
                  );
                case "file_change":
                  return (
                    <div className="space-y-1" data-status={item.status} key={item.id}>
                      {item.changes.map((change, changeIndex) => (
                        <FileChangeButton
                          change={change}
                          key={`${change.path}:${String(changeIndex)}`}
                          onOpen={onOpenFileDiff}
                        />
                      ))}
                    </div>
                  );
                case "tool":
                  return (
                    <Tool key={item.id}>
                      <ToolHeader status={toToolStatus(item.status)}>{item.name}</ToolHeader>
                      <ToolContent>
                        <pre className="whitespace-pre-wrap">
                          {[item.input, item.output]
                            .filter((value) => value !== undefined)
                            .map(formatStructuredValue)
                            .join("\n")}
                        </pre>
                      </ToolContent>
                    </Tool>
                  );
                case "plan":
                  return (
                    <Tool defaultOpen key={item.id}>
                      <ToolHeader status="completed">计划</ToolHeader>
                      <ToolContent>
                        <pre className="whitespace-pre-wrap">{item.text}</pre>
                      </ToolContent>
                    </Tool>
                  );
                case "activity":
                  return (
                    <Tool key={item.id}>
                      <ToolHeader status={toToolStatus(item.status ?? "completed")}>
                        {item.label}
                      </ToolHeader>
                      {item.detail === undefined ? null : <ToolContent>{item.detail}</ToolContent>}
                    </Tool>
                  );
              }
            })}
          </section>
        ))}
        {snapshot.pendingRequests.map((request, index) => {
          // 只开放队首未解决请求，避免并发响应改变 Provider 的请求顺序。
          return (
            <PendingRequestCard
              interactive={connected && request.status === "pending" && index === firstPendingIndex}
              key={request.requestId}
              onResolve={onResolvePendingRequest}
              request={request}
            />
          );
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
