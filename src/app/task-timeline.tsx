import { CheckIcon, FilePenLineIcon, ImageIcon, SparklesIcon } from "lucide-react";

import { ConversationVirtualList } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageCopyButton, MessageHeader, MessageMeta } from "@/components/ai-elements/message";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { Plan, PlanContent, PlanHeader, PlanItem } from "@/components/ai-elements/plan";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Terminal, TerminalContent, TerminalHeader } from "@/components/ai-elements/terminal";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";

type TimelineItem =
  | Readonly<{ id: string; kind: "assistant"; text: string }>
  | Readonly<{ id: string; kind: "local"; text: string }>
  | Readonly<{ id: string; kind: "tool-group" }>
  | Readonly<{ id: string; kind: "user"; text: string }>;

const REFERENCE_ITEMS: readonly TimelineItem[] = [
  {
    id: "user-1",
    kind: "user",
    text: "读取 Codexly 项目的 Web 工作台，将其前端功能、交互和设计完整借鉴到 CodeAgent，不包含后端 API 逻辑。",
  },
  {
    id: "assistant-1",
    kind: "assistant",
    text: "我会以正在运行的 Codexly 页面为视觉与交互基准，迁移其 **AI Elements**、三栏布局、任务导航、输入编排器和检查器。",
  },
  { id: "tools-1", kind: "tool-group" },
  {
    id: "assistant-2",
    kind: "assistant",
    text: "工作台已改为组件级迁移：消息由 Streamdown 渲染，工具输出按需挂载，长对话使用虚拟滚动，终端保留 ANSI 颜色。",
  },
];

export function TaskTimeline({
  localMessages,
  showReference,
}: Readonly<{
  localMessages: readonly Readonly<{ id: number; text: string }>[];
  showReference: boolean;
}>) {
  const items: readonly TimelineItem[] = [
    ...(showReference ? REFERENCE_ITEMS : []),
    ...localMessages.map((message): TimelineItem => ({ id: `local-${String(message.id)}`, kind: "local", text: message.text })),
  ];
  return (
    <ConversationVirtualList
      estimateSize={(item) => item.kind === "tool-group" ? 420 : item.kind === "user" ? 100 : 180}
      getItemKey={(item) => item.id}
      items={items}
      renderItem={(item) => <TimelineEntry item={item} />}
    />
  );
}

function TimelineEntry({ item }: Readonly<{ item: TimelineItem }>) {
  if (item.kind === "user") {
    return <Message from="user"><MessageContent>{item.text}</MessageContent><MessageMeta>16:12</MessageMeta></Message>;
  }
  if (item.kind === "tool-group") return <ToolGroup />;
  if (item.kind === "local") {
    return <div className="ai-turn"><Message from="user"><MessageContent>{item.text}</MessageContent></Message><Message from="assistant"><MessageHeader><SparklesIcon aria-hidden="true" /><strong>CodeAgent</strong></MessageHeader><Reasoning defaultOpen isStreaming><ReasoningTrigger isStreaming>正在处理</ReasoningTrigger><ReasoningContent>正在分析本地演示请求并组织回复。</ReasoningContent></Reasoning></Message></div>;
  }
  return <Message from="assistant"><MessageHeader><SparklesIcon aria-hidden="true" /><strong>CodeAgent</strong><MessageCopyButton text={item.text} /></MessageHeader><MessageContent><MessageResponse>{item.text}</MessageResponse></MessageContent></Message>;
}

function ToolGroup() {
  return (
    <div className="ai-turn ai-tool-group">
      <Reasoning defaultOpen><ReasoningTrigger>已处理 19m 13s</ReasoningTrigger><ReasoningContent>先检查真实工作台源码与依赖，再按前端边界拆分迁移。</ReasoningContent></Reasoning>
      <Tool defaultOpen><ToolHeader state="output-available" title="读取工作台组件" /><ToolContent><ToolInput input={{ path: "apps/web/src/features/workbench" }} /><ToolOutput output={<div className="ai-file-result"><FilePenLineIcon aria-hidden="true" /><span>已读取 42 个组件文件</span><small>完成</small></div>} /></ToolContent></Tool>
      <Tool><ToolHeader state="output-available" title="命令执行完成：3 条" /><ToolContent><Terminal><TerminalHeader command="pnpm check:web" /><TerminalContent output={'\u001b[32m✓\u001b[0m typecheck\n\u001b[32m✓\u001b[0m tests\n\u001b[32m✓\u001b[0m build'} /></Terminal></ToolContent></Tool>
      <div className="ai-file-change"><FilePenLineIcon aria-hidden="true" /><div><strong>已编辑 chat-workspace.tsx</strong><span>使用 AI Elements 重建消息时间线</span></div><b>+16</b><i>−1</i></div>
      <Plan defaultOpen><PlanHeader title="实现计划"><small>3 / 4</small></PlanHeader><PlanContent><PlanItem status="completed">建立全局设计 tokens</PlanItem><PlanItem status="completed">迁移 AI Elements 组件</PlanItem><PlanItem status="completed">重建工作台交互</PlanItem><PlanItem status="in-progress">对照真实页面完成视觉验收</PlanItem></PlanContent></Plan>
      <button className="ai-image-row" type="button"><CheckIcon aria-hidden="true" /><span>查看图片</span><ImageIcon aria-hidden="true" /></button>
    </div>
  );
}
