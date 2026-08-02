import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import { useTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { Task, TaskTrigger } from "../../../shared/ai-elements/task.js";
import type { SubagentSelection } from "./subagent.js";
import { toSubagentTaskStatus } from "./subagent.js";
import { TaskTimeline } from "./task-timeline.js";
import { useTranslation } from "../../../i18n/i18n.js";

type SubagentOutputDialogProps = Readonly<{
  onClose: () => void;
  projectId: string;
  projectRuntime: ProjectRuntimeManager;
  selection: SubagentSelection | null;
}>;

function SubagentOutputState({
  message,
  role,
}: Readonly<{ message: string; role?: "alert" | "status" }>) {
  return (
    <div
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </div>
  );
}

export function SubagentOutputDialog({
  onClose,
  projectId,
  projectRuntime,
  selection,
}: SubagentOutputDialogProps) {
  if (selection === null) {
    return null;
  }
  return (
    <OpenSubagentOutputDialog
      onClose={onClose}
      projectId={projectId}
      projectRuntime={projectRuntime}
      selection={selection}
    />
  );
}

function OpenSubagentOutputDialog({
  onClose,
  projectId,
  projectRuntime,
  selection,
}: Readonly<Omit<SubagentOutputDialogProps, "selection"> & { selection: SubagentSelection }>) {
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const runtime = useTaskRuntime(projectId, selection.taskId, projectRuntime);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const titleId = "subagent-output-dialog-title";
  let content;
  if (runtime.error !== null) {
    content = <SubagentOutputState message={t("subagentOutput.error")} role="alert" />;
  } else if (runtime.isPending || runtime.snapshot === undefined) {
    content = <SubagentOutputState message={t("subagentOutput.loading")} role="status" />;
  } else {
    content = (
      <>
        {runtime.connectionState === "reconnecting" ? (
          <div
            className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
            role="status"
          >
            {t("subagentOutput.reconnecting")}
          </div>
        ) : null}
        <TaskTimeline projectId={projectId} runtime={runtime} taskId={selection.taskId} />
      </>
    );
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto h-[min(86vh,58rem)] w-[min(94vw,76rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      data-subagent-output-dialog=""
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
        <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId}>
              {t("subagentOutput.title")}
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={selection.taskId}>
              {selection.taskId}
            </p>
          </div>
          <Task collapsible={false} status={toSubagentTaskStatus(selection.status)}>
            <TaskTrigger title={t("subagentOutput.task", { taskId: selection.taskId })} />
          </Task>
          <button
            aria-label={t("subagentOutput.close")}
            className="grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            onClick={onClose}
            type="button"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-col overflow-hidden bg-content">{content}</div>
      </section>
    </dialog>
  );
}
