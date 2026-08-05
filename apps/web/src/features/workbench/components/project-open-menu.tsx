import type { ProjectOpenApp, ProjectOpenAppId, ProjectOpenAppKind } from "@code-agent/protocol";
import { Code2, ExternalLink, FolderOpen, Terminal, Wrench } from "lucide-react";
import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../shared/ui/context-menu.js";
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
