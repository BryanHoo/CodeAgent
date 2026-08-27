import {
  ArrowUpIcon,
  BugIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleGaugeIcon,
  Code2Icon,
  FileCode2Icon,
  GitBranchIcon,
  LightbulbIcon,
  MessageSquareCodeIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PaperclipIcon,
  PencilIcon,
  ShieldCheckIcon,
  TargetIcon,
  XIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, Suspense, useRef, useState, type ReactNode } from "react";

import type { WorkbenchDispatch } from "@/app/app-shell";
import { getTask } from "@/app/workbench-data";
import type { WorkbenchState } from "@/app/workbench-state";
import {
  Conversation,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";

// 默认新聊天无需加载 Markdown、终端和工具视图，进入任务时间线时再按需下载。
const TaskTimeline = lazy(async () => {
  const module = await import("@/app/task-timeline");
  return { default: module.TaskTimeline };
});

type LocalMessage = Readonly<{ id: number; text: string }>;

export function ChatWorkspace({
  dispatch,
  state,
}: Readonly<{ dispatch: WorkbenchDispatch; state: WorkbenchState }>) {
  const task = getTask(state.selectedTaskId);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("GPT-5.6-Sol");
  const [approval, setApproval] = useState("从不询问");
  const [access, setAccess] = useState("完全访问");
  const [branch, setBranch] = useState("main");
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const [messages, setMessages] = useState<readonly LocalMessage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDraft = state.selectedTaskId === "draft";
  const title = isDraft ? "新聊天" : (task?.title ?? "CodeAgent 任务");

  const submit = () => {
    const text = prompt.trim();
    if (text.length === 0 && attachments.length === 0) return;
    setMessages((current) => [...current, { id: Date.now(), text: text || "检查已添加的附件" }]);
    setPrompt("");
    setAttachments([]);
  };

  return (
    <main aria-label="对话工作区" className="chat-workspace">
      <header className="workspace-toolbar">
        <div className="workspace-title">
          <Button aria-controls="task-sidebar" aria-expanded={state.sidebarOpen} aria-label={state.sidebarOpen ? "收起任务导航" : "展开任务导航"} onClick={() => dispatch({ type: "toggleSidebar" })} size="icon" title={state.sidebarOpen ? "收起任务导航" : "展开任务导航"} variant="ghost"><PanelLeftIcon aria-hidden="true" /></Button>
          <button className="task-title-button" onClick={() => !isDraft && dispatch({ dialog: "task", type: "openDialog" })} type="button"><span>{title}</span>{isDraft ? null : <PencilIcon aria-hidden="true" />}</button>
        </div>
        <div className="workspace-toolbar-actions">
          <ChoiceDropdown choices={["Zed", "Visual Studio Code", "Finder"]} onSelect={() => undefined} selected="Zed" trigger={<button className="editor-picker" data-size="compact" type="button"><Code2Icon aria-hidden="true" /><span>Zed</span><ChevronDownIcon aria-hidden="true" /></button>} />
          <Button aria-controls="workbench-inspector" aria-expanded={state.inspectorOpen} aria-label={state.inspectorOpen ? "收起检查器" : "展开检查器"} onClick={() => dispatch({ type: "toggleInspector" })} size="icon" title={state.inspectorOpen ? "收起检查器" : "展开检查器"} variant="ghost"><PanelRightIcon aria-hidden="true" /></Button>
        </div>
      </header>

      <Conversation className="conversation-canvas" aria-label="任务时间线">
        {isDraft && messages.length === 0 ? (
          <EmptyConversation />
        ) : (
          <Suspense fallback={<div className="timeline-loading">正在加载任务时间线...</div>}><TaskTimeline localMessages={messages} showReference={!isDraft} /></Suspense>
        )}
        <ConversationScrollButton />
      </Conversation>

      <section aria-label="任务输入" className="composer-region">
        <div className="composer-wrap">
          {prompt.startsWith("/") ? (
            <CommandMenu
              onSelect={(command) => {
                setPrompt(command);
                // 命令选择后恢复编辑焦点，保证后续键入和 Enter 提交连续生效。
                requestAnimationFrame(() => {
                  const input = document.querySelector<HTMLTextAreaElement>(
                    '[data-slot="prompt-input-textarea"]',
                  );
                  input?.focus();
                  input?.setSelectionRange(command.length, command.length);
                });
              }}
            />
          ) : null}
          <PromptInput className="workspace-composer" onSubmit={submit}>
            {attachments.length > 0 ? <div className="composer-attachments">{attachments.map((name) => <span key={name}><FileCode2Icon aria-hidden="true" />{name}<button aria-label={`移除 ${name}`} onClick={() => setAttachments((current) => current.filter((item) => item !== name))} type="button"><XIcon aria-hidden="true" /></button></span>)}</div> : null}
            <PromptInputBody>
              <PromptInputTextarea onChange={(event) => setPrompt(event.currentTarget.value)} placeholder={isDraft ? "告诉 CodeAgent 你想完成什么" : "输入后续要求"} rows={3} value={prompt} />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <input className="sr-only" multiple onChange={(event) => setAttachments(Array.from(event.currentTarget.files ?? []).map((file) => file.name))} ref={fileInputRef} type="file" />
                <PromptInputButton aria-label="添加附件" onClick={() => fileInputRef.current?.click()} tooltip="添加附件"><PaperclipIcon aria-hidden="true" /></PromptInputButton>
                <ChoiceDropdown choices={["按需审批", "自动审核", "从不询问"]} onSelect={setApproval} selected={approval} trigger={<button className="composer-option" type="button"><span>{approval}</span><ChevronDownIcon aria-hidden="true" /></button>} />
                <ChoiceDropdown choices={["只读", "工作区可写", "完全访问"]} onSelect={setAccess} selected={access} trigger={<button className="composer-option" type="button"><ShieldCheckIcon aria-hidden="true" /><span>{access}</span><ChevronDownIcon aria-hidden="true" /></button>} />
              </PromptInputTools>
              <div className="composer-actions">
                <ChoiceDropdown choices={["GPT-5.6-Sol", "GPT-5.6-Terra", "GPT-5.6-Luna"]} onSelect={setModel} selected={model} trigger={<button className="composer-option" type="button"><span>{model}</span><span className="model-effort">高</span><ChevronDownIcon aria-hidden="true" /></button>} />
                <PromptInputSubmit aria-label="发送消息" disabled={prompt.trim().length === 0 && attachments.length === 0} title="发送消息" type="submit"><ArrowUpIcon aria-hidden="true" /></PromptInputSubmit>
              </div>
            </PromptInputFooter>
          </PromptInput>
          <div className="workspace-context" aria-label="工作区上下文">
            <ChoiceDropdown align="start" choices={["main", "feat/workbench", "develop"]} onSelect={setBranch} selected={branch} side="top" trigger={<button type="button"><GitBranchIcon aria-hidden="true" /><span>{branch}</span><ChevronDownIcon aria-hidden="true" /></button>} />
            <span className="context-path">~/Develop/person/CodeAgent</span><span className="context-sync"><CheckIcon aria-hidden="true" />已同步</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function EmptyConversation() {
  return <div className="empty-conversation"><MessageSquareCodeIcon aria-hidden="true" /><h1>我们应该在 CodeAgent 中做些什么？</h1><p>选择一个项目，或直接描述要完成的开发任务。</p></div>;
}

function ChoiceDropdown({ align = "end", choices, onSelect, selected, side = "bottom", trigger }: Readonly<{ align?: "end" | "start"; choices: readonly string[]; onSelect: (value: string) => void; selected: string; side?: "bottom" | "top"; trigger: ReactNode }>) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align={align} className="choice-menu" side={side} sideOffset={6}>{choices.map((choice) => <DropdownMenu.Item className="choice-menu-item" key={choice} onSelect={() => onSelect(choice)}><span>{choice}</span>{choice === selected ? <CheckIcon aria-hidden="true" /> : null}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

function CommandMenu({ onSelect }: Readonly<{ onSelect: (command: string) => void }>) {
  const commands = [{ icon: BugIcon, label: "/review", text: "审查当前更改" }, { icon: LightbulbIcon, label: "/plan", text: "制定实现计划" }, { icon: TargetIcon, label: "/goal", text: "建立持续目标" }, { icon: CircleGaugeIcon, label: "/compact", text: "压缩对话上下文" }];
  return <div className="command-menu" role="listbox" aria-label="命令"><div className="command-menu-heading">命令</div>{commands.map(({ icon: Icon, label, text }) => <button key={label} onClick={() => onSelect(`${label} `)} role="option" type="button"><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{text}</small></span></button>)}</div>;
}
