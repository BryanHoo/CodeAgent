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
} from "../../../shared/ai-elements/attachments.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/ui/button.js";

import { LazyMessageResponse } from "../../../shared/ai-elements/lazy-message-response.js";
import { MessageContent, type MessageFileReference } from "../../../shared/ai-elements/message.js";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "../../../shared/ai-elements/plan.js";
import { Task, TaskContent, TaskItem, TaskTrigger } from "../../../shared/ai-elements/task.js";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "../../../shared/ai-elements/terminal.js";
import {
  Tool,
  ToolBody,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../../../shared/ai-elements/tool.js";
import { RETAINED_COMMAND_OUTPUT_MARKER } from "../../conversation/runtime/task-store.js";
import { MessageImageAttachment } from "./message-image-attachment.js";
import { SkillToken } from "./skill-token.js";
import { parseSubagentOperation } from "./subagent.js";

import type { BuildPlanAction } from "./task-timeline-contracts.js";
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
  onOpenSourceFile,
  projectId,
  taskId,
  turnStatus,
}: Readonly<{
  isLastTurnItem: boolean;
  item: AgentItem;
  onBuildPlan?: BuildPlanAction;
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
      // 原生 Reasoning 仅用于运行时状态同步，避免在界面暴露模型思维链。
      return null;
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
    case "file_change":
      // 文件变更统一在回复末尾聚合，避免工具流中重复展示同一组文件。
      return null;
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
          <ToolHeader state={toToolState(item.status)} title={item.name} />
          <ToolContent>
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
