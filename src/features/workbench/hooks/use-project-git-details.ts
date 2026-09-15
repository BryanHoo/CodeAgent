import type { ProjectGitStatus } from "@/protocol/index.js";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  projectGitDetailedStatusQueryOptions,
  type NativeGitStatusClient,
} from "../../projects/project-queries.js";
import { shouldEnableProjectGitDetails } from "../workbench-inspector-activation.js";
import { useProjectGitDetailsRefresh } from "./use-project-git-status-route-refresh.js";

export function useProjectGitDetails({
  activePanel,
  client,
  projectId,
  rootPath,
  scope,
  statusQuery,
  temporary,
}: Readonly<{
  activePanel: boolean;
  client: NativeGitStatusClient;
  projectId: string;
  rootPath: string;
  scope: string;
  statusQuery: UseQueryResult<ProjectGitStatus, Error>;
  temporary: boolean;
}>) {
  const enabled = shouldEnableProjectGitDetails({
    activePanel, gitStatus: statusQuery.data, temporary,
  });
  const detailsQuery = useQuery(projectGitDetailedStatusQueryOptions(
    projectId, rootPath, null, statusQuery.data?.snapshot ?? "", enabled, client,
  ));
  useProjectGitDetailsRefresh(
    scope,
    enabled,
    statusQuery.data?.snapshot,
    detailsQuery.data?.snapshot,
    statusQuery.isFetching || detailsQuery.isFetching,
    statusQuery.refetch,
  );
  return detailsQuery;
}
