import {
  ArrowUpIcon,
  ChevronDownIcon,
  Code2Icon,
  GitBranchIcon,
  MessageSquareCodeIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PaperclipIcon,
  ShieldCheckIcon,
} from "lucide-react";

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

type ChatWorkspaceProps = {
  isProjectPanelOpen: boolean;
  isTaskSidebarOpen: boolean;
  onToggleProjectPanel: () => void;
  onToggleTaskSidebar: () => void;
};

export function ChatWorkspace({
  isProjectPanelOpen,
  isTaskSidebarOpen,
  onToggleProjectPanel,
  onToggleTaskSidebar,
}: ChatWorkspaceProps) {
  return (
    <section className="chat-workspace" aria-label="对话工作区">
      <header className="workspace-toolbar">
        <div className="workspace-title">
          <Button
            aria-controls="task-sidebar"
            aria-expanded={isTaskSidebarOpen}
            aria-label={isTaskSidebarOpen ? "收起任务导航" : "展开任务导航"}
            onClick={onToggleTaskSidebar}
            size="icon"
            title={isTaskSidebarOpen ? "收起任务导航" : "展开任务导航"}
            variant="ghost"
          >
            <PanelLeftIcon aria-hidden="true" />
          </Button>
          <span>新聊天</span>
        </div>
        <div className="workspace-toolbar-actions">
          <button className="editor-picker" data-size="compact" type="button">
            <Code2Icon aria-hidden="true" />
            <span>Zed</span>
            <ChevronDownIcon aria-hidden="true" />
          </button>
          <Button
            aria-controls="project-panel"
            aria-expanded={isProjectPanelOpen}
            aria-label={isProjectPanelOpen ? "收起项目面板" : "展开项目面板"}
            onClick={onToggleProjectPanel}
            size="icon"
            title={isProjectPanelOpen ? "收起项目面板" : "展开项目面板"}
            variant="ghost"
          >
            <PanelRightIcon aria-hidden="true" />
          </Button>
        </div>
      </header>

      <main className="conversation-canvas">
        <div className="empty-conversation">
          <div className="conversation-mark" aria-hidden="true">
            <MessageSquareCodeIcon />
          </div>
          <h1>我们应该在 CodeAgent 中做些什么？</h1>
        </div>
      </main>

      <div className="composer-region">
        <PromptInput className="workspace-composer">
          <PromptInputBody>
            <PromptInputTextarea placeholder="向 CodeAgent 描述任务" rows={3} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton aria-label="添加附件" tooltip="添加附件">
                <PaperclipIcon aria-hidden="true" />
              </PromptInputButton>
              <button className="access-control" type="button">
                <ShieldCheckIcon aria-hidden="true" />
                <span>完整访问</span>
                <ChevronDownIcon aria-hidden="true" />
              </button>
            </PromptInputTools>
            <div className="composer-actions">
              <button className="model-picker" type="button">
                <span>GPT-5.6-Sol</span>
                <span className="model-effort">高</span>
                <ChevronDownIcon aria-hidden="true" />
              </button>
              <PromptInputSubmit aria-label="发送消息" title="发送消息">
                <ArrowUpIcon aria-hidden="true" />
              </PromptInputSubmit>
            </div>
          </PromptInputFooter>
        </PromptInput>

        <div className="workspace-context" aria-label="工作区上下文">
          <button type="button">
            <GitBranchIcon aria-hidden="true" />
            <span>main</span>
            <ChevronDownIcon aria-hidden="true" />
          </button>
          <span className="context-path">~/Develop/person/CodeAgent</span>
          <span className="context-sync" aria-label="同步完成" />
        </div>
      </div>
    </section>
  );
}
