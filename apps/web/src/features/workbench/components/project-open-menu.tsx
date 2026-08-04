import type { ProjectOpenApp, ProjectOpenAppId, ProjectOpenAppKind } from "@code-agent/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Code2, ExternalLink, FolderOpen, Terminal, Wrench } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/ui/button.js";
import { ButtonGroup } from "../../../shared/ui/button-group.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../shared/ui/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { CodeAgentProjectOpenClient } from "../../projects/project-queries.js";
import { projectOpenCapabilitiesQueryOptions } from "../../projects/project-queries.js";
import {
  getProjectOpenPreferenceStorage,
  resolveProjectOpenAppId,
  writeProjectOpenAppId,
} from "../project-open-preferences.js";

const emptyApps: readonly ProjectOpenApp[] = [];

const appKindIcons = {
  editor: Code2,
  "file-manager": FolderOpen,
  "system-default": ExternalLink,
  terminal: Terminal,
  tool: Wrench,
} as const satisfies Record<ProjectOpenAppKind, typeof Code2>;

type ProjectOpenMenuItemsProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  isPending: boolean;
  onSelect: (appId: ProjectOpenAppId) => void;
  selectedAppId?: ProjectOpenAppId;
}>;

type ProjectOpenTargetType = "directory" | "file";

export function getProjectOpenAppsForTarget(
  apps: readonly ProjectOpenApp[],
  targetType: ProjectOpenTargetType,
): readonly ProjectOpenApp[] {
  return targetType === "file" ? apps : apps.filter((app) => app.kind !== "system-default");
}

