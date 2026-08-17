import type { AgentTask, Project } from "@code-agent/protocol";
import type { ComponentProps } from "react";

import { ProjectDirectoryPickerDialog } from "../../projects/components/project-directory-picker-dialog.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";

type ProjectSidebarDialogsProps = Readonly<{
  addProjectError: Error | null;
  client: ComponentProps<typeof ProjectDirectoryPickerDialog>["client"];
  hasSubmittedAddProject: boolean;
  hasSubmittedProjectAction: boolean;
  isProjectActionPending: boolean;
  isProjectAddPending: boolean;
  isProjectPickerOpen: boolean;
  onAddProject: (rootPath: string) => Promise<void>;
  onCloseProjectDialog: (projectId: string) => void;
  onCloseProjectPicker: () => void;
  onCloseTaskRename: () => void;
  onRemoveProject: (project: Project) => void;
  onRenameProject: (project: Project, name: string) => void;
  onRenameTask: (task: AgentTask, title: string) => void;
  projectActionError: Error | null;
  removingProject: Project | null;
  renamingProject: Project | null;
  renamingTask: AgentTask | null;
  taskRenamePending: boolean;
}>;

export function ProjectSidebarDialogs({
  addProjectError,
  client,
  hasSubmittedAddProject,
  hasSubmittedProjectAction,
  isProjectActionPending,
  isProjectAddPending,
  isProjectPickerOpen,
  onAddProject,
  onCloseProjectDialog,
  onCloseProjectPicker,
  onCloseTaskRename,
  onRemoveProject,
  onRenameProject,
  onRenameTask,
  projectActionError,
  removingProject,
  renamingProject,
  renamingTask,
  taskRenamePending,
}: ProjectSidebarDialogsProps) {
  return (
    <>
      {renamingTask === null ? null : (
        <TaskRenameDialog
          initialTitle={renamingTask.title}
          isPending={taskRenamePending}
          key={renamingTask.id}
          onClose={onCloseTaskRename}
          onRename={(title) => {
            onRenameTask(renamingTask, title);
          }}
        />
      )}

      {isProjectPickerOpen ? (
        <ProjectDirectoryPickerDialog
          addError={hasSubmittedAddProject ? addProjectError : null}
          client={client}
          isAdding={isProjectAddPending}
          onAdd={onAddProject}
          onClose={onCloseProjectPicker}
        />
      ) : null}

      {renamingProject === null ? null : (
        <ProjectRenameDialog
          error={hasSubmittedProjectAction ? (projectActionError?.message ?? null) : null}
          initialName={renamingProject.name}
          isPending={isProjectActionPending}
          key={renamingProject.id}
          onClose={() => {
            onCloseProjectDialog(renamingProject.id);
          }}
          onRename={(name) => {
            onRenameProject(renamingProject, name);
          }}
        />
      )}

      {removingProject === null ? null : (
        <ProjectRemoveDialog
          error={hasSubmittedProjectAction ? (projectActionError?.message ?? null) : null}
          isPending={isProjectActionPending}
          key={removingProject.id}
          onClose={() => {
            onCloseProjectDialog(removingProject.id);
          }}
          onRemove={() => {
            onRemoveProject(removingProject);
          }}
          project={removingProject}
        />
      )}
    </>
  );
}
