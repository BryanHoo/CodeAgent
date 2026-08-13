import { ArrowRight, ArrowUp, Eye, EyeOff, LoaderCircle, RotateCcw } from "lucide-react";
import type { SubmitEvent } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { findActiveFilesystemRoot } from "../../../shared/lib/filesystem-roots.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { HostFilePickerTree, type HostFilePickerMode } from "./host-file-picker-tree.js";
import { type HostFilePickerLoader, useHostFilePicker } from "./use-host-file-picker.js";

type HostFilePickerDialogProps = Readonly<{
  error: Error | null;
  isConfirming: boolean;
  loadDirectory: HostFilePickerLoader;
  mode: HostFilePickerMode;
  onClose: () => void;
  onConfirm: (path: string) => Promise<void> | void;
}>;

function titleKey(mode: HostFilePickerMode) {
  if (mode === "directory") return "hostFilePicker.directoryTitle" as const;
  return mode === "image"
    ? ("hostFilePicker.imageTitle" as const)
    : ("hostFilePicker.fileTitle" as const);
}

export function HostFilePickerDialog({
  error,
  isConfirming,
  loadDirectory,
  mode,
  onClose,
  onConfirm,
}: HostFilePickerDialogProps) {
  const { t } = useTranslation("workbench");
  const picker = useHostFilePicker(mode, loadDirectory);
  const activeRoot =
    picker.listing === undefined
      ? undefined
      : findActiveFilesystemRoot(picker.listing.roots, picker.listing.path)?.path;
  const displayedPath = picker.pathInput ?? picker.listing?.path ?? "";
  const submitPath = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    picker.navigate(displayedPath);
  };
  const confirmLabel = t(mode === "directory" ? "projectPicker.add" : "hostAttachmentPicker.add");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isConfirming) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="host-file-picker-title"
        className="grid h-[min(88dvh,44rem)] w-[calc(100vw-1rem)] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[calc(100vw-2rem)]"
        onEscapeKeyDown={(event) => {
          if (isConfirming) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isConfirming) event.preventDefault();
        }}
      >
        <DialogHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle id="host-file-picker-title">{t(titleKey(mode))}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("hostFilePicker.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-center gap-2 border-y border-separator bg-panel px-3 py-2 sm:flex-nowrap sm:px-4"
          onSubmit={submitPath}
        >
          {picker.listing === undefined || picker.listing.roots.length < 2 ? null : (
            <Select
              onValueChange={picker.navigate}
              {...(activeRoot === undefined ? {} : { value: activeRoot })}
            >
              <SelectTrigger
                aria-label={t("hostFilePicker.filesystemRoot")}
                className="h-11 min-w-20 px-2 font-mono sm:h-8"
                size="sm"
              >
                <SelectValue placeholder={t("hostFilePicker.filesystemRoot")} />
              </SelectTrigger>
              <SelectContent position="popper">
                {picker.listing.roots.map((root) => (
                  <SelectItem key={root.path} value={root.path}>
                    {root.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("hostFilePicker.parent")}
                disabled={picker.listing?.parentPath === null || picker.listing === undefined}
                onClick={() => {
                  if (
                    picker.listing?.parentPath !== null &&
                    picker.listing?.parentPath !== undefined
                  ) {
                    picker.navigate(picker.listing.parentPath);
                  }
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("hostFilePicker.parent")}</TooltipContent>
          </Tooltip>
          <div className="order-last flex min-w-0 basis-full items-center rounded-control bg-raised shadow-sm sm:order-none sm:flex-1 sm:basis-0">
            <Input
              aria-label={t("hostFilePicker.absolutePath")}
              className="h-11 min-w-0 px-2.5 font-mono text-label sm:h-8"
              onChange={(event) => {
                picker.setPathInput(event.currentTarget.value);
              }}
              placeholder={t("hostFilePicker.pathPlaceholder")}
              value={displayedPath}
              variant="embedded"
            />
            <Button
              aria-label={t("hostFilePicker.goToPath")}
              className="mr-1"
              size="icon-sm"
              type="submit"
              variant="ghost"
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t(
                  picker.showHidden ? "hostFilePicker.hideHidden" : "hostFilePicker.showHidden",
                )}
                aria-pressed={picker.showHidden}
                onClick={picker.toggleHidden}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {picker.showHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t(picker.showHidden ? "hostFilePicker.hideHidden" : "hostFilePicker.showHidden")}
            </TooltipContent>
          </Tooltip>
        </form>

        <div className="min-h-0 px-3 py-2 sm:px-4">
          {picker.rootQuery.isPending ? (
            <p
              className="flex min-h-32 items-center justify-center gap-2 text-body-small text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t("hostFilePicker.loading")}
            </p>
          ) : picker.rootQuery.error !== null ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-body-small text-danger" role="alert">
                {t("hostFilePicker.loadError")}
              </p>
              <Button
                onClick={() => void picker.rootQuery.refetch()}
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {t("actions.retry")}
              </Button>
            </div>
          ) : picker.listing === undefined ? null : picker.listing.entries.length === 0 ? (
            <p className="grid min-h-32 place-items-center text-body-small text-muted-foreground">
              {t(
                mode === "directory" ? "hostFilePicker.emptyDirectory" : "hostFilePicker.emptyFile",
              )}
            </p>
          ) : (
            <HostFilePickerTree
              directoryStates={picker.directoryStates}
              expandedPaths={picker.expandedPaths}
              listing={picker.listing}
              mode={mode}
              onRetry={(path) => {
                const index = picker.expandedDirectoryPaths.indexOf(path);
                void picker.directoryQueries[index]?.refetch();
              }}
              onSelect={picker.select}
              onToggle={picker.toggle}
              {...(picker.selectedPath === undefined ? {} : { selectedPath: picker.selectedPath })}
            />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-separator bg-raised px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            <p
              aria-live="polite"
              className="truncate font-mono text-caption text-foreground"
              title={picker.selectedPath}
            >
              {picker.selectedPath ??
                t(mode === "directory" ? "hostFilePicker.noDirectory" : "hostFilePicker.noFile")}
            </p>
            {error === null ? null : (
              <p className="mt-1 text-meta text-danger" role="alert">
                {t(
                  mode === "directory"
                    ? "projectPicker.addError"
                    : "hostAttachmentPicker.importError",
                )}
              </p>
            )}
          </div>
          <DialogFooter className="w-full flex-col-reverse sm:w-auto sm:flex-row">
            <Button
              className="h-11 w-full sm:h-8 sm:w-auto"
              disabled={isConfirming}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="h-11 w-full sm:h-8 sm:w-auto"
              disabled={picker.selectedPath === undefined || isConfirming}
              onClick={() => {
                if (picker.selectedPath !== undefined) void onConfirm(picker.selectedPath);
              }}
              type="button"
            >
              {isConfirming ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
              {isConfirming ? t("hostFilePicker.confirming") : confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
