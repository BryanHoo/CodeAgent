import { lazy, Suspense } from "react";

import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import { GlobalSettingsDialog } from "../../settings/components/global-settings-dialog.js";
import { CommitChangesLauncher } from "./commit-changes-launcher.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { loadProjectSourceDialog } from "./workbench-shell-runtime.js";

const LazyProjectSourceDialog = lazy(() =>
  loadProjectSourceDialog().then((module) => ({ default: module.ProjectSourceDialog })),
);

export function WorkbenchShellDialogs({
  context,
  projectId,
  taskId,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  taskId?: string;
}>) {
  const {
    access,
    client,
    closeTaskRenameDialog,
    commitChangesLauncherRef,
    gitStatusQuery,
    globalSettingsMutation,
    globalSettingsOpen,
    globalSettingsQuery,
    models,
    modelsQuery,
    projectOpenCapabilitiesQuery,
    projectRuntime,
    renameActiveTask,
    renameMutation,
    selectedFileChange,
    selectedFileReview,
    selectedSourceFile,
    selectedSubagent,
    setFileDiffSelection,
    setFileReviewSelection,
    setGlobalSettingsOpen,
    setSourceFileSelection,
    setSubagentDialogSelection,
    taskRenameError,
    taskRenameOpen,
    title,
  } = context;
  return (
    <>
      <FileDiffDialog
        change={selectedFileChange}
        onClose={() => {
          setFileDiffSelection(null);
        }}
      />
      <FileReviewDialog
        changes={selectedFileReview}
        onClose={() => {
          setFileReviewSelection(null);
        }}
      />
      {gitStatusQuery.data === undefined ? null : (
        <CommitChangesLauncher
          client={client}
          gitStatus={gitStatusQuery.data}
          projectId={projectId}
          ref={commitChangesLauncherRef}
        />
      )}
      {selectedSourceFile === null ? null : (
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
        <GlobalSettingsDialog
          {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
          apps={projectOpenCapabilitiesQuery.data?.apps ?? []}
          error={
            globalSettingsQuery.error ?? modelsQuery.error ?? projectOpenCapabilitiesQuery.error
          }
          isPending={
            globalSettingsQuery.isPending ||
            modelsQuery.isPending ||
            projectOpenCapabilitiesQuery.isPending
          }
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
              projectOpenCapabilitiesQuery.refetch(),
            ])
          }
          onSave={(settings) => globalSettingsMutation.mutateAsync(settings).then(() => undefined)}
          {...(globalSettingsQuery.data === undefined
            ? {}
            : { settings: globalSettingsQuery.data.settings })}
        />
      ) : null}
    </>
  );
}
