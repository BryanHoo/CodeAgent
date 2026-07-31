import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentTask, Project } from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CircleAlert,
  CircleCheck,
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
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  formatTaskAge,
  getPinnedTasks,
  getProjectTaskPreview,
  PROJECT_TASK_PREVIEW_LIMIT,
} from "../../projects/project-data.js";
import { useProjects, useProjectTaskSearch } from "../../projects/project-context.js";
import {
  removeArchivedProjectTaskAndRefill,
  replaceProjectTaskInQueryCaches,
  taskArchiveMutationOptions,
  taskPinMutationOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { removeRetainedTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import { getTaskActivity, type TaskAttention } from "../../conversation/runtime/task-activity.js";
import { useProjectReordering } from "../hooks/use-project-reordering.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "../project-sidebar-preferences.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";
const taskActionMenuGap = 2;
const taskActionMenuHeight = 104;
const taskActionMenuWidth = 128;
const taskActionMenuViewportPadding = 8;
const projectActionMenuHeight = 72;

type ProjectSidebarProps = Readonly<{
  connectionState: AgentEventConnectionState;
  onClose: () => void;
  onOpenSettings: () => void;
  projectId?: string;
  taskId?: string;
}>;

type ProjectSidebarConnectionInput = Readonly<{
  hasActiveTask: boolean;
  projectDataFailed: boolean;
  projectDataPending: boolean;
  taskConnectionState: AgentEventConnectionState;
}>;

type ProjectTaskPaginationControlInput = Readonly<{
  error: Error | null;
  hasHiddenLoadedTasks: boolean;
  hasNextPage: boolean;
  isExpanded: boolean;
  isFetchingNextPage: boolean;
}>;

export function getProjectTaskPaginationControl({
  error,
  hasHiddenLoadedTasks,
  hasNextPage,
  isExpanded,
  isFetchingNextPage,
}: ProjectTaskPaginationControlInput) {
  if (!isExpanded) {
    if (hasHiddenLoadedTasks) {
      return { action: "expand", disabled: false, label: "显示更多" } as const;
    }
    return hasNextPage
      ? ({ action: "expand-and-load", disabled: false, label: "显示更多" } as const)
      : null;
  }

  if (hasNextPage) {
    return {
      action: "load",
      disabled: isFetchingNextPage,
      label: isFetchingNextPage ? "正在加载更多" : error === null ? "显示更多" : "重试加载更多",
    } as const;
  }

  return hasHiddenLoadedTasks
    ? ({ action: "collapse", disabled: false, label: "收起" } as const)
    : null;
}

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
  onOpenSettings,
  projectId,
  taskId,
}: ProjectSidebarProps) {
  const {
    addProject,
    addProjectError,
    client,
    error,
    fetchNextProjectTaskPage,
    forgetTask,
    isPending,
    isProjectActionPending,
    isProjectOrderPending,
    isProjectPickerOpen,
    projects,
    projectOrderError,
    projectActionError,
    projectTaskStates,
    taskActivity,
    tasks,
    reorderProjects,
    removeProject,
    renameProject,
  } = useProjects();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  const [hasSubmittedProjectAction, setHasSubmittedProjectAction] = useState(false);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const pinMutation = useMutation(taskPinMutationOptions(client));
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const archiveMutation = useMutation(taskArchiveMutationOptions(client));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const taskSearch = useProjectTaskSearch(normalizedQuery);
  const visibleTasks = normalizedQuery.length === 0 ? tasks : taskSearch.tasks;
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
    if (
      isPending ||
      projectId === undefined ||
      projects.some((project) => project.id === projectId)
    ) {
      return;
    }
    // 缓存提交后再修正已删除 Project 的路由，避免事件回调与 React Query 渲染竞态。
    const nextProject = projects[0];
    void (nextProject === undefined
      ? navigate({ replace: true, to: "/" })
      : navigate({ params: { projectId: nextProject.id }, replace: true, to: "/p/$projectId" }));
  }, [isPending, navigate, projectId, projects]);

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

  const toggleProject = (targetProjectId: string) => {
    // Project 名称只控制任务树展开形态，新聊天导航由独立的“+”入口负责。
    updateExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(targetProjectId)) {
        next.delete(targetProjectId);
      } else {
        next.add(targetProjectId);
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

  const openProjectDraft = async (targetProjectId: string) => {
    // 项目切换和新建入口都只打开 Project 草稿，首次提交后才展示真实 Task。
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
    replaceProjectTaskInQueryCaches(queryClient, task);
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
      await removeArchivedProjectTaskAndRefill(queryClient, task.projectId, task.id);
      queryClient.removeQueries({
        exact: true,
        queryKey: ["projects", task.projectId, "tasks", task.id],
      });
      forgetTask(task.projectId, task.id);
      if (task.projectId === projectId && task.id === taskId) {
        await navigate({ params: { projectId: task.projectId }, to: "/p/$projectId" });
      }
      removeRetainedTaskRuntime(task.projectId, task.id);
      // 归档后的 Runtime 清理由 Provider 判定安全性，失败不回滚已成功的归档。
      void client.unsubscribeTask(task.projectId, task.id).catch(() => undefined);
    } catch {
      setTaskActionError("无法归档任务");
    }
  };

  const closeProjectDialog = (targetProjectId: string) => {
    setRenamingProject(null);
    setRemovingProject(null);
    setHasSubmittedProjectAction(false);
    requestAnimationFrame(() => {
      document.getElementById(`project-actions-${targetProjectId}`)?.focus();
    });
  };

  const submitProjectRename = async (project: Project, name: string) => {
    setHasSubmittedProjectAction(true);
    if (await renameProject(project.id, name)) {
      closeProjectDialog(project.id);
    }
  };

  const confirmProjectRemoval = async (project: Project) => {
    setHasSubmittedProjectAction(true);
    const remainingProjects = await removeProject(project.id);
    if (remainingProjects === undefined) {
      return;
    }
    setRemovingProject(null);
  };

  return (
    <aside
      aria-label="Project Sidebar"
      className="workbench-sidebar z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-sidebar shadow-divider"
    >
      <div className="flex h-workbench-header items-center gap-2 px-3">
        {/* 品牌标识只承担展示职责，新聊天由下方的显式入口创建。 */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-body-small font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-control bg-foreground text-caption font-bold text-raised shadow-sm"
          >
            CA
          </span>
          <span className="truncate">CodeAgent</span>
        </div>
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
                    attention={activity.attention}
                    icon={<Pin className="size-3.5" aria-hidden="true" />}
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
          {taskSearch.isPending ? (
            <p className="px-2 py-1.5 text-meta text-subtle-foreground">正在搜索全部任务</p>
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
          {taskSearch.error === null ? null : (
            <p className="px-2 py-1.5 text-meta leading-5 text-danger" role="alert">
              无法搜索任务
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
              const projectTaskState = projectTaskStates.get(project.id);
              const taskPaginationControl = getProjectTaskPaginationControl({
                error: projectTaskState?.error ?? null,
                hasHiddenLoadedTasks: projectTasks.length > PROJECT_TASK_PREVIEW_LIMIT,
                hasNextPage:
                  normalizedQuery.length === 0 ? (projectTaskState?.hasNextPage ?? false) : false,
                isExpanded: showAllTasks,
                isFetchingNextPage: projectTaskState?.isFetchingNextPage ?? false,
              });

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
                    <ProjectActions
                      isPending={isProjectActionPending}
                      onRemove={(targetProject) => {
                        setHasSubmittedProjectAction(false);
                        setRemovingProject(targetProject);
                      }}
                      onRename={(targetProject) => {
                        setHasSubmittedProjectAction(false);
                        setRenamingProject(targetProject);
                      }}
                      project={project}
                    />
                    <IconButton
                      label={`在 ${project.name} 中新建任务`}
                      onClick={() => {
                        void openProjectDraft(project.id);
                      }}
                      size="small"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </IconButton>
                  </div>

                  {expanded ? (
                    <div className="mt-0.5 min-w-0 space-y-0.5 pl-5">
                      {taskPreview.tasks.map((task) => {
                        const activity = getTaskActivity(taskActivity, task.projectId, task.id);
                        return (
                          <TaskLink
                            active={project.id === projectId && task.id === taskId}
                            attention={activity.attention}
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
                      {taskPaginationControl === null ? null : (
                        <button
                          aria-expanded={showAllTasks}
                          className="flex h-7 w-full items-center rounded-control px-2 text-left text-meta font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
                          disabled={taskPaginationControl.disabled}
                          onClick={() => {
                            if (
                              taskPaginationControl.action === "expand" ||
                              taskPaginationControl.action === "expand-and-load"
                            ) {
                              setExpandedTaskProjects((current) =>
                                new Set(current).add(project.id),
                              );
                            } else if (taskPaginationControl.action === "collapse") {
                              setExpandedTaskProjects((current) => {
                                const next = new Set(current);
                                next.delete(project.id);
                                return next;
                              });
                            }

                            if (
                              taskPaginationControl.action === "expand-and-load" ||
                              taskPaginationControl.action === "load"
                            ) {
                              // 下一页错误由对应 Project Query 持有，现有 Task 始终保持可见。
                              void fetchNextProjectTaskPage(project.id).catch(() => undefined);
                            }
                          }}
                          type="button"
                        >
                          {taskPaginationControl.label}
                        </button>
                      )}
                      {projectTasks.length === 0 && normalizedQuery.length === 0 ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">暂无任务</p>
                      ) : null}
                      {projectTasks.length === 0 &&
                      normalizedQuery.length > 0 &&
                      !taskSearch.isPending &&
                      taskSearch.error === null ? (
                        <p className="px-2 py-1.5 text-meta text-subtle-foreground">
                          未找到匹配任务
                        </p>
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
          initialTitle={renamingTask.title}
          isPending={renameMutation.isPending}
          key={renamingTask.id}
          onClose={() => {
            setRenamingTask(null);
          }}
          onRename={(title) => void renameTask(renamingTask, title)}
        />
      )}

      {renamingProject === null ? null : (
        <ProjectRenameDialog
          error={hasSubmittedProjectAction ? (projectActionError?.message ?? null) : null}
          initialName={renamingProject.name}
          isPending={isProjectActionPending}
          key={renamingProject.id}
          onClose={() => {
            closeProjectDialog(renamingProject.id);
          }}
          onRename={(name) => {
            void submitProjectRename(renamingProject, name);
          }}
        />
      )}

      {removingProject === null ? null : (
        <ProjectRemoveDialog
          error={hasSubmittedProjectAction ? (projectActionError?.message ?? null) : null}
          isPending={isProjectActionPending}
          key={removingProject.id}
          onClose={() => {
            closeProjectDialog(removingProject.id);
          }}
          onRemove={() => {
            void confirmProjectRemoval(removingProject);
          }}
          project={removingProject}
        />
      )}

      <div className="p-2">
        <SidebarSettingsButton connectionState={connectionState} onOpen={onOpenSettings} />
      </div>
    </aside>
  );
}

type ProjectActionsProps = Readonly<{
  isPending: boolean;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  project: Project;
}>;

function ProjectActions({ isPending, onRemove, onRename, project }: ProjectActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<Readonly<{ left: number; top: number }>>();
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger === null) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const maximumLeft = Math.max(
      taskActionMenuViewportPadding,
      window.innerWidth - taskActionMenuWidth - taskActionMenuViewportPadding,
    );
    const belowTop = triggerRect.bottom + taskActionMenuGap;
    const maximumTop = window.innerHeight - projectActionMenuHeight - taskActionMenuViewportPadding;
    setMenuPosition({
      left: Math.min(Math.max(triggerRect.left, taskActionMenuViewportPadding), maximumLeft),
      top:
        belowTop <= maximumTop
          ? belowTop
          : Math.max(
              taskActionMenuViewportPadding,
              triggerRect.top - projectActionMenuHeight - taskActionMenuGap,
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
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
          triggerRef.current?.focus();
        }
      }}
      ref={menuContainerRef}
    >
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`打开 ${project.name} 的项目操作菜单`}
        className="grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus"
        disabled={isPending}
        id={`project-actions-${project.id}`}
        onClick={() => {
          setMenuOpen((open) => !open);
        }}
        ref={triggerRef}
        type="button"
      >
        <Ellipsis className="size-3.5" aria-hidden="true" />
      </button>
      {menuOpen && menuPosition !== undefined && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50"
              ref={menuRef}
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              <ProjectActionMenu
                isPending={isPending}
                onRemove={() => {
                  setMenuOpen(false);
                  onRemove(project);
                }}
                onRename={() => {
                  setMenuOpen(false);
                  onRename(project);
                }}
                project={project}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type ProjectActionMenuProps = Readonly<{
  isPending: boolean;
  onRemove: () => void;
  onRename: () => void;
  project: Project;
}>;

const projectActionClassName =
  "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover disabled:opacity-50";

export function ProjectActionMenu({
  isPending,
  onRemove,
  onRename,
  project,
}: ProjectActionMenuProps) {
  return (
    <div
      aria-label={`${project.name} 的项目操作`}
      className="w-32 rounded-surface bg-raised p-1 shadow-floating"
      role="menu"
    >
      <button
        className={projectActionClassName}
        disabled={isPending}
        onClick={onRename}
        role="menuitem"
        type="button"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        重命名
      </button>
      <button
        className={`${projectActionClassName} text-danger`}
        disabled={isPending}
        onClick={onRemove}
        role="menuitem"
        type="button"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        删除
      </button>
    </div>
  );
}

export function SidebarSettingsButton({
  connectionState,
  onOpen,
}: Readonly<{ connectionState: AgentEventConnectionState; onOpen: () => void }>) {
  const connectionStatus = getProjectSidebarConnectionStatus(connectionState);
  return (
    <button
      aria-label={`设置，终端连接状态：${connectionStatus.label}`}
      className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
      id="global-settings-trigger"
      onClick={onOpen}
      type="button"
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
    </button>
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
  attention: TaskAttention;
  icon?: React.ReactNode;
  isActionPending: boolean;
  isRunning: boolean;
  onArchive: (task: AgentTask) => void;
  onPin: (task: AgentTask) => void;
  onRename: (task: AgentTask) => void;
  task: AgentTask;
}>;

function TaskLink({
  active,
  attention,
  icon,
  isActionPending,
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
          attention={attention}
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
  attention: TaskAttention;
  isRunning: boolean;
  updatedAt: string;
}>;

export function TaskStatusIndicator({ attention, isRunning, updatedAt }: TaskStatusIndicatorProps) {
  if (attention === "approval") {
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

  if (attention === "completed") {
    return (
      <span
        aria-label="AI 回复已完成"
        className="task-status ml-auto inline-flex shrink-0 text-diff-added"
        role="status"
      >
        <CircleCheck className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (attention === "failed") {
    return (
      <span
        aria-label="AI 回复未完成"
        className="task-status ml-auto inline-flex shrink-0 text-danger"
        role="status"
      >
        <CircleAlert className="size-3.5" aria-hidden="true" />
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
