import type { AgentItemStatus, PendingRequest } from "@code-agent/protocol";
import { FolderGit2 } from "lucide-react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
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
      onResolvePendingRequest={onResolvePendingRequest ?? (() => Promise.resolve())}
      runtime={runtime}
    />
  );
}

function ActiveTaskTimeline({
  onResolvePendingRequest,
  runtime,
}: Readonly<{
  onResolvePendingRequest: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
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

export function TaskSnapshotTimeline({
  connected = true,
  onResolvePendingRequest = () => Promise.resolve(),
  snapshot,
}: Readonly<{
  connected?: boolean;
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
            {turn.items.map((item) => {
              switch (item.type) {
                case "message":
                  return (
                    <Message from={item.role} key={item.id}>
                      <MessageContent className={item.role === "assistant" ? "w-full" : ""}>
                        <MessageResponse>{item.text}</MessageResponse>
                      </MessageContent>
                    </Message>
                  );
                case "reasoning":
                  return (
                    <Reasoning defaultOpen key={item.id}>
                      <ReasoningTrigger>{item.summary || "推理"}</ReasoningTrigger>
                      <ReasoningContent>{item.content}</ReasoningContent>
                    </Reasoning>
                  );
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
                    <Tool key={item.id}>
                      <ToolHeader status={toToolStatus(item.status)}>文件变更</ToolHeader>
                      <ToolContent>
                        <pre className="whitespace-pre-wrap">
                          {item.changes
                            .map((change) => `${change.path}\n${change.diff}`)
                            .join("\n\n")}
                        </pre>
                      </ToolContent>
                    </Tool>
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
