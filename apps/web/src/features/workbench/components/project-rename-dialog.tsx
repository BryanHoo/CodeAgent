import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";

type ProjectRenameDialogProps = Readonly<{
  error?: string | null;
  initialName: string;
  isPending: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}>;

export function ProjectRenameDialog({
  error = null,
  initialName,
  isPending,
  onClose,
  onRename,
}: ProjectRenameDialogProps) {
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      // 原生 Dialog 统一处理焦点圈定和 Escape，关闭后由 Sidebar 恢复触发器焦点。
      dialog.showModal();
    }
  }, []);

  const normalizedName = name.trim();

  return (
    <dialog
      aria-labelledby="project-rename-title"
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
          if (normalizedName.length > 0) {
            onRename(normalizedName);
          }
        }}
      >
        <h2 className="text-heading font-semibold" id="project-rename-title">
          {t("projectDialog.rename")}
        </h2>
        <p className="mt-1 text-body-small text-muted-foreground">
          {t("projectDialog.renameDescription")}
        </p>
        <input
          aria-label={t("projectDialog.name")}
          autoFocus
          className="mt-3 h-9 w-full rounded-control bg-control px-3 text-body text-foreground outline-none focus:shadow-focus"
          disabled={isPending}
          maxLength={200}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          value={name}
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
            disabled={isPending || normalizedName.length === 0 || normalizedName === initialName}
            type="submit"
          >
            {t("actions.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
