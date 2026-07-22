import { Check, Copy, FolderGit2, RefreshCcw } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../../shared/ai-elements/conversation.js";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "../../../shared/ai-elements/message.js";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../../shared/ai-elements/reasoning.js";
import { Tool, ToolContent, ToolHeader } from "../../../shared/ai-elements/tool.js";

type ThreadTimelineProps = Readonly<{
  hasThread: boolean;
  workspaceId: string;
}>;

export function ThreadTimeline({ hasThread, workspaceId }: ThreadTimelineProps) {
  if (!hasThread) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center px-6" aria-label="会话内容">
        <div className="max-w-sm text-center">
          <FolderGit2 className="mx-auto size-9 text-muted-foreground" strokeWidth={1.4} />
          <h2 className="mt-4 text-base font-semibold text-foreground">{workspaceId}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            连接本地 Runtime 后即可创建任务。
          </p>
        </div>
      </section>
    );
  }

  return (
    <Conversation aria-label="会话内容">
      <ConversationContent>
        <Message from="user">
          <MessageContent>
            <MessageResponse>
              参考 Codex App 和 Cursor 工作台，使用 AI Elements 统一设计语言，完成 macOS
              原生风格的三栏工作台页面。
            </MessageResponse>
          </MessageContent>
        </Message>

        <div className="my-5 flex items-center gap-3 text-meta text-muted-foreground">
          <span className="font-medium">已处理 1m 24s</span>
          <span className="h-px flex-1 bg-separator" />
        </div>

        <div className="relative space-y-3 pl-5 before:absolute before:bottom-3 before:left-1.5 before:top-3 before:w-px before:bg-separator">
          <span className="absolute left-0.5 top-2 size-2 rounded-pill bg-accent shadow-timeline-node" />
          <Reasoning defaultOpen>
            <ReasoningTrigger>分析工作台信息架构</ReasoningTrigger>
            <ReasoningContent>
              保留任务导航、结构化 Agent 时间线与上下文检查器，并让 Composer 始终稳定在主区底部。
            </ReasoningContent>
          </Reasoning>

          <Tool>
            <ToolHeader status="completed">读取 Web 设计规范</ToolHeader>
            <ToolContent>
              docs/web-design.md{"\n"}.superwork/spec/frontend/component-guidelines.md
            </ToolContent>
          </Tool>

          <Tool>
            <ToolHeader status="completed">检查工作台组件</ToolHeader>
            <ToolContent>
              apps/web/src/features/workbench/components/workbench-shell.tsx
            </ToolContent>
          </Tool>
        </div>

        <Message className="mt-5" from="assistant">
          <MessageContent className="w-full">
            <MessageResponse>
              <p>工作台界面已按统一的 AI Elements 结构重新组织。</p>
              <div className="mt-4 space-y-2.5">
                {[
                  "使用高密度三栏布局，侧栏与上下文面板均可独立收起。",
                  "将推理、工具调用和回复串联为连续工作轨迹。",
                  "Composer 保留附件、模型和提交控制，并明确离线状态。",
                  "窄屏切换为覆盖式面板，主时间线不被压缩或遮挡。",
                ].map((item) => (
                  <div className="flex items-start gap-2.5" key={item}>
                    <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-pill bg-accent-soft text-accent-strong">
                      <Check className="size-2.5" aria-hidden="true" />
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </MessageResponse>
            <MessageActions>
              <MessageAction label="复制回复">
                <Copy className="size-3.5" aria-hidden="true" />
              </MessageAction>
              <MessageAction disabled label="重新生成">
                <RefreshCcw className="size-3.5" aria-hidden="true" />
              </MessageAction>
              <span className="ml-1 text-caption text-muted-foreground">刚刚</span>
            </MessageActions>
          </MessageContent>
        </Message>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
