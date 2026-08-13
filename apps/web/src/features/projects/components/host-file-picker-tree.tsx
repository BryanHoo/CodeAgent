import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, File, Folder, FolderOpen, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

export type HostFilePickerMode = "directory" | "file" | "image";

export type HostFilePickerEntry = Readonly<{
  name: string;
  path: string;
  type: "directory" | "file";
}>;

export type HostFilePickerListing = Readonly<{
  entries: readonly HostFilePickerEntry[];
  parentPath: string | null;
  path: string;
  roots: readonly Readonly<{ name: string; path: string }>[];
}>;

export type HostFilePickerDirectoryState = Readonly<{
  data?: HostFilePickerListing;
  error: Error | null;
  isFetching: boolean;
  path: string;
}>;

export type HostFilePickerRow = HostFilePickerEntry &
  Readonly<{
    depth: number;
    state?: HostFilePickerDirectoryState;
  }>;

function appendRows(
  rows: HostFilePickerRow[],
  entries: readonly HostFilePickerEntry[],
  depth: number,
  directoryStates: ReadonlyMap<string, HostFilePickerDirectoryState>,
  expandedPaths: ReadonlySet<string>,
) {
  for (const entry of entries) {
    const state = entry.type === "directory" ? directoryStates.get(entry.path) : undefined;
    rows.push({ ...entry, depth, ...(state === undefined ? {} : { state }) });
    if (entry.type === "directory" && expandedPaths.has(entry.path) && state?.data !== undefined) {
      appendRows(rows, state.data.entries, depth + 1, directoryStates, expandedPaths);
    }
  }
}

export function flattenHostFilePickerRows(
  listing: HostFilePickerListing,
  directoryStates: ReadonlyMap<string, HostFilePickerDirectoryState>,
  expandedPaths: ReadonlySet<string>,
): readonly HostFilePickerRow[] {
  const rows: HostFilePickerRow[] = [];
  appendRows(rows, listing.entries, 0, directoryStates, expandedPaths);
  return rows;
}

type HostFilePickerTreeProps = Readonly<{
  directoryStates: readonly HostFilePickerDirectoryState[];
  expandedPaths: ReadonlySet<string>;
  listing: HostFilePickerListing;
  mode: HostFilePickerMode;
  onRetry: (path: string) => void;
  onSelect: (entry: HostFilePickerEntry) => void;
  onToggle: (path: string) => void;
  selectedPath?: string;
}>;

const INITIAL_RECT = { height: 420, width: 640 };
const ROW_HEIGHT_PX = 30;

export function HostFilePickerTree({
  directoryStates,
  expandedPaths,
  listing,
  mode,
  onRetry,
  onSelect,
  onToggle,
  selectedPath,
}: HostFilePickerTreeProps) {
  const { t } = useTranslation("workbench");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stateMap = useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates],
  );
  const rows = useMemo(
    () => flattenHostFilePickerRows(listing, stateMap, expandedPaths),
    [expandedPaths, listing, stateMap],
  );
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT_PX,
    getItemKey: (index) => rows[index]?.path ?? index,
    getScrollElement,
    initialRect: INITIAL_RECT,
    overscan: 8,
  });

  return (
    <div
      aria-label={t(mode === "directory" ? "projectPicker.treeLabel" : "hostFilePicker.treeLabel")}
      className="h-full min-h-0 overflow-y-auto font-mono text-label text-foreground"
      ref={scrollRef}
      role="tree"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (row === undefined) return null;
          const expanded = row.type === "directory" && expandedPaths.has(row.path);
          const selectable = mode === "directory" ? row.type === "directory" : row.type === "file";
          const selected = selectable && selectedPath === row.path;
          return (
            <div
              aria-expanded={row.type === "directory" ? expanded : undefined}
              aria-selected={selected}
              className="absolute left-0 top-0 w-full"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              role="treeitem"
              style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
            >
              <div
                className={`group flex min-h-[30px] items-center gap-1 rounded-control pr-2 transition-colors hover:bg-control-hover ${selected ? "bg-control" : ""}`}
                style={{ paddingLeft: `${String(6 + row.depth * 14)}px` }}
              >
                {row.type === "directory" ? (
                  <Button
                    aria-label={t(expanded ? "hostFilePicker.collapse" : "hostFilePicker.expand", {
                      name: row.name,
                    })}
                    onClick={() => {
                      onToggle(row.path);
                    }}
                    size="embedded"
                    type="button"
                    variant="embedded"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                  </Button>
                ) : (
                  <span aria-hidden="true" className="size-4 shrink-0" />
                )}
                <Button
                  className="min-w-0 flex-1 gap-1.5"
                  contentAlign="start"
                  disabled={!selectable}
                  onClick={() => {
                    onSelect(row);
                  }}
                  size="embedded"
                  type="button"
                  variant="embedded"
                >
                  {row.type === "file" ? (
                    <File aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  ) : expanded ? (
                    <FolderOpen aria-hidden="true" className="size-3.5 text-brand" />
                  ) : (
                    <Folder aria-hidden="true" className="size-3.5 text-brand" />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={row.path}>
                    {row.name}
                  </span>
                </Button>
                {expanded && row.state?.isFetching === true ? (
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                ) : expanded && row.state?.error !== null && row.state?.error !== undefined ? (
                  <Button
                    aria-label={t("actions.retry")}
                    onClick={() => {
                      onRetry(row.path);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
