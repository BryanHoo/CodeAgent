import { useEffect, useState } from "react";
import { Ellipsis, ExternalLink, PanelLeft, PanelRight, WifiOff } from "lucide-react";

import { IconButton } from "../../../shared/ui/icon-button.js";
import { ThreadSidebar } from "./thread-sidebar.js";
import { ThreadTimeline } from "./thread-timeline.js";
import { WorkbenchComposer } from "./workbench-composer.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

const threadTitles: Record<string, string> = {
  "input-design": "优化输入框交互",
  markdown: "完善 Markdown 渲染",
  "model-api": "接入模型选择 API",
  "thread-1": "构建 macOS 工作台",
};

type WorkbenchShellProps = Readonly<{
  threadId?: string;
  workspaceId: string;
}>;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

function getThreadTitle(threadId?: string) {
  if (threadId === undefined) {
    return "新任务";
  }
  return threadTitles[threadId] ?? threadId;
}

export function WorkbenchShell({ threadId, workspaceId }: WorkbenchShellProps) {
  // 窄屏首次进入时保持主时间线可见，面板由工具栏按需打开。
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    shouldOpenDesktopPanel("(max-width: 760px)"),
  );
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    shouldOpenDesktopPanel("(max-width: 1100px)"),
  );
  const hasThread = threadId !== undefined;
  const title = getThreadTitle(threadId);

  const closeSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-sidebar-toggle")?.focus();
    });
  };

  const closeInspector = () => {
    setInspectorOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-inspector-toggle")?.focus();
    });
  };

  useEffect(() => {
    // Escape 统一关闭覆盖面板，避免键盘用户被窄屏抽屉困住。
    const closePanels = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setInspectorOpen(false);
      }
    };

    window.addEventListener("keydown", closePanels);
    return () => {
      window.removeEventListener("keydown", closePanels);
    };
  }, []);

  return (
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-canvas"
      data-inspector-open={inspectorOpen}
      data-sidebar-open={sidebarOpen}
    >
      <ThreadSidebar
        onClose={closeSidebar}
        workspaceId={workspaceId}
        {...(threadId === undefined ? {} : { threadId })}
      />

      {sidebarOpen ? (
        <button
          aria-label="关闭任务侧栏"
          className="workbench-sidebar-scrim"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}

      <main aria-label="Thread Timeline" className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-2.5 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              id="workbench-sidebar-toggle"
              label={sidebarOpen ? "收起任务侧栏" : "展开任务侧栏"}
              onClick={() => {
                setSidebarOpen((open) => !open);
              }}
              size="small"
            >
              <PanelLeft className="size-3.5" aria-hidden="true" />
            </IconButton>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold text-foreground">{title}</h1>
              <p className="truncate text-[11px] text-muted-foreground">{workspaceId}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
              <WifiOff className="size-3" aria-hidden="true" />
              本地离线
            </span>
            <button
              className="hidden h-7 items-center gap-1.5 rounded-[6px] border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted sm:inline-flex"
              disabled
              type="button"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              打开位置
            </button>
            <IconButton label="更多操作" size="small">
              <Ellipsis className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              id="workbench-inspector-toggle"
              label={inspectorOpen ? "收起上下文面板" : "展开上下文面板"}
              onClick={() => {
                setInspectorOpen((open) => !open);
              }}
              size="small"
            >
              <PanelRight className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        <ThreadTimeline hasThread={hasThread} workspaceId={workspaceId} />
        <WorkbenchComposer hasThread={hasThread} />
      </main>

      {inspectorOpen ? (
        <button
          aria-label="关闭上下文面板"
          className="workbench-inspector-scrim"
          onClick={closeInspector}
          type="button"
        />
      ) : null}

      <WorkbenchInspector onClose={closeInspector} workspaceId={workspaceId} />
    </div>
  );
}
