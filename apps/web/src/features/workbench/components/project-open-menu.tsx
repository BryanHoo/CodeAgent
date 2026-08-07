import type { ProjectOpenApp, ProjectOpenAppId, ProjectOpenAppKind } from "@code-agent/protocol";
import { Code2, Ellipsis, ExternalLink, FolderOpen, Terminal, Wrench } from "lucide-react";
import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../shared/components/core/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

const appKindIcons = {
  editor: Code2,
  "file-manager": FolderOpen,
  "system-default": ExternalLink,
  terminal: Terminal,
  tool: Wrench,
} as const satisfies Record<ProjectOpenAppKind, typeof Code2>;

type ProjectOpenTargetType = "directory" | "file";

export function getProjectOpenAppsForTarget(
  apps: readonly ProjectOpenApp[],
  targetType: ProjectOpenTargetType,
): readonly ProjectOpenApp[] {
  return targetType === "file" ? apps : apps.filter((app) => app.kind !== "system-default");
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

type ProjectOpenDropdownMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  isPending: boolean;
  onOpen: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenDropdownMenu({
  apps,
  isPending,
  onOpen,
  onSelect,
  target,
}: ProjectOpenDropdownMenuProps) {
  const { t } = useTranslation("workbench");
  // 行尾入口复用右键菜单的目标过滤，目录不会暴露仅文件可用的系统默认应用。
  const targetApps = getProjectOpenAppsForTarget(apps, target.type);
  const targetLabel = t("openMenu.targetLabel", { path: target.path });

  if (targetApps.length === 0) {
    return null;
  }

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              aria-label={targetLabel}
              className="pointer-events-none size-5 shrink-0 opacity-0 transition-opacity group-hover/file-tree-node:pointer-events-auto group-hover/file-tree-node:opacity-100 group-focus-within/file-tree-node:pointer-events-auto group-focus-within/file-tree-node:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
              size="embedded"
              type="button"
              variant="embedded"
            >
              <Ellipsis aria-hidden="true" className="size-3.5" />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="left">{t("openMenu.title")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" aria-label={targetLabel} className="w-60">
        <DropdownMenuLabel className="py-0.5">
          <p>{t("openMenu.title")}</p>
          <p
            className="mt-0.5 truncate text-meta font-normal text-muted-foreground"
            title={target.path}
          >
            {target.path}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {targetApps.map((app) => {
            const Icon = appKindIcons[app.kind];
            const appName = app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
            return (
              <DropdownMenuItem
                aria-label={appName}
                className="h-9"
                disabled={isPending}
                key={app.id}
                onSelect={() => {
                  onSelect(app.id, target.path);
                }}
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{appName}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
