import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { CodeAgentProjectFileSearchClient } from "../../projects/project-queries.js";

export const PROJECT_FILE_SEARCH_DEBOUNCE_MS = 150;

export function projectFileSearchQueryOptions(
  client: CodeAgentProjectFileSearchClient,
  projectId: string,
  rootPath: string,
  query: string,
  enabled: boolean,
) {
  return queryOptions({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => client.searchProjectFiles(projectId, rootPath, query, { signal }),
    queryKey: ["projects", projectId, rootPath, "file-search", query] as const,
    staleTime: 30_000,
  });
}

export function useProjectFileSearch(
  client: CodeAgentProjectFileSearchClient,
  projectId: string,
  rootPath: string,
  query: string,
  enabled: boolean,
) {
  const [debouncedState, setDebouncedState] = useState({ enabled: false, query });
  useEffect(() => {
    if (!enabled) {
      setDebouncedState((current) =>
        !current.enabled && current.query === query ? current : { enabled: false, query },
      );
      return undefined;
    }
    // 只提交用户停顿后的最终查询，避免候选列表在连续输入时反复切换加载状态。
    const timeout = setTimeout(() => {
      setDebouncedState({ enabled: true, query });
    }, PROJECT_FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [enabled, query]);

  const debounceSettled = debouncedState.enabled && debouncedState.query === query;
  return useQuery(
    projectFileSearchQueryOptions(
      client,
      projectId,
      rootPath,
      debouncedState.query,
      enabled && debounceSettled,
    ),
  );
}
