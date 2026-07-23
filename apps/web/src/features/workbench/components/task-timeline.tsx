import type { AgentItemStatus, AgentTaskSnapshot } from "@code-agent/protocol";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react";

import {
  taskSnapshotQueryOptions,
  type CodeAgentReadClient,
} from "../../projects/project-queries.js";
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

type TaskTimelineProps = Readonly<{
  client: CodeAgentReadClient;
  projectName: string;
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

export function TaskTimeline({ client, projectName, taskId }: TaskTimelineProps) {
  const taskQuery = useQuery({
    ...taskSnapshotQueryOptions(taskId ?? "", client),
    enabled: taskId !== undefined,
  });

  if (taskId === undefined) {
    return <EmptyTimeline projectName={projectName} />;
  }
  if (taskQuery.isPending) {
    return <TimelineState message="正在加载任务历史" role="status" />;
  }
  if (taskQuery.error !== null) {
    return <TimelineState message="无法加载任务历史" role="alert" />;
  }
  return <TaskSnapshotTimeline snapshot={taskQuery.data} />;
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

export function TaskSnapshotTimeline({ snapshot }: Readonly<{ snapshot: AgentTaskSnapshot }>) {
  if (snapshot.turns.length === 0) {
    return <TimelineState message="此任务暂无历史" role="status" />;
  }

  return (
    <Conversation aria-label="会话内容">
      <ConversationContent>
        {snapshot.turns.map((turn, turnIndex) => (
          <section aria-label={`Turn ${String(turnIndex + 1)}`} className="space-y-3" key={turn.id}>
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
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
