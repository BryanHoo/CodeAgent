import type { AppInfoResponse, Project } from "@code-agent/protocol";
import { CircleArrowUp, Ellipsis, Pencil, Plus, Settings, Trash2 } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export function ProjectPickerButton({
  disabled,
  onOpen,
}: Readonly<{ disabled: boolean; onOpen: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={t("sidebar.addProject")}
          disabled={disabled}
          onClick={onOpen}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("sidebar.addProject")}</TooltipContent>
    </Tooltip>
  );
}

type ProjectActionsProps = Readonly<{
  isPending: boolean;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  project: Project;
}>;

export function ProjectActions({ isPending, onRemove, onRename, project }: ProjectActionsProps) {
  const { t } = useTranslation("workbench");

  return (
    <div className="relative shrink-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label={t("sidebar.openProjectActions", { project: project.name })}
            className="grid size-7 place-items-center rounded-control text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus group-hover/project:opacity-100 data-[state=open]:opacity-100"
            disabled={isPending}
            id={`project-actions-${project.id}`}
            type="button"
          >
            <Ellipsis className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <ProjectActionMenu
          isPending={isPending}
          onRemove={() => {
            onRemove(project);
          }}
          onRename={() => {
            onRename(project);
          }}
          project={project}
        />
      </DropdownMenu>
    </div>
  );
}

type ProjectActionMenuProps = Readonly<{
  isPending: boolean;
  onRemove: () => void;
  onRename: () => void;
  project: Project;
}>;

const projectActionClassName = "h-8 w-full text-left text-foreground";

export function ProjectActionMenu({
  isPending,
  onRemove,
  onRename,
  project,
}: ProjectActionMenuProps) {
  const { t } = useTranslation("workbench");
  return (
    <DropdownMenuContent
      align="start"
      aria-label={t("sidebar.projectActions", { project: project.name })}
      aria-labelledby={undefined}
      className="w-32"
    >
      <DropdownMenuItem className={projectActionClassName} disabled={isPending} onSelect={onRename}>
        <Pencil className="size-3.5" aria-hidden="true" />
        {t("sidebar.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={`${projectActionClassName} text-danger`}
        disabled={isPending}
        onSelect={onRemove}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t("sidebar.remove")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function SidebarSettingsButton({
  appInfo,
  onOpenAbout,
  onOpenSettings,
}: Readonly<{
  appInfo?: AppInfoResponse;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const appVersion = appInfo?.appVersion ?? "…";
  const updateAvailable = appInfo?.updateAvailable === true;
  return (
    <div className="flex h-6 w-full min-w-0 items-center text-caption text-muted-foreground">
      <Button
        variant="ghost"
        aria-label={t("sidebar.settings")}
        className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-control px-1 text-caption text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
        contentAlign="start"
        id="global-settings-trigger"
        onClick={onOpenSettings}
        type="button"
      >
        <Settings className="size-3" aria-hidden="true" />
        {t("sidebar.settings")}
      </Button>
      <Button
        variant="ghost"
        aria-label={t("sidebar.settingsLabel", {
          update: updateAvailable ? t("sidebar.updateAvailableLabel") : "",
          version: appVersion,
        })}
        className={`h-6 rounded-control px-1 text-caption transition-colors hover:bg-control-hover hover:text-foreground ${
          updateAvailable ? "text-warning" : "text-muted-foreground"
        }`}
        id="global-about-trigger"
        onClick={onOpenAbout}
        type="button"
      >
        <span aria-live="polite">
          {updateAvailable ? (
            <CircleArrowUp aria-hidden="true" className="mr-1 inline size-3" />
          ) : null}
          v{appVersion}
        </span>
      </Button>
    </div>
  );
}
