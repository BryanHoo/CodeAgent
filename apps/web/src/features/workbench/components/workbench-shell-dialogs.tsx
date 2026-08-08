import { lazy, Suspense } from "react";

import { loadGlobalSettingsDialog } from "../../settings/components/global-settings-lazy.js";
import { CommitChangesLauncher } from "./commit-changes-launcher.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import {
  loadFileDiffDialog,
  loadFileReviewDialog,
  loadGitHistoryDialog,
  loadProjectSourceDialog,
} from "./workbench-shell-runtime.js";

const LazyFileDiffDialog = lazy(() =>
  loadFileDiffDialog().then((module) => ({ default: module.FileDiffDialog })),
);
const LazyFileReviewDialog = lazy(() =>
  loadFileReviewDialog().then((module) => ({ default: module.FileReviewDialog })),
);
const LazyGlobalSettingsDialog = lazy(() =>
  loadGlobalSettingsDialog().then((module) => ({ default: module.GlobalSettingsDialog })),
);
const LazyGitHistoryDialog = lazy(() =>
  loadGitHistoryDialog().then((module) => ({ default: module.GitHistoryDialog })),
);

const LazyProjectSourceDialog = lazy(() =>
  loadProjectSourceDialog().then((module) => ({ default: module.ProjectSourceDialog })),
);

export function WorkbenchShellDialogs({
  context,
  projectId,
  projectToolsEnabled,
  taskId,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  projectToolsEnabled: boolean;
  taskId?: string;
}>) {
  const {
    access,
    appInfoQuery,
    appUpdateMutation,
    client,
    closeTaskRenameDialog,
    commitChangesLauncherRef,
    gitStatusQuery,
    gitHistoryOpen,
    globalSettingsMutation,
    globalSettingsOpen,
    globalSettingsQuery,
    models,
    modelsQuery,
    openFileDiff,
    projectOpenCapabilitiesQuery,
    projectRuntime,
    queryClient,
    renameActiveTask,
    renameMutation,
    selectedFileChange,
    selectedFileReview,
    selectedSourceFile,
    selectedSubagent,
    setFileDiffSelection,
    setFileReviewSelection,
    setGlobalSettingsOpen,
    setGitHistoryOpen,
    setSourceFileSelection,
    setSubagentDialogSelection,
    taskRenameError,
    taskRenameOpen,
    title,
  } = context;
  return (
    <>
      {!projectToolsEnabled || selectedFileChange === null ? null : (
        <Suspense fallback={null}>
          <LazyFileDiffDialog
            change={selectedFileChange}
            onClose={() => {
              setFileDiffSelection(null);
            }}
          />
        </Suspense>
      )}
      {!projectToolsEnabled || selectedFileReview === null ? null : (
        <Suspense fallback={null}>
          <LazyFileReviewDialog
            changes={selectedFileReview}
            onClose={() => {
              setFileReviewSelection(null);
            }}
          />
        </Suspense>
      )}
      {!projectToolsEnabled || gitStatusQuery.data === undefined ? null : (
        <CommitChangesLauncher
          client={client}
          gitStatus={gitStatusQuery.data}
          onOpenFileDiff={openFileDiff}
          projectId={projectId}
          ref={commitChangesLauncherRef}
        />
      )}
      {projectToolsEnabled && gitHistoryOpen ? (
        <Suspense fallback={null}>
          <LazyGitHistoryDialog
            client={client}
            onClose={() => {
              setGitHistoryOpen(false);
              // 下次打开必须重新读取当前检出的 HEAD，避免分支切换后短暂显示旧历史。
              queryClient.removeQueries({
                exact: false,
                queryKey: ["projects", projectId, "git-history"],
              });
              queryClient.removeQueries({
                exact: false,
                queryKey: ["projects", projectId, "git-commit-files"],
              });
              queryClient.removeQueries({
                exact: false,
                queryKey: ["projects", projectId, "git-commit-diff"],
              });
              requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>("#workbench-git-history")?.focus();
              });
            }}
            projectId={projectId}
          />
        </Suspense>
      ) : null}
      {!projectToolsEnabled || selectedSourceFile === null ? null : (
        <Suspense fallback={null}>
          <LazyProjectSourceDialog
            client={client}
            onClose={() => {
              setSourceFileSelection(null);
            }}
            projectId={projectId}
            previewKind={selectedSourceFile.kind}
            reference={selectedSourceFile.reference}
          />
        </Suspense>
      )}
      <SubagentOutputDialog
        onClose={() => {
          setSubagentDialogSelection(null);
        }}
        projectId={projectId}
        projectRuntime={projectRuntime}
        selection={selectedSubagent}
      />
      {taskRenameOpen && taskId !== undefined ? (
        <TaskRenameDialog
          error={taskRenameError}
          initialTitle={title}
          isPending={renameMutation.isPending}
          key={`${projectId}:${taskId}`}
          onClose={closeTaskRenameDialog}
          onRename={(nextTitle) => void renameActiveTask(nextTitle)}
        />
      ) : null}
      {globalSettingsOpen ? (
        <Suspense fallback={null}>
          <LazyGlobalSettingsDialog
            {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            apps={projectToolsEnabled ? (projectOpenCapabilitiesQuery.data?.apps ?? []) : []}
            error={
              globalSettingsQuery.error ??
              modelsQuery.error ??
              (projectToolsEnabled ? projectOpenCapabilitiesQuery.error : null)
            }
            isPending={
              globalSettingsQuery.isPending ||
              modelsQuery.isPending ||
              (projectToolsEnabled && projectOpenCapabilitiesQuery.isPending)
            }
            initialSection="about"
            isAppInfoPending={appInfoQuery.isPending}
            isAppUpdatePending={appUpdateMutation.isPending}
            models={models}
            onClose={() => {
              setGlobalSettingsOpen(false);
              requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>("#global-settings-trigger")?.focus();
              });
            }}
            onLogoutAccess={access.logout}
            onRetry={() =>
              Promise.all([
                globalSettingsQuery.refetch(),
                modelsQuery.refetch(),
                ...(projectToolsEnabled ? [projectOpenCapabilitiesQuery.refetch()] : []),
              ])
            }
            onRetryAppInfo={() => appInfoQuery.refetch()}
            onSave={(settings) =>
              globalSettingsMutation.mutateAsync(settings).then(() => undefined)
            }
            onUpdate={(version) => appUpdateMutation.mutateAsync(version).then(() => undefined)}
            updateError={appUpdateMutation.error}
            {...(globalSettingsQuery.data === undefined
              ? {}
              : { settings: globalSettingsQuery.data.settings })}
          />
        </Suspense>
      ) : null}
    </>
  );
}
