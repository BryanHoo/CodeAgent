import { FilePenLine, FilePlus2, Trash2 } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputButton } from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/components/core/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { ProjectDraftRecord } from "../project-draft-store.js";
import { getProjectDraftSummary } from "../project-draft-summary.js";

export function ComposerDraftSaveButton({
  disabled,
  editing,
  onSave,
}: Readonly<{
  disabled: boolean;
  editing: boolean;
  onSave: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const label = t(editing ? "composer.saveDraftChanges" : "composer.saveAsDraft");
  const DraftIcon = editing ? FilePenLine : FilePlus2;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton aria-label={label} disabled={disabled} onClick={onSave}>
          <DraftIcon aria-hidden="true" className="size-3.5" />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectDraftList({
  composerHasInput,
  drafts,
  onDelete,
  onRestore,
  projectName,
}: Readonly<{
  composerHasInput: boolean;
  drafts: readonly ProjectDraftRecord[];
  onDelete: (draftId: string) => void;
  onRestore: (draftId: string) => void;
  projectName: string;
}>) {
  const { t, i18n } = useTranslation("workbench");
  const [open, setOpen] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string>();
  const draftListLabel = t("composer.draftList", { project: projectName });
  if (drafts.length === 0) return null;
  const restoreDraft = (draftId: string) => {
    setOpen(false);
    if (composerHasInput) {
      setPendingDraftId(draftId);
      return;
    }
    onRestore(draftId);
  };
  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t("composer.draftCount", { count: drafts.length })}
            className="h-6 px-1.5 text-caption"
            size="toolbar"
            type="button"
            variant="ghost"
          >
            {t("composer.draftCount", { count: drafts.length })}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={draftListLabel}
          className="w-96 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
          role="dialog"
          side="top"
        >
          <div className="border-b border-separator px-3 py-2 text-label font-medium">
            {draftListLabel}
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="list">
            {drafts.map((draft) => {
              const attachmentFallback = t("composer.attachmentCount", {
                count: draft.draft.attachments.length,
              });
              const summary = getProjectDraftSummary(draft, attachmentFallback);
              return (
                <div
                  className="group flex h-11 min-w-0 items-center gap-1"
                  key={draft.id}
                  role="listitem"
                >
                  <Button
                    aria-label={summary}
                    className="h-full min-w-0 flex-1 px-2 py-1"
                    contentAlign="start"
                    onClick={() => restoreDraft(draft.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="block truncate text-body-small text-foreground">
                        {summary}
                      </span>
                      <span className="mt-px flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
                        <span className="truncate">
                          {new Date(draft.updatedAt).toLocaleString(i18n.language)}
                        </span>
                        {draft.workingDraft === undefined ? null : (
                          <span className="shrink-0 text-brand">
                            {t("composer.draftHasChanges")}
                          </span>
                        )}
                      </span>
                    </span>
                  </Button>
                  <Button
                    aria-label={t("composer.deleteDraft", { summary })}
                    className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={() => onDelete(draft.id)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDraftId(undefined);
        }}
        open={pendingDraftId !== undefined}
      >
        <DialogContent className="max-w-96 p-4">
          <DialogHeader>
            <DialogTitle>{t("composer.applyDraftTitle")}</DialogTitle>
            <DialogDescription>{t("composer.applyDraftDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDraftId(undefined)} type="button" variant="ghost">
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={() => {
                const draftId = pendingDraftId;
                setPendingDraftId(undefined);
                if (draftId !== undefined) onRestore(draftId);
              }}
              type="button"
            >
              {t("composer.applyDraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
