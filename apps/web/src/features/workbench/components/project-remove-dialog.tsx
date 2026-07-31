import type { Project } from "@code-agent/protocol";
import { useEffect, useRef } from "react";

type ProjectRemoveDialogProps = Readonly<{
  error?: string | null;
  isPending: boolean;
  onClose: () => void;
  onRemove: () => void;
  project: Project;
}>;

export function ProjectRemoveDialog({
  error = null,
  isPending,
  onClose,
  onRemove,
  project,
}: ProjectRemoveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      aria-labelledby="project-remove-title"
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
      <div className="p-4">
        <h2 className="text-heading font-semibold" id="project-remove-title">
          删除项目
        </h2>
        <p className="mt-2 text-body-small text-muted-foreground">
          将“{project.name}”从 CodeAgent 左栏移除，不会删除磁盘上的文件夹及文件。
        </p>
        {error === null ? null : (
          <p className="mt-2 text-meta text-danger" role="alert">
            {error}
          </p>
        )}
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
            className="h-8 rounded-control bg-danger px-3 text-body-small font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={isPending}
            onClick={onRemove}
            type="button"
          >
            删除
          </button>
        </div>
      </div>
    </dialog>
  );
}
