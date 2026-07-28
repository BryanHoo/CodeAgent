import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentTask, AgentTaskPage, PendingRequest } from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Ellipsis,
  Folder,
  LoaderCircle,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  ShieldQuestion,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  formatTaskAge,
  getPinnedTasks,
  getProjectTaskPreview,
  PROJECT_TASK_PREVIEW_LIMIT,
} from "../../projects/project-data.js";
import { useProjects } from "../../projects/project-context.js";
import {
  removeProjectTaskFromPage,
  replaceProjectTaskInPage,
  taskArchiveMutationOptions,
  taskPinMutationOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { getTaskActivity } from "../../conversation/runtime/task-activity.js";
import { useProjectReordering } from "../hooks/use-project-reordering.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "../project-sidebar-preferences.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";
const taskActionMenuGap = 2;
const taskActionMenuHeight = 104;
const taskActionMenuWidth = 128;
const taskActionMenuViewportPadding = 8;

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

export function hasPendingApproval(pendingRequests: readonly PendingRequest[]): boolean {
  // 只有命令和文件变更属于审批等待，普通用户输入继续沿用运行态提示。
  return pendingRequests.some(
    (request) =>
      request.status === "pending" &&
      (request.type === "command_approval" || request.type === "file_change_approval"),
  );
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
    client,
    error,
    isPending,
    isProjectOrderPending,
    isProjectPickerOpen,
    projects,
    projectOrderError,
    projectTaskStates,
    taskActivity,
    tasks,
    reorderProjects,
  } = useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connectionStatus = getProjectSidebarConnectionStatus(connectionState);
  const [preferenceStorage] = useState(getProjectSidebarPreferenceStorage);
  const [initialSavedExpandedProjectIds] = useState(() =>
    readExpandedProjectIds(preferenceStorage),
  );
  const savedExpandedProjectIdsRef = useRef(initialSavedExpandedProjectIds);
  const hasInitializedProjectExpansionRef = useRef(projects.length > 0);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(() =>
    resolveInitialExpandedProjectIds(
      projects.map((project) => project.id),
      initialSavedExpandedProjectIds,
    ),
  );
  const expandedProjectsRef = useRef(expandedProjects);
  const [query, setQuery] = useState("");
  const [expandedTaskProjects, setExpandedTaskProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingTask, setRenamingTask] = useState<AgentTask | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const pinMutation = useMutation(taskPinMutationOptions(client));
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const archiveMutation = useMutation(taskArchiveMutationOptions(client));
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
  const taskActionPending =
    pinMutation.isPending || renameMutation.isPending || archiveMutation.isPending;
  const {
    activeProjectId: reorderingProjectId,
    announcement: projectOrderAnnouncement,
    getProjectReorderProps,
    orderedProjects,
  } = useProjectReordering({
    disabled: isProjectOrderPending,
    onReorder: reorderProjects,
    projects,
  });
  const firstProject = orderedProjects[0];

  useEffect(() => {
    // 首次加载只展开第一个 Project；已有配置则恢复上次保存的文件夹形态。
    const projectIds = projects.map((project) => project.id);
    if (!hasInitializedProjectExpansionRef.current && projectIds.length > 0) {
      hasInitializedProjectExpansionRef.current = true;
      const initialExpandedProjectIds = resolveInitialExpandedProjectIds(
        projectIds,
        savedExpandedProjectIdsRef.current,
      );
      expandedProjectsRef.current = initialExpandedProjectIds;
      setExpandedProjects(initialExpandedProjectIds);
      return;
    }

    const availableProjectIds = new Set(projectIds);
    const currentExpandedProjectIds = expandedProjectsRef.current;
    const nextExpandedProjectIds = new Set(
      [...currentExpandedProjectIds].filter((expandedProjectId) =>
        availableProjectIds.has(expandedProjectId),
      ),
    );
    if (nextExpandedProjectIds.size !== currentExpandedProjectIds.size) {
      expandedProjectsRef.current = nextExpandedProjectIds;
      setExpandedProjects(nextExpandedProjectIds);
    }
  }, [projects]);

  const updateExpandedProjects = useCallback(
    (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
      const nextExpandedProjectIds = update(expandedProjectsRef.current);
      expandedProjectsRef.current = nextExpandedProjectIds;
      savedExpandedProjectIdsRef.current = nextExpandedProjectIds;
      writeExpandedProjectIds(preferenceStorage, nextExpandedProjectIds);
      setExpandedProjects(nextExpandedProjectIds);
    },
    [preferenceStorage],
  );

  const toggleProject = (id: string) => {
    updateExpandedProjects((current) => {
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
      updateExpandedProjects((current) => new Set(current).add(project.id));
      await navigate({ params: { projectId: project.id }, to: "/p/$projectId" });
    }
  };

  const openNewTask = async (targetProjectId: string) => {
    // 新聊天先复用 Project 空任务路由，首次提交时再由 Composer 创建真实 Codex Task。
    updateExpandedProjects((current) => {
      if (current.has(targetProjectId)) {
        return current;
      }
      const next = new Set(current);
      next.add(targetProjectId);
      return next;
    });
    await navigate({ params: { projectId: targetProjectId }, to: "/p/$projectId" });
  };

  const replaceTaskCache = (task: AgentTask) => {
    // Mutation 成功后原位更新对应 Project，避免任务跳到列表顶部或等待 Provider 最终一致。
    queryClient.setQueryData<AgentTaskPage>(["projects", task.projectId, "tasks"], (currentPage) =>
      replaceProjectTaskInPage(currentPage, task),
    );
  };

  const pinTask = async (task: AgentTask) => {
    setTaskActionError(null);
    try {
      const response = await pinMutation.mutateAsync({
        pinned: !task.pinned,
        projectId: task.projectId,
        taskId: task.id,
      });
      replaceTaskCache(response.task);
    } catch {
      setTaskActionError("无法更新固定状态");
    }
  };

  const renameTask = async (task: AgentTask, title: string) => {
    setTaskActionError(null);
    try {
      const response = await renameMutation.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
        title,
      });
      replaceTaskCache(response.task);
      setRenamingTask(null);
    } catch {
      setTaskActionError("无法重命名任务");
    }
  };

  const archiveTask = async (task: AgentTask) => {
    setTaskActionError(null);
    try {
      await archiveMutation.mutateAsync({ projectId: task.projectId, taskId: task.id });
      queryClient.setQueryData<AgentTaskPage>(
        ["projects", task.projectId, "tasks"],
        (currentPage) => removeProjectTaskFromPage(currentPage, task.id),
      );
      if (task.projectId === projectId && task.id === taskId) {
        await navigate({ params: { projectId: task.projectId }, to: "/p/$projectId" });
      }
    } catch {
      setTaskActionError("无法归档任务");
    }
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
              updateExpandedProjects((current) => new Set(current).add(firstProject.id));
            }}
            params={{ projectId: firstProject.id }}
            to="/p/$projectId"
          >
            <Send className={primaryActionIconClassName} aria-hidden="true" />
            新建任务
          </Link>
        )}
      </nav>

      {/* 限制项目区的固有宽度，长 Task 标题不能把右侧操作按钮推出 Sidebar。 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden px-2 pt-5">
        {pinnedTasks.length > 0 ? (
          <section
            className="mb-4 max-h-40 shrink-0 overflow-y-auto"
            aria-labelledby="pinned-title"
          >
            <h2
              className="px-2 pb-2 text-meta font-semibold text-muted-foreground"
              id="pinned-title"
            >
              Pinned
            </h2>
            <div className="space-y-0.5">
              {pinnedTasks.map((task) => {
                const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                return (
                  <TaskLink
                    active={task.projectId === projectId && task.id === taskId}
                    icon={<Pin className="size-3.5" aria-hidden="true" />}
                    isAwaitingApproval={activity.isAwaitingApproval}
                    key={`${task.projectId}:${task.id}`}
                    isActionPending={taskActionPending}
                    isRunning={activity.isRunning}
                    onArchive={(task) => void archiveTask(task)}
                    onPin={(task) => void pinTask(task)}
                    onRename={setRenamingTask}
                    task={task}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="projects-title">
          <div className="flex h-8 min-w-0 w-full shrink-0 items-center justify-between pl-2">
            <h2 className="text-body-small font-semibold text-foreground" id="projects-title">
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
          {taskActionError === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              {taskActionError}
            </p>
          )}
          {projectOrderError === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              无法保存项目排序
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {projectOrderAnnouncement}
          </p>

          <div
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
            data-testid="project-tree-scroll"
          >
            {orderedProjects.map((project) => {
              const projectTasks = visibleTasks.filter((task) => task.projectId === project.id);
              const expanded = expandedProjects.has(project.id);
              const showAllTasks = expandedTaskProjects.has(project.id);
              const taskPreview = getProjectTaskPreview(projectTasks, showAllTasks);
              const showTaskToggle =
                taskPreview.hasMore ||
                (showAllTasks && projectTasks.length > PROJECT_TASK_PREVIEW_LIMIT);

              return (
                <div
                  className={`min-w-0 transition-[opacity,transform] ${
                    reorderingProjectId === project.id ? "relative z-10 opacity-80" : ""
                  }`}
                  data-project-reordering={reorderingProjectId === project.id ? "true" : "false"}
                  key={project.id}
                >
                  <div className="flex min-w-0 items-center gap-0.5">
                    <button
                      aria-expanded={expanded}
                      aria-label={`切换项目 ${project.name}`}
                      className={`flex h-8 min-w-0 flex-1 touch-pan-y select-none items-center gap-2 rounded-control px-2 text-body-small font-medium transition-colors hover:bg-control-hover hover:text-foreground ${
                        reorderingProjectId === project.id
                          ? "cursor-grabbing bg-control-active text-foreground shadow-sm"
                          : "cursor-grab text-muted-foreground"
                      }`}
                      onClick={() => {
                        toggleProject(project.id);
                      }}
                      type="button"
                      {...getProjectReorderProps(project.id)}
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
                    <div className="mt-0.5 min-w-0 space-y-0.5 pl-5">
                      {project.id === projectId && taskId === undefined ? (
                        <NewTaskLink projectId={project.id} />
                      ) : null}
                      {taskPreview.tasks.map((task) => {
                        const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                        return (
                          <TaskLink
                            active={project.id === projectId && task.id === taskId}
                            isAwaitingApproval={activity.isAwaitingApproval}
                            isActionPending={taskActionPending}
                            isRunning={activity.isRunning}
                            key={`${task.projectId}:${task.id}`}
                            onArchive={(task) => void archiveTask(task)}
                            onPin={(task) => void pinTask(task)}
                            onRename={setRenamingTask}
                            task={task}
                          />
                        );
                      })}
                      {showTaskToggle ? (
                        <button
                          aria-expanded={showAllTasks}
                          className="flex h-7 w-full items-center rounded-control px-2 text-left text-meta font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                          onClick={() => {
                            setExpandedTaskProjects((current) => {
                              const next = new Set(current);
                              if (showAllTasks) {
                                next.delete(project.id);
                              } else {
                                next.add(project.id);
                              }
                              return next;
                            });
                          }}
                          type="button"
                        >
                          {showAllTasks ? "收起" : "显示更多"}
                        </button>
                      ) : null}
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

      {renamingTask === null ? null : (
        <TaskRenameDialog
          isPending={renameMutation.isPending}
          key={renamingTask.id}
          onClose={() => {
            setRenamingTask(null);
          }}
          onRename={(title) => void renameTask(renamingTask, title)}
          task={renamingTask}
        />
      )}

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
  isActionPending: boolean;
  isAwaitingApproval: boolean;
  isRunning: boolean;
  onArchive: (task: AgentTask) => void;
  onPin: (task: AgentTask) => void;
  onRename: (task: AgentTask) => void;
  task: AgentTask;
}>;

function TaskLink({
  active,
  icon,
  isActionPending,
  isAwaitingApproval,
  isRunning,
  onArchive,
  onPin,
  onRename,
  task,
}: TaskLinkProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<Readonly<{ left: number; top: number }>>();
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = useCallback(() => {
    const container = menuContainerRef.current;
    const trigger = triggerRef.current;
    if (container === null || trigger === null) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const maximumLeft = Math.max(
      taskActionMenuViewportPadding,
      window.innerWidth - taskActionMenuWidth - taskActionMenuViewportPadding,
    );
    const belowTop = triggerRect.bottom + taskActionMenuGap;
    const maximumTop = window.innerHeight - taskActionMenuHeight - taskActionMenuViewportPadding;

    // 菜单左边缘与省略号按钮对齐，并在靠近视口底部时翻转到行上方。
    setMenuPosition({
      left: Math.min(Math.max(triggerRect.left, taskActionMenuViewportPadding), maximumLeft),
      top:
        belowTop <= maximumTop
          ? belowTop
          : Math.max(
              taskActionMenuViewportPadding,
              triggerRect.top - taskActionMenuHeight - taskActionMenuGap,
            ),
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(undefined);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        !menuContainerRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [menuOpen]);

  return (
    <div
      className="group relative min-w-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
          triggerRef.current?.focus();
        }
      }}
      ref={menuContainerRef}
    >
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
        {icon === undefined ? null : (
          <span className="shrink-0 text-subtle-foreground">{icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <TaskStatusIndicator
          isAwaitingApproval={isAwaitingApproval}
          isRunning={isRunning}
          updatedAt={task.updatedAt}
        />
      </Link>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`打开 ${task.title} 的操作菜单`}
        className="task-actions absolute right-1 top-1 grid size-6 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus"
        disabled={isActionPending}
        onClick={() => {
          setMenuOpen((open) => !open);
        }}
        ref={triggerRef}
        type="button"
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </button>
      {menuOpen && menuPosition !== undefined && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50"
              ref={menuRef}
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              <TaskActionMenu
                isPending={isActionPending}
                onArchive={() => {
                  setMenuOpen(false);
                  onArchive(task);
                }}
                onPin={() => {
                  setMenuOpen(false);
                  onPin(task);
                }}
                onRename={() => {
                  setMenuOpen(false);
                  onRename(task);
                }}
                task={task}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type TaskStatusIndicatorProps = Readonly<{
  isAwaitingApproval: boolean;
  isRunning: boolean;
  updatedAt: string;
}>;

export function TaskStatusIndicator({
  isAwaitingApproval,
  isRunning,
  updatedAt,
}: TaskStatusIndicatorProps) {
  if (isAwaitingApproval) {
    return (
      <span
        aria-label="任务等待审批"
        className="task-status ml-auto inline-flex shrink-0 text-accent"
        role="status"
      >
        <ShieldQuestion className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (isRunning) {
    return (
      <span
        aria-label="任务运行中"
        className="task-status ml-auto inline-flex shrink-0 text-subtle-foreground"
        role="status"
      >
        {/* 动画放在 HTML 容器上，确保 SVG 图标在各浏览器中平滑旋转。 */}
        <span className="inline-flex animate-spin" aria-hidden="true">
          <LoaderCircle className="size-3.5" />
        </span>
      </span>
    );
  }

  return (
    <span className="task-age task-status ml-auto shrink-0 text-caption text-subtle-foreground">
      {formatTaskAge(updatedAt)}
    </span>
  );
}

