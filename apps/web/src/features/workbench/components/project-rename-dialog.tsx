/* eslint-disable jsx-a11y/no-autofocus -- 重命名 Dialog 由用户显式打开，按交互规范聚焦唯一输入框。 */
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog.js";
import { Input } from "../../../shared/ui/input.js";

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
  const [name, setName] = useState(initialName);

  const normalizedName = name.trim();

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
        aria-labelledby="project-rename-title"
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
            if (normalizedName.length > 0) {
              onRename(normalizedName);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle id="project-rename-title">{t("projectDialog.rename")}</DialogTitle>
            <DialogDescription>{t("projectDialog.renameDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            aria-label={t("projectDialog.name")}
            autoFocus
            className="h-9 w-full rounded-control bg-control px-3 text-body text-foreground outline-none focus:shadow-focus"
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
          <DialogFooter>
            <Button
              className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground"
              disabled={isPending}
              onClick={onClose}
              type="button"
              variant="ghost"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              disabled={isPending || normalizedName.length === 0 || normalizedName === initialName}
              type="submit"
            >
              {t("actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
