import { buildTaskAttachmentUrl } from "@code-agent/client";
import type { AgentItem, AgentTurn } from "@code-agent/protocol";
import { FileText, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "../../../shared/components/agent/attachments.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/components/core/button.js";

import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
import {
  MessageContent,
  type MessageFileReference,
} from "../../../shared/components/agent/message.js";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "../../../shared/components/agent/plan.js";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../../shared/components/agent/reasoning.js";
import { Task, TaskContent, TaskItem, TaskTrigger } from "../../../shared/components/agent/task.js";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "../../../shared/components/agent/terminal.js";
import {
  Tool,
  ToolBody,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../../../shared/components/agent/tool.js";
import { RETAINED_COMMAND_OUTPUT_MARKER } from "../../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { MessageImageAttachment } from "./message-image-attachment.js";
import { SkillToken } from "./skill-token.js";
import { parseSubagentOperation } from "./subagent.js";

import type { BuildPlanAction } from "./task-timeline-contracts.js";
import { FileChangeButton } from "./task-timeline-file-changes.js";
import {
  ApprovalReviewItem,
  getCommandLabel,
  getReviewMessageText,
  resolveMessageResponseRendering,
} from "./task-timeline-running.js";
import {
  SubagentToolItem,
  formatStructuredValue,
  toTaskStatus,
  toToolState,
} from "./task-timeline-status.js";

// 覆盖 Streamdown 的 whitespace-normal，保留用户原文中的单换行和缩进。
const preservedUserMessageClassName = "whitespace-pre-wrap!";

export function TimelineItemContent({
  isLastTurnItem,
  item,
  onBuildPlan,
  onOpenFileDiff,
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onBuildPlan?: BuildPlanAction;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  taskId: string;
  turnStatus: AgentTurn["status"];
}>) {
  switch (item.type) {
    case "message": {
      const attachments = item.attachments ?? [];
      const skills = item.role === "user" ? (item.skills ?? []) : [];
      const responseRendering = resolveMessageResponseRendering({
        isLastTurnItem,
        role: item.role,
        turnStatus,
      });
      const hasTextContent = skills.length > 0 || item.text.length > 0;
      const messageBody = hasTextContent ? (
        <div>
          {skills.length === 0 ? null : (
            <span
              className="inline"
              aria-label={i18n.t("timeline.skillsUsed", { ns: "conversation" })}
            >
              {skills.map((skill) => (
                <SkillToken
                  className="relative top-1 me-1.5 bg-raised px-2 text-body leading-6"
                  data-message-skill={skill.name}
                  data-skill-token=""
                  key={skill.name}
                  name={skill.name}
                />
              ))}
            </span>
          )}
          {item.text.length === 0 ? null : (
            <LazyMessageResponse
              className={cn(
                skills.length > 0 && "inline [&>p:first-child]:inline",
                item.role === "user" && preservedUserMessageClassName,
              )}
              {...responseRendering}
              onOpenFileReference={onOpenSourceFile}
            >
              {item.text}
            </LazyMessageResponse>
          )}
        </div>
      ) : null;
      const attachmentBody =
        attachments.length === 0 ? null : (
          <Attachments
            className={`${item.role === "user" ? "justify-end" : "justify-start"} gap-2 px-0 pb-0`}
            aria-label={i18n.t("timeline.attachments", { ns: "conversation" })}
          >
            {attachments.map((attachment) => {
              const attachmentUrl = buildTaskAttachmentUrl("", projectId, taskId, attachment.id);
              if (attachment.kind === "image") {
                return (
                  <MessageImageAttachment
                    key={attachment.id}
                    name={attachment.name}
                    url={attachmentUrl}
                  />
                );
              }
              return (
                <a
                  aria-label={i18n.t("timeline.downloadAttachment", {
                    name: attachment.name,
                    ns: "conversation",
                  })}
                  className="block max-w-full rounded-control transition-opacity hover:opacity-90 focus-visible:shadow-focus"
                  data-message-attachment={attachment.kind}
                  download={attachment.name}
                  href={attachmentUrl}
                  key={attachment.id}
                >
                  <Attachment
                    className="h-12 max-w-64 pe-3 shadow-control"
                    data={{ ...attachment, previewUrl: attachmentUrl }}
                  >
                    <AttachmentPreview />
                    <AttachmentInfo />
                  </Attachment>
                </a>
              );
            })}
          </Attachments>
        );

      if (item.role === "assistant") {
        return (
          <MessageContent className="w-full">
            <div className="flex w-full flex-col items-start gap-2">
              {attachmentBody}
              {messageBody}
            </div>
          </MessageContent>
        );
      }

      return (
        // 确定横向可用空间，避免用户气泡在嵌套收缩容器中提前换行或截断。
        <div className="flex w-full flex-col items-end gap-2">
          {attachmentBody}
          {messageBody === null ? null : (
            <MessageContent data-message-text="true">{messageBody}</MessageContent>
          )}
        </div>
      );
    }
    case "review":
      return (
        <MessageContent>
          <p>{getReviewMessageText(item)}</p>
        </MessageContent>
      );
    case "reasoning":
      if (item.summary.trim().length === 0) {
        return null;
      }
      return (
        <Reasoning isStreaming={turnStatus === "running"}>
          <ReasoningTrigger
            title={i18n.t(
              turnStatus === "running" ? "timeline.reasoningStreaming" : "timeline.reasoning",
              { ns: "conversation" },
            )}
          />
          <ReasoningContent>
            {/* 仅渲染 Provider 明确提供的摘要，原始 content 永不进入展示组件。 */}
            <LazyMessageResponse mode={turnStatus === "running" ? "streaming" : "static"}>
              {item.summary}
            </LazyMessageResponse>
          </ReasoningContent>
        </Reasoning>
      );
    case "approval_review":
      return <ApprovalReviewItem item={item} />;
    case "command": {
      const commandLabel = getCommandLabel(item.command);
      const commandOutput =
        item.output === RETAINED_COMMAND_OUTPUT_MARKER
          ? i18n.t("timeline.outputRetained", { ns: "conversation" })
          : (item.output ?? item.cwd);
      const isStreamingCommand = turnStatus === "running" && item.status === "running";
      return (
        <Tool>
          <ToolHeader state={toToolState(item.status)} title={commandLabel} />
          <ToolBody>
            <Terminal isStreaming={isStreamingCommand} output={commandOutput}>
              <TerminalHeader>
                <TerminalTitle>{i18n.t("timeline.output", { ns: "conversation" })}</TerminalTitle>
                <TerminalActions>
                  <TerminalCopyButton />
                </TerminalActions>
              </TerminalHeader>
              <TerminalContent>
                {item.outputTruncated ? (
                  <p className="mt-2 text-warning">
                    {i18n.t("timeline.outputTruncated", { ns: "conversation" })}
                  </p>
                ) : null}
              </TerminalContent>
            </Terminal>
          </ToolBody>
        </Tool>
      );
    }
    case "file_change": {
      if (item.status === "completed") {
        // Turn 结束前立即展示已完成修改；Turn 终态继续由回复末尾统一聚合。
        return turnStatus === "running" ? (
          <div className="space-y-1">
            {item.changes.map((change) => (
              <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
            ))}
          </div>
        ) : null;
      }
      if (item.status !== "pending" && item.status !== "running") return null;
      return (
        <Task collapsible={item.changes.length > 0} status="in_progress">
          <TaskTrigger
            title={i18n.t("timeline.editingFiles", {
              count: item.changes.length,
              ns: "conversation",
            })}
          />
          {item.changes.length === 0 ? null : (
            <TaskContent>
              {item.changes.map((change) => (
                <TaskItem className="break-all font-mono" key={change.path}>
                  {change.path}
                </TaskItem>
              ))}
            </TaskContent>
          )}
        </Task>
      );
    }
    case "tool": {
      const subagentOperation = parseSubagentOperation(item);
      if (subagentOperation !== null) {
        return <SubagentToolItem item={item} operation={subagentOperation} />;
      }
      const hasErrorOutput =
        item.status === "failed" || item.status === "declined" || item.status === "interrupted";
      const errorText =
        hasErrorOutput && item.output !== undefined
          ? formatStructuredValue(item.output)
          : undefined;

      return (
        <Tool>
          <ToolHeader
            state={toToolState(item.status)}
            title={item.progress === undefined ? item.name : `${item.name} · ${item.progress}`}
          />
          <ToolContent>
            {item.progress === undefined ? null : (
              <p className="text-label leading-5 text-muted-foreground" role="status">
                {item.progress}
              </p>
            )}
            {item.input === undefined ? null : <ToolInput input={item.input} />}
            <ToolOutput errorText={errorText} output={hasErrorOutput ? undefined : item.output} />
          </ToolContent>
        </Tool>
      );
    }
    case "plan": {
      // Plan Item 没有独立状态；运行中 Turn 的最后一个 Item 即当前流式计划。
      const isStreamingPlan = turnStatus === "running" && isLastTurnItem;
      return (
        <Plan defaultOpen isStreaming={isStreamingPlan}>
          <PlanHeader>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FileText aria-hidden="true" className="size-4 shrink-0" />
                <PlanTitle>{i18n.t("timeline.plan", { ns: "conversation" })}</PlanTitle>
              </div>
              <PlanDescription>
                {isStreamingPlan
                  ? i18n.t("timeline.planGenerating", { ns: "conversation" })
                  : i18n.t("timeline.planReady", { ns: "conversation" })}
              </PlanDescription>
            </div>
            <PlanTrigger />
          </PlanHeader>
          <PlanContent>
            <LazyMessageResponse mode={isStreamingPlan ? "streaming" : "static"}>
              {item.text}
            </LazyMessageResponse>
          </PlanContent>
          {isStreamingPlan || onBuildPlan === undefined ? null : (
            <PlanFooter className="justify-end">
              <PlanAction>
                <BuildPlanButton onBuildPlan={onBuildPlan} />
              </PlanAction>
            </PlanFooter>
          )}
        </Plan>
      );
    }
    case "activity":
      return (
        <Task
          collapsible={item.detail !== undefined}
          status={toTaskStatus(item.status ?? "completed")}
        >
          <TaskTrigger title={item.label} />
          {item.detail === undefined ? null : (
            <TaskContent>
              <TaskItem>{item.detail}</TaskItem>
            </TaskContent>
          )}
        </Task>
      );
    case "runtime_status": {
      const status = toTaskStatus(item.status);
      if (item.kind === "safety_buffering") {
        return (
          <Task collapsible={item.fasterModel !== undefined} status={status}>
            <TaskTrigger
              title={i18n.t("timeline.runtimeStatus.safetyBuffering", {
                model: item.model,
                ns: "conversation",
              })}
            />
            {item.fasterModel === undefined ? null : (
              <TaskContent>
                <TaskItem>
                  {i18n.t("timeline.runtimeStatus.fasterModel", {
                    model: item.fasterModel,
                    ns: "conversation",
                  })}
                </TaskItem>
              </TaskContent>
            )}
          </Task>
        );
      }
      if (item.kind === "model_rerouted") {
        return (
          <Task collapsible={false} status={status}>
            <TaskTrigger
              title={i18n.t("timeline.runtimeStatus.modelRerouted", {
                fromModel: item.fromModel,
                ns: "conversation",
                toModel: item.toModel,
              })}
            />
          </Task>
        );
      }
      return (
        <Task
          collapsible={item.detail !== undefined || item.durationMs !== undefined}
          status={status}
        >
          <TaskTrigger
            title={i18n.t("timeline.runtimeStatus.hook", {
              eventName: item.eventName,
              ns: "conversation",
            })}
          />
          {item.detail === undefined && item.durationMs === undefined ? null : (
            <TaskContent>
              {item.detail === undefined ? null : <TaskItem>{item.detail}</TaskItem>}
              {item.durationMs === undefined ? null : (
                <TaskItem>
                  {i18n.t("timeline.runtimeStatus.duration", {
                    duration: item.durationMs,
                    ns: "conversation",
                  })}
                </TaskItem>
              )}
            </TaskContent>
          )}
        </Task>
      );
    }
  }
}

export function BuildPlanButton({ onBuildPlan }: Readonly<{ onBuildPlan: BuildPlanAction }>) {
  const [isBuilding, setIsBuilding] = useState(false);

  return (
    <Button
      disabled={isBuilding}
      onClick={() => {
        setIsBuilding(true);
        void onBuildPlan().then(
          (started) => {
            if (!started) {
              setIsBuilding(false);
            }
          },
          () => {
            setIsBuilding(false);
          },
        );
      }}
      type="button"
    >
      {isBuilding ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {i18n.t("timeline.buildPlan", { ns: "conversation" })}
    </Button>
  );
}
