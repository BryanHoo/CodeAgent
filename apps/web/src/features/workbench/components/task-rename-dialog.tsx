import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";

type TaskRenameDialogProps = Readonly<{
  error?: string | null;
  initialTitle: string;
  isPending: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
}>;

export function TaskRenameDialog({
  error = null,
  initialTitle,
  isPending,
  onClose,
  onRename,
}: TaskRenameDialogProps) {
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      // 原生 dialog 负责焦点圈定和 Escape，避免背景工作台继续接收键盘操作。
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
          {t("taskDialog.rename")}
        </h2>
        <input
          aria-label={t("taskDialog.name")}
          autoFocus
          className="mt-3 h-9 w-full rounded-control bg-control px-3 text-body text-foreground outline-none focus:shadow-focus"
          disabled={isPending}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
          }}
          value={title}
        />
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
            {t("actions.cancel")}
          </button>
          <button
            className="h-8 rounded-control bg-accent px-3 text-body-small font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            disabled={isPending || title.trim().length === 0}
            type="submit"
          >
            {t("actions.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
