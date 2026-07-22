import { Link } from "@tanstack/react-router";
import {
  ArrowUp,
  Bot,
  CirclePlus,
  FolderGit2,
  MessageSquareText,
  Plus,
  Settings,
  WifiOff,
} from "lucide-react";

import { IconButton } from "../../../shared/ui/icon-button.js";

type WorkbenchShellProps = Readonly<{
  threadId?: string;
  workspaceId: string;
}>;

export function WorkbenchShell({ threadId, workspaceId }: WorkbenchShellProps) {
  const hasThread = threadId !== undefined;

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-canvas max-[760px]:grid-cols-1 max-[760px]:grid-rows-[64px_minmax(0,1fr)]">
      <aside
        aria-label="Thread Sidebar"
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-border bg-surface max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:grid-rows-1 max-[760px]:border-r-0 max-[760px]:border-b"
      >
        <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 max-[760px]:border-b-0">
          <Link
            className="grid size-8 shrink-0 place-items-center bg-foreground text-xs font-bold text-surface"
            to="/workspaces"
            aria-label="返回 Workspaces"
          >
            CA
          </Link>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">Workspace</p>
            <h1 className="truncate text-sm font-semibold">{workspaceId}</h1>
          </div>
        </div>

        <nav className="min-h-0 overflow-auto p-3 max-[760px]:hidden" aria-label="Threads">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Threads</span>
            <IconButton disabled label="新建 Thread" size="small">
              <Plus className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
          {hasThread ? (
            <Link
              className="flex min-w-0 items-center gap-2 border-l-2 border-accent bg-surface-muted px-3 py-2 text-sm text-foreground"
              params={{ threadId, workspaceId }}
              to="/w/$workspaceId/t/$threadId"
            >
              <MessageSquareText className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">{threadId}</span>
            </Link>
          ) : (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
              此 Workspace 暂无 Thread。
            </p>
          )}
        </nav>

        <div className="border-t border-border p-3 max-[760px]:flex max-[760px]:items-center max-[760px]:border-t-0">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-warning max-[760px]:hidden">
            <WifiOff className="size-3.5" aria-hidden="true" />
            Runtime 未连接
          </div>
          <Link
            className="mt-1 flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground max-[760px]:mt-0 max-[760px]:size-9 max-[760px]:justify-center max-[760px]:p-0"
            to="/settings"
            aria-label="设置"
            title="设置"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="max-[760px]:sr-only">设置</span>
          </Link>
        </div>
      </aside>

      <main aria-label="Thread Timeline" className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface/80 px-4 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{hasThread ? threadId : "新 Thread"}</p>
            <p className="truncate text-xs text-muted-foreground">{workspaceId}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-warning">
            <WifiOff className="size-3.5" aria-hidden="true" />
            离线
          </span>
        </header>

        <section
          className="grid min-h-0 flex-1 place-items-center overflow-auto px-5 py-10"
          aria-label="会话内容"
        >
          <div className="max-w-md text-center">
            {hasThread ? (
              <Bot
                className="mx-auto size-9 text-muted-foreground"
                aria-hidden="true"
                strokeWidth={1.5}
              />
            ) : (
              <FolderGit2
                className="mx-auto size-9 text-muted-foreground"
                aria-hidden="true"
                strokeWidth={1.5}
              />
            )}
            <h2 className="mt-4 text-lg font-semibold">{hasThread ? "暂无消息" : workspaceId}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {hasThread ? "此 Thread 尚未开始。" : "Runtime 连接后可创建 Thread。"}
            </p>
          </div>
        </section>

        <section
          className="shrink-0 border-t border-border bg-surface px-3 py-3 sm:px-5"
          aria-label="Composer"
        >
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2 border border-border bg-canvas p-2 shadow-[var(--app-shadow)]">
            <IconButton disabled label="添加附件">
              <CirclePlus className="size-4" aria-hidden="true" />
            </IconButton>
            <textarea
              aria-label="任务输入"
              className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              disabled
              placeholder="Runtime 未连接"
              rows={1}
            />
            <IconButton disabled label="提交" tone="accent">
              <ArrowUp className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        </section>
      </main>
    </div>
  );
}
