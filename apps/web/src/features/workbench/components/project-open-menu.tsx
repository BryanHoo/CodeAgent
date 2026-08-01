import type { ProjectOpenApp, ProjectOpenAppId, ProjectOpenAppKind } from "@code-agent/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Code2, FolderOpen, Terminal, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  terminal: Terminal,
  tool: Wrench,
} as const satisfies Record<ProjectOpenAppKind, typeof Code2>;

type ProjectOpenMenuItemsProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  ariaLabel?: string;
  detail?: string;
  isPending: boolean;
  mode?: "command" | "selection";
  onSelect: (appId: ProjectOpenAppId) => void;
  selectedAppId?: ProjectOpenAppId;
  title?: string;
}>;

export function ProjectOpenMenuItems({
  apps,
  ariaLabel = "项目打开方式",
  detail,
  isPending,
  mode = "selection",
  onSelect,
  selectedAppId,
  title,
}: ProjectOpenMenuItemsProps) {
  return (
    <div
      aria-label={ariaLabel}
      className="w-60 rounded-surface border border-separator-strong bg-raised p-1.5 shadow-floating"
      role="menu"
    >
      {title === undefined ? null : (
        <div className="mb-1 border-b border-separator px-2 pb-1.5 pt-0.5" role="presentation">
          <p className="text-label font-medium text-foreground">{title}</p>
          {detail === undefined ? null : (
            <p className="mt-0.5 truncate text-meta text-muted-foreground" title={detail}>
              {detail}
            </p>
          )}
        </div>
      )}
      {apps.map((app) => {
        const Icon = appKindIcons[app.kind];
        const selected = app.id === selectedAppId;
        return (
          <button
            aria-label={app.name}
            className="flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover focus-visible:bg-control-hover focus-visible:shadow-focus disabled:opacity-50"
            disabled={isPending}
            key={app.id}
            onClick={() => {
              onSelect(app.id);
            }}
            role={mode === "selection" ? "menuitemradio" : "menuitem"}
            type="button"
            {...(mode === "selection" ? { "aria-checked": selected } : {})}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{app.name}</span>
            {mode === "selection" && selected ? (
              <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

const contextMenuViewportPadding = 8;
const contextMenuWidth = 240;
const contextMenuItemHeight = 36;
const contextMenuVerticalChrome = 12;
// 标题区使用固定估算高度，确保菜单靠近视口底部时不会被裁切。
const contextMenuHeaderHeight = 46;

type ProjectOpenContextMenuPositionInput = Readonly<{
  appCount: number;
  pointerX: number;
  pointerY: number;
  viewportHeight: number;
  viewportWidth: number;
}>;

export function getProjectOpenContextMenuPosition({
  appCount,
  pointerX,
  pointerY,
  viewportHeight,
  viewportWidth,
}: ProjectOpenContextMenuPositionInput) {
  const estimatedHeight =
    appCount * contextMenuItemHeight + contextMenuVerticalChrome + contextMenuHeaderHeight;
  return {
    left: Math.max(
      contextMenuViewportPadding,
      Math.min(pointerX, viewportWidth - contextMenuWidth - contextMenuViewportPadding),
    ),
    top: Math.max(
      contextMenuViewportPadding,
      Math.min(pointerY, viewportHeight - estimatedHeight - contextMenuViewportPadding),
    ),
  };
}

export type ProjectOpenContextMenuTarget = Readonly<{
  path: string;
  pointerX: number;
  pointerY: number;
}>;

type ProjectOpenContextMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  isPending: boolean;
  onClose: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenContextMenu({
  apps,
  isPending,
  onClose,
  onSelect,
  target,
}: ProjectOpenContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const position = getProjectOpenContextMenuPosition({
    appCount: apps.length,
    pointerX: target.pointerX,
    pointerY: target.pointerY,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  });

  return createPortal(
    <div
      className="fixed z-50"
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      ref={containerRef}
      style={position}
    >
      <ProjectOpenMenuItems
        apps={apps}
        ariaLabel={`打开 ${target.path} 的方式`}
        detail={target.path}
        isPending={isPending}
        mode="command"
        onSelect={(appId) => {
          onClose();
          onSelect(appId, target.path);
        }}
        title="打开方式"
      />
    </div>,
    document.body,
  );
}

type ProjectOpenMenuProps = Readonly<{
  client: CodeAgentProjectOpenClient;
  defaultOpenAppId?: ProjectOpenAppId | null;
  projectId: string;
}>;

export function ProjectOpenMenu({ client, defaultOpenAppId, projectId }: ProjectOpenMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Readonly<Record<string, ProjectOpenAppId>>>({});
  const [preferenceStorage] = useState(getProjectOpenPreferenceStorage);
  const capabilitiesQuery = useQuery(projectOpenCapabilitiesQueryOptions(projectId, client));
  const apps = capabilitiesQuery.data?.apps ?? emptyApps;
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

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [menuOpen]);

  const selectApp = (appId: ProjectOpenAppId) => {
    setSelectedApps((current) => ({ ...current, [projectId]: appId }));
    writeProjectOpenAppId(preferenceStorage, projectId, appId);
    setActionError(false);
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
  };
  const openButtonLabel = capabilitiesQuery.isPending
    ? "正在检测打开方式"
    : selectedApp === undefined
      ? "没有可用的打开方式"
      : `在 ${selectedApp.name} 中打开`;

  return (
    <div
      className="relative inline-flex shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setMenuOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
          menuTriggerRef.current?.focus();
        }
      }}
      ref={containerRef}
    >
      <div className="flex h-7 overflow-hidden rounded-control border border-separator-strong bg-control shadow-control">
        <button
          aria-label={openButtonLabel}
          className="min-w-0 max-w-36 truncate px-2.5 text-label font-medium text-foreground transition-colors hover:bg-control-hover focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-muted-foreground sm:max-w-48"
          disabled={selectedApp === undefined || openMutation.isPending}
          onClick={() => {
            if (selectedApp !== undefined) {
              setActionError(false);
              openMutation.mutate(selectedApp.id);
            }
          }}
          title={openButtonLabel}
          type="button"
        >
          {openButtonLabel}
        </button>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="选择打开方式"
          className="inline-grid size-7 shrink-0 place-items-center border-l border-separator text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-45"
          disabled={apps.length === 0 || openMutation.isPending}
          onClick={() => {
            setActionError(false);
            setMenuOpen((open) => !open);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setMenuOpen(true);
              requestAnimationFrame(() => {
                containerRef.current
                  ?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
                  ?.focus();
              });
            }
          }}
          ref={menuTriggerRef}
          type="button"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {menuOpen ? (
        <div className="absolute right-0 top-full z-50 pt-1.5">
          <ProjectOpenMenuItems
            apps={apps}
            isPending={openMutation.isPending}
            onSelect={selectApp}
            {...(selectedApp === undefined ? {} : { selectedAppId: selectedApp.id })}
          />
        </div>
      ) : null}
      {actionError ? (
        <p
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-control bg-danger-soft px-2 py-1.5 text-meta text-danger shadow-floating"
          role="alert"
        >
          无法打开项目，请确认应用仍可用
        </p>
      ) : null}
    </div>
  );
}