export function ProjectOpenMenuItems({
  apps,
  isPending,
  onSelect,
  selectedAppId,
}: ProjectOpenMenuItemsProps) {
  const { t } = useTranslation("workbench");
  return (
    <DropdownMenuContent
      align="end"
      aria-label={t("openMenu.choose")}
      className="w-60 border border-separator-strong p-1.5"
      sideOffset={6}
    >
      <DropdownMenuRadioGroup
        onValueChange={(appId) => {
          onSelect(appId as ProjectOpenAppId);
        }}
        {...(selectedAppId === undefined ? {} : { value: selectedAppId })}
      >
        {apps.map((app) => {
          const Icon = appKindIcons[app.kind];
          const appName = app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
          return (
            <DropdownMenuRadioItem
              aria-label={appName}
              className="h-9"
              disabled={isPending}
              key={app.id}
              value={app.id}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{appName}</span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  );
}

export type ProjectOpenContextMenuTarget = Readonly<{
  path: string;
  type: ProjectOpenTargetType;
}>;

type ProjectOpenContextMenuItemsProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  ariaLabel?: string;
  detail: string;
  isPending: boolean;
  onSelect: (appId: ProjectOpenAppId) => void;
  title: string;
}>;

export function ProjectOpenContextMenuItems({
  apps,
  ariaLabel,
  detail,
  isPending,
  onSelect,
  title,
}: ProjectOpenContextMenuItemsProps) {
  const { t } = useTranslation("workbench");
  return (
    <ContextMenuContent aria-label={ariaLabel} className="w-60">
      <ContextMenuLabel className="py-0.5">
        <p>{title}</p>
        <p className="mt-0.5 truncate text-meta font-normal text-muted-foreground" title={detail}>
          {detail}
        </p>
      </ContextMenuLabel>
      <ContextMenuSeparator />
      {apps.map((app) => {
        const Icon = appKindIcons[app.kind];
        const appName = app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
        return (
          <ContextMenuItem
            aria-label={appName}
            className="h-9"
            disabled={isPending}
            key={app.id}
            onSelect={() => {
              onSelect(app.id);
            }}
          >
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{appName}</span>
          </ContextMenuItem>
        );
      })}
    </ContextMenuContent>
  );
}

type ProjectOpenContextMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  children: ReactElement;
  isPending: boolean;
  onOpen: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenContextMenu({
  apps,
  children,
  isPending,
  onOpen,
  onSelect,
  target,
}: ProjectOpenContextMenuProps) {
  const { t } = useTranslation("workbench");
  const targetApps = getProjectOpenAppsForTarget(apps, target.type);

  if (targetApps.length === 0) {
    return children;
  }

  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <ContextMenuTrigger
        asChild
        // 文件树节点递归嵌套，阻止右键事件继续触发父目录菜单。
        onContextMenu={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ProjectOpenContextMenuItems
        apps={targetApps}
        ariaLabel={t("openMenu.targetLabel", { path: target.path })}
        detail={target.path}
        isPending={isPending}
        onSelect={(appId) => {
          onSelect(appId, target.path);
        }}
        title={t("openMenu.title")}
      />
    </ContextMenu>
  );
}

type ProjectOpenMenuProps = Readonly<{
  client: CodeAgentProjectOpenClient;
  defaultOpenAppId?: ProjectOpenAppId | null;
  projectId: string;
}>;

export function ProjectOpenMenu({ client, defaultOpenAppId, projectId }: ProjectOpenMenuProps) {
  const { t } = useTranslation("workbench");
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Readonly<Record<string, ProjectOpenAppId>>>({});
  const [preferenceStorage] = useState(getProjectOpenPreferenceStorage);
  const openActionLockRef = useRef(createAsyncActionLock());
  const capabilitiesQuery = useQuery(projectOpenCapabilitiesQueryOptions(projectId, client));
  const apps = getProjectOpenAppsForTarget(capabilitiesQuery.data?.apps ?? emptyApps, "directory");
  const inheritedAppId = useMemo(
    () => resolveProjectOpenAppId(preferenceStorage, projectId, apps, defaultOpenAppId),
    [apps, defaultOpenAppId, preferenceStorage, projectId],
  );
  const requestedAppId = selectedApps[projectId] ?? inheritedAppId;
  const selectedApp = apps.find((app) => app.id === requestedAppId);
  const openMutation = useMutation({
    mutationFn: (appId: ProjectOpenAppId) => client.openProject(projectId, { appId }),
    onError() {
      setActionError(true);
    },
  });

  useEffect(() => {
    setActionError(false);
    setMenuOpen(false);
  }, [projectId]);

  const selectApp = (appId: ProjectOpenAppId) => {
    setSelectedApps((current) => ({ ...current, [projectId]: appId }));
    writeProjectOpenAppId(preferenceStorage, projectId, appId);
    setActionError(false);
    setMenuOpen(false);
  };
  const openButtonLabel = capabilitiesQuery.isPending
    ? t("openMenu.detect")
    : selectedApp === undefined
      ? t("openMenu.none")
      : t("openMenu.openIn", { app: selectedApp.name });
  const compactOpenButtonLabel = selectedApp?.name ?? openButtonLabel;

  return (
    <div className="relative inline-flex shrink-0">
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          setActionError(false);
          setMenuOpen(open);
        }}
        open={menuOpen}
      >
        <ButtonGroup className="h-7 overflow-hidden rounded-control border border-separator-strong bg-control shadow-control max-workbench:h-11">
          <Button
            variant="ghost"
            aria-label={openButtonLabel}
            className="min-w-0 max-w-36 truncate rounded-none px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-muted-foreground sm:max-w-48"
            disabled={selectedApp === undefined || openMutation.isPending}
            onClick={() => {
              if (selectedApp !== undefined) {
                setActionError(false);
                void openActionLockRef.current.run(() => openMutation.mutateAsync(selectedApp.id));
              }
            }}
            title={openButtonLabel}
            type="button"
          >
            <span className="hidden sm:inline">{openButtonLabel}</span>
            <span className="sm:hidden">{compactOpenButtonLabel}</span>
          </Button>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={t("openMenu.choose")}
              className="inline-grid size-7 shrink-0 place-items-center rounded-none border-l border-separator text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-45 max-workbench:size-11"
              disabled={apps.length === 0 || openMutation.isPending}
              type="button"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
        </ButtonGroup>
        <ProjectOpenMenuItems
          apps={apps}
          isPending={openMutation.isPending}
          onSelect={selectApp}
          {...(selectedApp === undefined ? {} : { selectedAppId: selectedApp.id })}
        />
      </DropdownMenu>
      {actionError ? (
        <p
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-control bg-danger-soft px-2 py-1.5 text-meta text-danger shadow-floating"
          role="alert"
        >
          {t("openMenu.error")}
        </p>
      ) : null}
    </div>
  );
}
