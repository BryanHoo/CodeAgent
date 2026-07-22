import { Link } from "@tanstack/react-router";
import {
  Archive,
  ChevronDown,
  Clock3,
  FolderGit2,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { IconButton } from "../../../shared/ui/icon-button.js";

const recentThreads = [
  { id: "thread-1", title: "构建 macOS 工作台", time: "现在" },
  { id: "input-design", title: "优化输入框交互", time: "2h" },
  { id: "model-api", title: "接入模型选择 API", time: "昨天" },
  { id: "markdown", title: "完善 Markdown 渲染", time: "周一" },
];

type ThreadSidebarProps = Readonly<{
  onClose: () => void;
  threadId?: string;
  workspaceId: string;
}>;

export function ThreadSidebar({ onClose, threadId, workspaceId }: ThreadSidebarProps) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [query, setQuery] = useState("");
  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery.length === 0
      ? recentThreads
      : recentThreads.filter((thread) =>
          thread.title.toLocaleLowerCase().includes(normalizedQuery),
        );
  }, [query]);

  return (
    <aside
      aria-label="Thread Sidebar"
      className="workbench-sidebar z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-sidebar shadow-divider"
    >
      <div className="flex h-toolbar items-center gap-2 px-3">
        <Link
          aria-label="返回 Workspaces"
          className="grid size-7 shrink-0 place-items-center rounded-control bg-foreground text-caption font-bold text-raised shadow-sm"
          to="/workspaces"
        >
          CA
        </Link>
        <button
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-body-small font-semibold text-foreground"
          type="button"
        >
          <span className="truncate">CodeAgentWindow</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <IconButton
          className="min-workbench:hidden"
          label="关闭任务侧栏"
          onClick={onClose}
          size="small"
        >
          <PanelLeftClose className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2 py-1.5" aria-label="工作台导航">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-body-small text-foreground transition-colors hover:bg-control-hover disabled:opacity-50"
          disabled
          type="button"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          新任务
          <Plus className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
        <button
          aria-expanded={searchVisible}
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-body-small text-foreground transition-colors hover:bg-control-hover"
          onClick={() => {
            setSearchVisible((visible) => !visible);
          }}
          type="button"
        >
          <Search className="size-3.5" aria-hidden="true" />
          搜索
          <span className="ml-auto text-caption text-muted-foreground">⌘K</span>
        </button>
        <Link
          className="flex h-8 items-center gap-2 rounded-control px-2 text-body-small text-foreground transition-colors hover:bg-control-hover"
          to="/workspaces"
        >
          <Archive className="size-3.5" aria-hidden="true" />
          项目
        </Link>
      </nav>

      <div className="min-h-0 overflow-y-auto px-2 pb-2">
        {searchVisible ? (
          <div className="px-1 pb-2">
            <input
              aria-label="搜索任务"
              autoFocus
              className="h-8 w-full rounded-control border-0 bg-raised px-2.5 text-label text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="搜索任务"
              value={query}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-meta font-medium text-muted-foreground">最近任务</span>
          <Clock3 className="size-3 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-0.5">
          {filteredThreads.map((thread) => (
            <Link
              className={`group flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-body-small transition-colors ${
                thread.id === threadId
                  ? "bg-control-active text-foreground"
                  : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
              }`}
              key={thread.id}
              params={{ threadId: thread.id, workspaceId }}
              to="/w/$workspaceId/t/$threadId"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  thread.id === threadId ? "bg-accent" : "bg-separator-strong"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="shrink-0 text-caption text-muted-foreground opacity-70">
                {thread.time}
              </span>
            </Link>
          ))}
          {filteredThreads.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配的任务</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2 px-2 py-2 text-meta font-medium text-muted-foreground">
          <FolderGit2 className="size-3.5" aria-hidden="true" />
          <span className="truncate">{workspaceId}</span>
        </div>
      </div>

      <div className="p-1.5">
        <Link
          aria-label="设置"
          className="flex h-9 items-center gap-2 rounded-control px-2 text-body-small text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
          to="/settings"
        >
          <Settings className="size-3.5" aria-hidden="true" />
          设置
          <span className="ml-auto inline-flex items-center gap-1 text-caption">
            <span className="size-1.5 rounded-full bg-warning" /> 离线
          </span>
        </Link>
      </div>
    </aside>
  );
}
