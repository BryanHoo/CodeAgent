/* eslint-disable jsx-a11y/no-autofocus -- 重命名 Dialog 由用户显式打开，按交互规范聚焦唯一输入框。 */
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog.js";
import { Input } from "../../../shared/ui/input.js";

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
  const [title, setTitle] = useState(initialTitle);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        aria-labelledby="task-rename-title"
        className="max-w-96 p-4"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedTitle = title.trim();
            if (normalizedTitle.length > 0) {
              onRename(normalizedTitle);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle id="task-rename-title">{t("taskDialog.rename")}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label={t("taskDialog.name")}
            autoFocus
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
          <DialogFooter>
            <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
              {t("actions.cancel")}
            </Button>
            <Button disabled={isPending || title.trim().length === 0} type="submit">
              {t("actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
