import type { AgentEventConnectionState } from "@code-agent/client";
import type { AppInfoResponse, Project } from "@code-agent/protocol";
import {
  Ellipsis,
  LoaderCircle,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import { getProjectSidebarConnectionStatus } from "./project-sidebar-state.js";

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
  connectionState,
  onOpen,
}: Readonly<{
  appInfo?: AppInfoResponse;
  connectionState: AgentEventConnectionState;
  onOpen: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const connectionStatus = getProjectSidebarConnectionStatus(connectionState);
  const connectionStatusLabel = t(connectionStatus.labelKey);
  const appVersion = appInfo?.appVersion ?? "…";
  const updateLabel = appInfo?.updateAvailable === true ? t("sidebar.updateAvailableLabel") : "";
  return (
    <Button
      variant="ghost"
      aria-label={t("sidebar.connectionSettings", {
        status: connectionStatusLabel,
        update: updateLabel,
        version: appVersion,
      })}
      className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body-small text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
      contentAlign="start"
      id="global-settings-trigger"
      onClick={onOpen}
      type="button"
    >
      <Settings className="size-4" aria-hidden="true" />
      {t("sidebar.settings")}
      <span aria-live="polite" className="ml-auto inline-flex items-center gap-1 text-caption">
        <span
          className={appInfo?.updateAvailable === true ? "text-warning" : "text-muted-foreground"}
        >
          v{appVersion}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className={`inline-flex items-center gap-1 ${connectionStatus.toneClassName}`}>
          <ProjectSidebarConnectionIcon connectionState={connectionState} />
          {connectionStatusLabel}
        </span>
      </span>
    </Button>
  );
}

export function ProjectSidebarConnectionIcon({
  connectionState,
}: Readonly<{ connectionState: AgentEventConnectionState }>) {
  if (connectionState === "connected") {
    return <Wifi className="size-3" aria-hidden="true" />;
  }
  if (connectionState === "closed") {
    return <WifiOff className="size-3" aria-hidden="true" />;
  }
  return (
    <span className="inline-flex animate-spin" aria-hidden="true">
      <LoaderCircle className="size-3" />
    </span>
  );
}
