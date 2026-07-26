import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentEventConnectionState } from "@code-agent/client";
import {
  Folder,
  LoaderCircle,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatTaskAge, getPinnedTasks } from "../../projects/project-data.js";
import { useProjects } from "../../projects/project-context.js";
import { IconButton } from "../../../shared/ui/icon-button.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";

type ProjectSidebarProps = Readonly<{
  connectionState: AgentEventConnectionState;
  onClose: () => void;
  projectId?: string;
  taskId?: string;
}>;

type ProjectSidebarConnectionInput = Readonly<{
  hasActiveTask: boolean;
  projectDataFailed: boolean;
  projectDataPending: boolean;
  taskConnectionState: AgentEventConnectionState;
}>;

export function deriveProjectSidebarConnectionState({
  hasActiveTask,
  projectDataFailed,
  projectDataPending,
  taskConnectionState,
}: ProjectSidebarConnectionInput): AgentEventConnectionState {
  // 活动任务以实时终端链路为准；新任务页则使用 HTTP Runtime 的可用性作为连接依据。
  if (hasActiveTask) {
    return taskConnectionState;
  }
  if (projectDataFailed) {
    return "closed";
  }
  if (projectDataPending) {
    return "connecting";
  }
  return "connected";
}

export function getProjectSidebarConnectionStatus(connectionState: AgentEventConnectionState) {
  switch (connectionState) {
    case "connected":
      return { label: "Online", toneClassName: "text-diff-added" } as const;
    case "connecting":
      return { label: "Connecting", toneClassName: "text-warning" } as const;
    case "reconnecting":
      return { label: "Reconnecting", toneClassName: "text-warning" } as const;
    case "closed":
      return { label: "Offline", toneClassName: "text-danger" } as const;
  }
}

