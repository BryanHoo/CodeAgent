import { Link, useNavigate } from "@tanstack/react-router";
import {
  TEMPORARY_TASK_SCOPE_ID,
  type AgentTask,
  type AppInfoResponse,
  type Project,
} from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PanelLeftClose, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";
import {
  useProjectActions,
  useProjectActivity,
  useProjectData,
  usePinnedProjectTasks,
  useProjectTaskSearch,
} from "../../projects/project-context.js";
import {
  removeArchivedProjectTaskAndRefill,
  replaceProjectTaskInQueryCaches,
  taskArchiveMutationOptions,
  taskPinMutationOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { removeRetainedTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { useProjectReordering } from "../hooks/use-project-reordering.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "../project-sidebar-preferences.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import { ProjectDirectoryPickerDialog } from "../../projects/components/project-directory-picker-dialog.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";

import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";
import { groupTasksByProjectId } from "./project-sidebar-state.js";
export * from "./project-sidebar-actions.js";
export * from "./project-sidebar-state.js";
export * from "./project-sidebar-task-row.js";

const primaryActionClassName =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small font-medium text-foreground transition-colors hover:bg-control-hover";
const primaryActionIconClassName = "size-4 shrink-0 text-muted-foreground";
type ProjectSidebarProps = Readonly<{
  appInfo?: AppInfoResponse;
  onClose: () => void;
  onOpenSettings: () => void;
  projectId?: string;
  taskId?: string;
}>;

export function ProjectSidebar({
  appInfo,
  onClose,
  onOpenSettings,
  projectId,
  taskId,
}: ProjectSidebarProps) {
  const { t } = useTranslation("workbench");
  const { client, error, isPending, projects, projectTaskStates, tasks } = useProjectData();
  const {
    addProject,
    fetchNextProjectTaskPage,
    forgetTask,
    reorderProjects,
    removeProject,
    renameProject,
    setExpandedProjectTaskIds,
  } = useProjectActions();
  const {
    addProjectError,
    isProjectActionPending,
    isProjectOrderPending,
    isProjectAddPending,
    projectActionError,
    projectOrderError,
    taskActivity,
  } = useProjectActivity();
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
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [hasSubmittedAddProject, setHasSubmittedAddProject] = useState(false);
  const [hasSubmittedProjectAction, setHasSubmittedProjectAction] = useState(false);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const pinMutation = useMutation(taskPinMutationOptions(client));
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const archiveMutation = useMutation(taskArchiveMutationOptions(client));
  const taskActionLockRef = useRef(createAsyncActionLock());
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const taskSearch = useProjectTaskSearch(normalizedQuery);
  const pinnedTasks = usePinnedProjectTasks().filter(
    (task) =>
      normalizedQuery.length === 0 || task.title.toLocaleLowerCase().includes(normalizedQuery),
  );
  const visibleTasks = normalizedQuery.length === 0 ? tasks : taskSearch.tasks;
  // 大列表只分组一次，Project 渲染不再重复扫描全部 Task。
  const tasksByProjectId = useMemo(() => groupTasksByProjectId(visibleTasks), [visibleTasks]);
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
  useEffect(() => {
    if (
      isPending ||
      projectId === undefined ||
      projectId === TEMPORARY_TASK_SCOPE_ID ||
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

  useEffect(() => {
    // 任务列表请求跟随可见文件夹；当前路由 Project 由 ProjectProvider 单独保持激活。
    setExpandedProjectTaskIds(expandedProjects);
  }, [expandedProjects, setExpandedProjectTaskIds]);

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

  const addSelectedProject = async (rootPath: string) => {
    setHasSubmittedAddProject(true);
    const project = await addProject(rootPath);
    if (project !== undefined) {
      setIsProjectPickerOpen(false);
      setHasSubmittedAddProject(false);
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

  const pinTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
      setTaskActionError(null);
      try {
        const response = await pinMutation.mutateAsync({
          pinned: !task.pinned,
          projectId: task.projectId,
          taskId: task.id,
        });
        replaceTaskCache(response.task);
      } catch {
        setTaskActionError(t("sidebar.errorPinTask"));
      }
    });

  const renameTask = (task: AgentTask, title: string) =>
    taskActionLockRef.current.run(async () => {
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
        setTaskActionError(t("sidebar.errorRenameTask"));
      }
    });

  const archiveTask = (task: AgentTask) =>
    taskActionLockRef.current.run(async () => {
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
          await (task.projectId === TEMPORARY_TASK_SCOPE_ID
            ? navigate({ to: "/temporary" })
            : navigate({ params: { projectId: task.projectId }, to: "/p/$projectId" }));
        }
        removeRetainedTaskRuntime(task.projectId, task.id);
        // 归档后的 Runtime 清理由 Provider 判定安全性，失败不回滚已成功的归档。
        void client.unsubscribeTask(task.projectId, task.id).catch(() => undefined);
      } catch {
        setTaskActionError(t("sidebar.errorArchiveTask"));
      }
    });

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
      aria-label={t("sidebar.landmark")}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t("sidebar.close")}
              className="min-workbench:hidden"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PanelLeftClose className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.close")}</TooltipContent>
        </Tooltip>
      </div>

      <nav className="space-y-0.5 px-2" aria-label={t("sidebar.agentNavigation")}>
        <div className="relative px-1 pb-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label={t("sidebar.search")}
            className="h-9 w-full rounded-control bg-control pl-8 pr-2.5 text-body-small text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:shadow-focus"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder={t("sidebar.search")}
            value={query}
          />
        </div>
        <Link className={primaryActionClassName} to="/temporary">
          <Send className={primaryActionIconClassName} aria-hidden="true" />
          {t("sidebar.newTask")}
        </Link>
      </nav>

      <ProjectSidebarTaskList
        archiveTask={archiveTask}
        error={error}
        expandedProjects={expandedProjects}
        expandedTaskProjects={expandedTaskProjects}
        fetchNextProjectTaskPage={fetchNextProjectTaskPage}
        getProjectReorderProps={getProjectReorderProps}
        hasTaskError={hasTaskError}
        isPending={isPending}
        isProjectActionPending={isProjectActionPending}
        isProjectAddPending={isProjectAddPending}
        normalizedQuery={normalizedQuery}
        onOpenTemporaryDraft={() => {
          void navigate({ to: "/temporary" });
        }}
        onOpenProjectDraft={openProjectDraft}
        onOpenProjectPicker={() => {
          setHasSubmittedAddProject(false);
          setIsProjectPickerOpen(true);
        }}
        onRemoveProject={(project) => {
          setHasSubmittedProjectAction(false);
          setRemovingProject(project);
        }}
        onRenameProject={(project) => {
          setHasSubmittedProjectAction(false);
          setRenamingProject(project);
        }}
        orderedProjects={orderedProjects}
        pinTask={pinTask}
        pinnedTasks={pinnedTasks}
        {...(projectId === undefined ? {} : { projectId })}
        projectOrderAnnouncement={projectOrderAnnouncement}
        projectOrderError={projectOrderError}
        projectTaskStates={projectTaskStates}
        reorderingProjectId={reorderingProjectId}
        setExpandedTaskProjects={setExpandedTaskProjects}
        setRenamingTask={setRenamingTask}
        taskActionError={taskActionError}
        taskActionPending={taskActionPending}
        taskActivity={taskActivity}
        {...(taskId === undefined ? {} : { taskId })}
        taskSearch={taskSearch}
        tasksByProjectId={tasksByProjectId}
        toggleProject={toggleProject}
      />

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

      {isProjectPickerOpen ? (
        <ProjectDirectoryPickerDialog
          addError={hasSubmittedAddProject ? addProjectError : null}
          client={client}
          isAdding={isProjectAddPending}
          onAdd={addSelectedProject}
          onClose={() => {
            if (!isProjectAddPending) {
              setIsProjectPickerOpen(false);
              setHasSubmittedAddProject(false);
            }
          }}
        />
      ) : null}

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
        <SidebarSettingsButton
          {...(appInfo === undefined ? {} : { appInfo })}
          onOpen={onOpenSettings}
        />
      </div>
    </aside>
  );
}
