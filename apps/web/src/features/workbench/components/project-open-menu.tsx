import type { ProjectOpenApp, ProjectOpenAppId, ProjectOpenAppKind } from "@code-agent/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Code2, FolderOpen, Terminal, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CodeAgentProjectOpenClient } from "../../projects/project-queries.js";
import {
  getProjectOpenPreferenceStorage,
  readProjectOpenAppId,
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
  isPending: boolean;
  onSelect: (appId: ProjectOpenAppId) => void;
  selectedAppId: ProjectOpenAppId | undefined;
}>;

export function ProjectOpenMenuItems({
  apps,
  isPending,
  onSelect,
  selectedAppId,
}: ProjectOpenMenuItemsProps) {
  return (
    <div
      aria-label="项目打开方式"
      className="w-60 rounded-surface border border-separator-strong bg-raised p-1.5 shadow-floating"
      role="menu"
    >
      {apps.map((app) => {
        const Icon = appKindIcons[app.kind];
        const selected = app.id === selectedAppId;
        return (
          <button
            aria-checked={selected}
            aria-label={app.name}
            className="flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover focus-visible:bg-control-hover focus-visible:shadow-focus disabled:opacity-50"
            disabled={isPending}
            key={app.id}
            onClick={() => {
              onSelect(app.id);
            }}
            role="menuitemradio"
            type="button"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{app.name}</span>
            {selected ? (
              <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type ProjectOpenMenuProps = Readonly<{
  client: CodeAgentProjectOpenClient;
  projectId: string;
}>;

export function ProjectOpenMenu({ client, projectId }: ProjectOpenMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Readonly<Record<string, ProjectOpenAppId>>>({});
  const [preferenceStorage] = useState(getProjectOpenPreferenceStorage);
  const capabilitiesQuery = useQuery({
    queryFn: ({ signal }) => client.getProjectOpenCapabilities(projectId, { signal }),
    queryKey: ["projects", projectId, "open-capabilities"],
    staleTime: 60_000,
  });
  const apps = capabilitiesQuery.data?.apps ?? emptyApps;
  const storedAppId = useMemo(
    () => readProjectOpenAppId(preferenceStorage, projectId, apps),
    [apps, preferenceStorage, projectId],
  );
  const requestedAppId = selectedApps[projectId] ?? storedAppId;
  const selectedApp = apps.find((app) => app.id === requestedAppId) ?? apps[0];
  const openMutation = useMutation({
    mutationFn: (appId: ProjectOpenAppId) => client.openProject(projectId, appId),
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
            selectedAppId={selectedApp?.id}
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