type TaskActionMenuProps = Readonly<{
  isPending: boolean;
  onArchive: () => void;
  onPin: () => void;
  onRename: () => void;
  task: AgentTask;
}>;

const taskActionClassName =
  "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover disabled:opacity-50";

export function TaskActionMenu({
  isPending,
  onArchive,
  onPin,
  onRename,
  task,
}: TaskActionMenuProps) {
  return (
    <div
      aria-label={`${task.title} 的任务操作`}
      className="w-32 rounded-surface bg-raised p-1 shadow-floating"
      role="menu"
    >
      <button
        className={taskActionClassName}
        disabled={isPending}
        onClick={onPin}
        role="menuitem"
        type="button"
      >
        <Pin className="size-3.5" aria-hidden="true" />
        {task.pinned ? "取消固定" : "固定"}
      </button>
      <button
        className={taskActionClassName}
        disabled={isPending}
        onClick={onRename}
        role="menuitem"
        type="button"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        重命名
      </button>
      <button
        className={`${taskActionClassName} text-danger`}
        disabled={isPending}
        onClick={onArchive}
        role="menuitem"
        type="button"
      >
        <Archive className="size-3.5" aria-hidden="true" />
        归档
      </button>
    </div>
  );
}

type TaskRenameDialogProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  task: AgentTask;
}>;

function TaskRenameDialog({ isPending, onClose, onRename, task }: TaskRenameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(task.title);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      // 原生 dialog 负责焦点圈定和 Escape，避免侧栏弹层泄漏键盘焦点。
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      aria-labelledby="task-rename-title"
      className="m-auto w-[min(90vw,24rem)] max-w-none rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <form
        className="p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedTitle = title.trim();
          if (normalizedTitle.length > 0) {
            onRename(normalizedTitle);
          }
        }}
      >
        <h2 className="text-heading font-semibold" id="task-rename-title">
          重命名任务
        </h2>
        <input
          aria-label="任务名称"
          autoFocus
          className="mt-3 h-9 w-full rounded-control bg-control px-3 text-body text-foreground outline-none focus:shadow-focus"
          disabled={isPending}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
          }}
          value={title}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="h-8 rounded-control bg-accent px-3 text-body-small font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            disabled={isPending || title.trim().length === 0}
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}