export function ProjectSidebar({
  connectionState,
  onClose,
  projectId,
  taskId,
}: ProjectSidebarProps) {
  const {
    addProject,
    addProjectError,
    error,
    isPending,
    isProjectPickerOpen,
    projects,
    projectTaskStates,
    tasks,
  } = useProjects();
  const navigate = useNavigate();
  const connectionStatus = getProjectSidebarConnectionStatus(connectionState);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTasks = useMemo(
    () =>
      normalizedQuery.length === 0
        ? tasks
        : tasks.filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, tasks],
  );
  const pinnedTasks = getPinnedTasks(visibleTasks);
  const hasPendingTasks = [...projectTaskStates.values()].some((state) => state.isPending);
  const hasTaskError = [...projectTaskStates.values()].some((state) => state.error !== null);
  const firstProject = projects[0];

  useEffect(() => {
    // Projects 异步到达后默认展开新项目，保留用户已手动设置的现有项目状态。
    setExpandedProjects((current) => {
      const next = new Set(current);
      let changed = false;
      for (const project of projects) {
        if (!next.has(project.id)) {
          next.add(project.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [projects]);

  const toggleProject = (id: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openProjectPicker = async () => {
    const project = await addProject();
    if (project !== undefined) {
      await navigate({ params: { projectId: project.id }, to: "/p/$projectId" });
    }
  };

  const openNewTask = async (targetProjectId: string) => {
    // 新聊天先复用 Project 空任务路由，首次提交时再由 Composer 创建真实 Codex Task。
    setExpandedProjects((current) => {
      if (current.has(targetProjectId)) {
        return current;
      }
      const next = new Set(current);
      next.add(targetProjectId);
      return next;
    });
    await navigate({ params: { projectId: targetProjectId }, to: "/p/$projectId" });
  };

  return (
    <aside
      aria-label="Project Sidebar"
      className="workbench-sidebar z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-sidebar shadow-divider"
    >
      <div className="flex h-workbench-header items-center gap-2 px-3">
        <Link
          aria-label="CodeAgent 首页"
          className="flex min-w-0 flex-1 items-center gap-2 text-body-small font-semibold text-foreground"
          {...(projectId === undefined
            ? { to: "/" as const }
            : { params: { projectId }, to: "/p/$projectId" as const })}
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-control bg-foreground text-caption font-bold text-raised shadow-sm"
          >
            CA
          </span>
          <span className="truncate">CodeAgent</span>
        </Link>
        <IconButton
          className="min-workbench:hidden"
          label="关闭项目侧栏"
          onClick={onClose}
          size="small"
        >
          <PanelLeftClose className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2" aria-label="Agent 导航">
        <div className="relative px-1 pb-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <input
            aria-label="搜索任务"
            className="h-9 w-full rounded-control bg-control pl-8 pr-2.5 text-body-small text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder="搜索任务"
            value={query}
          />
        </div>
        {firstProject === undefined ? null : (
          <Link
            className={primaryActionClassName}
            onClick={() => {
              setExpandedProjects((current) => new Set(current).add(firstProject.id));
            }}
            params={{ projectId: firstProject.id }}
            to="/p/$projectId"
          >
            <Send className={primaryActionIconClassName} aria-hidden="true" />
            新建任务
          </Link>
        )}
      </nav>

      <div className="min-h-0 overflow-y-auto px-2 pb-3 pt-5">
        {pinnedTasks.length > 0 ? (
          <section className="mb-6" aria-labelledby="pinned-title">
            <h2
              className="px-2 pb-2 text-meta font-semibold text-muted-foreground"
              id="pinned-title"
            >
              Pinned
            </h2>
            <div className="space-y-0.5">
              {pinnedTasks.map((task) => (
                <TaskLink
                  active={task.projectId === projectId && task.id === taskId}
                  icon={<Pin className="size-3.5" aria-hidden="true" />}
                  key={`${task.projectId}:${task.id}`}
                  task={task}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="projects-title">
          <div className="mb-2 flex h-7 w-full items-center justify-between pl-2">
            <h2 className="text-meta font-semibold text-muted-foreground" id="projects-title">
              Projects
            </h2>
            <IconButton
              disabled={isProjectPickerOpen}
              label="添加项目"
              onClick={() => void openProjectPicker()}
              size="small"
            >
              {isProjectPickerOpen ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-3.5" aria-hidden="true" />
              )}
            </IconButton>
          </div>

          {isPending || hasPendingTasks ? (
            <p className="px-2 py-1.5 text-meta text-subtle-foreground">正在加载任务</p>
          ) : null}
          {error === null && !hasTaskError ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              无法加载任务
            </p>
          )}
          {addProjectError === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              无法添加项目
            </p>
          )}

          <div className="space-y-4">
            {projects.map((project) => {
              const projectTasks = visibleTasks.filter((task) => task.projectId === project.id);
              const expanded = expandedProjects.has(project.id);

              return (
                <div key={project.id}>
                  <div className="flex min-w-0 items-center gap-0.5">
                    <button
                      aria-expanded={expanded}
                      aria-label={`切换项目 ${project.name}`}
                      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-body-small font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                      onClick={() => {
                        toggleProject(project.id);
                      }}
                      type="button"
                    >
                      <Folder className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <IconButton
                      label={`在 ${project.name} 中新建任务`}
                      onClick={() => {
                        void openNewTask(project.id);
                      }}
                      size="small"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </IconButton>
                  </div>

                  {expanded ? (
                    <div className="mt-0.5 space-y-0.5 pl-5">
                      {project.id === projectId && taskId === undefined ? (
                        <NewTaskLink projectId={project.id} />
                      ) : null}
                      {projectTasks.map((task) => (
                        <TaskLink
                          active={project.id === projectId && task.id === taskId}
                          key={`${task.projectId}:${task.id}`}
                          task={task}
                        />
                      ))}
                      {projectTasks.length === 0 && normalizedQuery.length === 0 ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">暂无任务</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="p-2">
        <Link
          aria-label={`设置，终端连接状态：${connectionStatus.label}`}
          className="flex h-9 items-center gap-2.5 rounded-control px-2.5 text-body-small text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
          to="/settings"
        >
          <Settings className="size-4" aria-hidden="true" />
          Settings
          <span
            aria-live="polite"
            className={`ml-auto inline-flex items-center gap-1 text-caption ${connectionStatus.toneClassName}`}
          >
            <ProjectSidebarConnectionIcon connectionState={connectionState} />
            {connectionStatus.label}
          </span>
        </Link>
      </div>
    </aside>
  );
}

function NewTaskLink({ projectId }: Readonly<{ projectId: string }>) {
  return (
    <Link
      aria-current="page"
      className="flex h-8 min-w-0 items-center rounded-control bg-control-active px-2 text-body-small font-medium text-foreground"
      params={{ projectId }}
      to="/p/$projectId"
    >
      <span className="min-w-0 flex-1 truncate">新聊天</span>
    </Link>
  );
}

function ProjectSidebarConnectionIcon({
  connectionState,
}: Readonly<{ connectionState: AgentEventConnectionState }>) {
  if (connectionState === "connected") {
    return <Wifi className="size-3" aria-hidden="true" />;
  }
  if (connectionState === "closed") {
    return <WifiOff className="size-3" aria-hidden="true" />;
  }
  return (
    <span className="inline-flex animate-spin" aria-hidden="true">
      <LoaderCircle className="size-3" />
    </span>
  );
}

type TaskLinkProps = Readonly<{
  active: boolean;
  icon?: React.ReactNode;
  task: ReturnType<typeof getPinnedTasks>[number];
}>;

function TaskLink({ active, icon, task }: TaskLinkProps) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-body-small transition-colors ${
        active
          ? "bg-control-active font-medium text-foreground"
          : "text-muted-foreground hover:bg-control-hover hover:text-foreground"
      }`}
      params={{ projectId: task.projectId, taskId: task.id }}
      to="/p/$projectId/t/$taskId"
    >
      {icon === undefined ? null : <span className="shrink-0 text-subtle-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="shrink-0 text-caption text-subtle-foreground">
        {formatTaskAge(task.updatedAt)}
      </span>
    </Link>
  );
}
