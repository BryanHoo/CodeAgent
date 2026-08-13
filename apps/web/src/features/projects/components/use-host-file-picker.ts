import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  HostFilePickerDirectoryState,
  HostFilePickerEntry,
  HostFilePickerListing,
  HostFilePickerMode,
} from "./host-file-picker-tree.js";

export type HostFilePickerLoader = (
  path: string | undefined,
  showHidden: boolean,
  signal: AbortSignal,
) => Promise<HostFilePickerListing>;

export function useHostFilePicker(mode: HostFilePickerMode, loadDirectory: HostFilePickerLoader) {
  const [rootPath, setRootPath] = useState<string>();
  const [pathInput, setPathInput] = useState<string>();
  const [showHidden, setShowHidden] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string>();
  const rootQuery = useQuery({
    queryFn: ({ signal }) => loadDirectory(rootPath, showHidden, signal),
    queryKey: ["host-file-picker", mode, showHidden, rootPath ?? null] as const,
    staleTime: 30_000,
  });
  const listing = rootQuery.data;

  useEffect(() => {
    if (listing !== undefined) setPathInput(listing.path);
  }, [listing]);

  const expandedDirectoryPaths = useMemo(() => [...expandedPaths], [expandedPaths]);
  const directoryQueries = useQueries({
    queries: expandedDirectoryPaths.map((path) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) => loadDirectory(path, showHidden, signal),
      queryKey: ["host-file-picker", mode, showHidden, path] as const,
      staleTime: 30_000,
    })),
  });
  const directoryStates = expandedDirectoryPaths.map<HostFilePickerDirectoryState>(
    (path, index) => {
      const query = directoryQueries[index];
      return {
        ...(query?.data === undefined ? {} : { data: query.data }),
        error: query?.error ?? null,
        isFetching: query?.isFetching ?? false,
        path,
      };
    },
  );

  const navigate = useCallback((path: string) => {
    const nextPath = path.trim();
    if (nextPath.length === 0) return;
    setRootPath(nextPath);
    setExpandedPaths(new Set());
    setSelectedPath(undefined);
  }, []);
  const select = useCallback(
    (entry: HostFilePickerEntry) => {
      const selectable = mode === "directory" ? entry.type === "directory" : entry.type === "file";
      if (selectable) setSelectedPath(entry.path);
    },
    [mode],
  );
  const toggle = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const toggleHidden = useCallback(() => {
    setShowHidden((current) => !current);
    // 显隐模式变化后旧选择可能不再可见，确认动作必须重新选择当前结果。
    setSelectedPath(undefined);
  }, []);

  return {
    directoryQueries,
    directoryStates,
    expandedDirectoryPaths,
    expandedPaths,
    listing,
    navigate,
    pathInput,
    rootQuery,
    select,
    selectedPath: selectedPath ?? (mode === "directory" ? listing?.path : undefined),
    setPathInput,
    showHidden,
    toggle,
    toggleHidden,
  };
}
