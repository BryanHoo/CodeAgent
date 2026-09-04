import {
  TEMPORARY_TASK_SCOPE_ID,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskPage,
} from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import "../../shared/styles/scheduled-tasks.css";
import type { useWorkbenchShellController } from "../workbench/components/workbench-shell-controller.js";
import { ScheduledTaskEditor } from "./scheduled-task-editor.js";
import { ScheduledTaskList } from "./scheduled-task-list.js";

const queryKey = ["scheduled-tasks"] as const;
const emptyTasks: readonly ScheduledTask[] = [];

export function ScheduledTasksContainer({
  context,
  projectId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  temporary: boolean;
}>) {
  const {
    capabilities,
    client,
    draftSettings,
    fastModeAvailable,
    fastModeDefault,
    gitStatusQuery,
    globalSettings,
    models,
    modelsQuery,
    navigate,
    openProjectFolder,
    projectFolderOpenDisabled,
    projectName,
    projectPath,
    projectRoots,
    projects,
    selectedRootId,
    setSelectedRootId,
    skillsQuery,
  } = context;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const tasksQuery = useQuery({
    queryFn: () => client.listScheduledTasks(),
    queryKey,
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => task.lastRunStatus === "running") === true
        ? 1_500
        : false,
  });
  const tasks = tasksQuery.data?.data ?? emptyTasks;
  const selectedTask = creating ? undefined : tasks.find((task) => task.id === selectedId);
  const visibleTasks = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return normalized === ""
      ? tasks
      : tasks.filter((task) =>
          `${task.name}\n${task.projectName}`.toLocaleLowerCase().includes(normalized),
        );
  }, [search, tasks]);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const saveMutation = useMutation({
    // 捕获模式由 Composer 展示保存错误，避免与根级 MutationCache 重复通知。
    meta: { actionNotification: false },
    mutationFn: ({ taskId, ...input }: ScheduledTaskInput & { taskId?: string }) =>
      taskId === undefined
        ? client.createScheduledTask(input)
        : client.updateScheduledTask(taskId, input),
    onSuccess: (response) => {
      setSelectedId(response.task.id);
      setCreating(false);
      void refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => client.deleteScheduledTask(taskId),
    onSuccess: () => {
      setSelectedId(undefined);
      setCreating(false);
      void refresh();
    },
  });
  const enabledMutation = useMutation({
    mutationFn: ({ enabled, taskId }: Readonly<{ enabled: boolean; taskId: string }>) =>
      client.setScheduledTaskEnabled(taskId, enabled),
    onSuccess: (response) => {
      // 立即替换任务快照，避免用户紧接着保存编辑内容时带回旧启停状态。
      queryClient.setQueryData<ScheduledTaskPage>(queryKey, (current) =>
        current === undefined
          ? current
          : {
              data: current.data.map((task) =>
                task.id === response.task.id ? response.task : task,
              ),
            },
      );
      void refresh();
    },
  });
  const runMutation = useMutation({
    mutationFn: (taskId: string) => client.runScheduledTaskNow(taskId),
    onSuccess: () => void refresh(),
  });

  const changeProject = (nextProjectId: string) => {
    void navigate(
      nextProjectId === TEMPORARY_TASK_SCOPE_ID
        ? { to: "/temporary/scheduled" }
        : { params: { projectId: nextProjectId }, to: "/p/$projectId/scheduled" },
    );
  };
  const selectTask = (task: ScheduledTask) => {
    setCreating(false);
    setSelectedId(task.id);
    if (task.projectId !== projectId) changeProject(task.projectId);
  };
  const composerProps = {
    capabilities,
    client,
    fastModeAvailable,
    fastModeDefault,
    followUpBehavior: globalSettings?.followUpBehavior ?? "queue",
    ...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data }),
    models,
    modelsError: modelsQuery.error,
    modelsPending: modelsQuery.isPending,
    onFastModeChange: () => undefined,
    onOpenProjectPath: openProjectFolder,
    onProjectRootChange: setSelectedRootId,
    onSettingsChange: () => undefined,
    onTaskStarted: () => undefined,
    projectId,
    projectName,
    projectPath,
    projectPathOpenDisabled: projectFolderOpenDisabled,
    projectRoots,
    projectToolsEnabled: !temporary,
    selectedProjectRootId: selectedRootId ?? "",
    settings: draftSettings,
    skills: skillsQuery.data?.data ?? [],
  } as const;

  return (
    <div className="scheduled-tasks">
      <ScheduledTaskList
        {...(selectedTask === undefined ? {} : { activeId: selectedTask.id })}
        loading={tasksQuery.isPending}
        onCreate={() => {
          setCreating(true);
          setSelectedId(undefined);
        }}
        onEnabledChange={(taskId, enabled) => {
          enabledMutation.mutate({ enabled, taskId });
        }}
        onSelect={selectTask}
        query={search}
        setQuery={setSearch}
        tasks={visibleTasks}
      />
      {creating || selectedTask !== undefined ? (
        <ScheduledTaskEditor
          key={selectedTask?.id ?? `new:${projectId}`}
          composerProps={composerProps}
          onDelete={(taskId) => deleteMutation.mutateAsync(taskId).then(() => undefined)}
          onOpenRun={(runProjectId, taskId) => {
            void navigate(
              runProjectId === TEMPORARY_TASK_SCOPE_ID
                ? { params: { taskId }, to: "/temporary/t/$taskId" }
                : { params: { projectId: runProjectId, taskId }, to: "/p/$projectId/t/$taskId" },
            );
          }}
          onProjectChange={changeProject}
          onRunNow={(taskId) => runMutation.mutateAsync(taskId).then(() => undefined)}
          onSave={(taskId, input) =>
            saveMutation
              .mutateAsync({ ...input, ...(taskId === undefined ? {} : { taskId }) })
              .then(() => undefined)
          }
          projectId={projectId}
          projects={projects}
          skills={skillsQuery.data?.data ?? []}
          {...(selectedTask === undefined ? {} : { task: selectedTask })}
        />
      ) : (
        <div className="scheduled-task-welcome">
          <span>{context.t("scheduledTasks.selectTask")}</span>
        </div>
      )}
    </div>
  );
}
