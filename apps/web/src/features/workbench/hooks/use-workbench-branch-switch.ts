import type { ProjectGitStatus } from "@code-agent/protocol";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { WorkbenchComposerProps } from "../components/workbench-composer-contracts.js";

const gitStatusQueryKey = (projectId: string) => ["projects", projectId, "git-status"] as const;

export async function switchComposerBranch(
  client: Pick<WorkbenchComposerProps["client"], "switchProjectBranch">,
  queryClient: QueryClient,
  projectId: string,
  gitStatus: ProjectGitStatus,
  branch: string,
): Promise<boolean> {
  if (
    gitStatus.repositoryMode !== "root" ||
    gitStatus.branch === branch ||
    !gitStatus.branches.includes(branch)
  ) {
    return false;
  }
  const queryKey = gitStatusQueryKey(projectId);
  // 先取消旧状态轮询，避免切换成功后被较早发出的响应覆盖回旧分支。
  await queryClient.cancelQueries({ exact: true, queryKey });
  const nextStatus = await client.switchProjectBranch(projectId, {
    branch,
    expectedSnapshot: gitStatus.snapshot,
  });
  queryClient.setQueryData(queryKey, nextStatus);
  return true;
}

export async function createComposerBranch(
  client: Pick<WorkbenchComposerProps["client"], "createProjectBranch">,
  queryClient: QueryClient,
  projectId: string,
  gitStatus: ProjectGitStatus,
  branch: string,
): Promise<boolean> {
  const normalizedBranch = branch.trim();
  if (
    gitStatus.repositoryMode !== "root" ||
    normalizedBranch.length === 0 ||
    gitStatus.branches.includes(normalizedBranch)
  ) {
    return false;
  }
  const queryKey = gitStatusQueryKey(projectId);
  await queryClient.cancelQueries({ exact: true, queryKey });
  const nextStatus = await client.createProjectBranch(projectId, {
    branch: normalizedBranch,
    expectedSnapshot: gitStatus.snapshot,
  });
  queryClient.setQueryData(queryKey, nextStatus);
  return true;
}

type WorkbenchBranchSwitchOptions = Readonly<{
  client: WorkbenchComposerProps["client"];
  failureMessage: string;
  gitStatus: ProjectGitStatus | undefined;
  isCurrentScope: (scope: string) => boolean;
  projectId: string;
  routeScope: string;
}>;

export function useWorkbenchBranchSwitch({
  client,
  failureMessage,
  gitStatus,
  isCurrentScope,
  projectId,
  routeScope,
}: WorkbenchBranchSwitchOptions) {
  const queryClient = useQueryClient();
  const branchSwitchLockRef = useRef(createAsyncActionLock());
  const [branchSwitchError, setBranchSwitchError] = useState<string>();
  const [branchCreateError, setBranchCreateError] = useState<string>();
  const [creatingBranch, setCreatingBranch] = useState<string>();
  const [switchingBranch, setSwitchingBranch] = useState<string>();

  useEffect(() => {
    // 路由切换后清理旧作用域的瞬时状态，旧请求只允许更新其 Project Query。
    setBranchSwitchError(undefined);
    setBranchCreateError(undefined);
    setCreatingBranch(undefined);
    setSwitchingBranch(undefined);
  }, [routeScope]);

  const switchBranch = async (branch: string) => {
    const requestScope = routeScope;
    if (gitStatus === undefined || switchingBranch !== undefined) {
      return;
    }
    await branchSwitchLockRef.current.run(async () => {
      setBranchSwitchError(undefined);
      setBranchCreateError(undefined);
      setSwitchingBranch(branch);
      try {
        await switchComposerBranch(client, queryClient, projectId, gitStatus, branch);
      } catch {
        if (isCurrentScope(requestScope)) {
          setBranchSwitchError(failureMessage);
        }
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitStatusQueryKey(projectId) })
          .catch(() => undefined);
      } finally {
        if (isCurrentScope(requestScope)) {
          setSwitchingBranch(undefined);
        }
      }
    });
  };

  const createBranch = async (branch: string): Promise<boolean> => {
    const requestScope = routeScope;
    if (gitStatus === undefined || creatingBranch !== undefined || switchingBranch !== undefined) {
      return false;
    }
    const created = await branchSwitchLockRef.current.run(async () => {
      setBranchCreateError(undefined);
      setCreatingBranch(branch);
      try {
        return await createComposerBranch(client, queryClient, projectId, gitStatus, branch);
      } catch {
        if (isCurrentScope(requestScope)) {
          setBranchCreateError(failureMessage);
        }
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitStatusQueryKey(projectId) })
          .catch(() => undefined);
        return false;
      } finally {
        if (isCurrentScope(requestScope)) {
          setCreatingBranch(undefined);
        }
      }
    });
    return created ?? false;
  };

  return {
    branchCreateError,
    branchSwitchError,
    createBranch,
    creatingBranch,
    switchBranch,
    switchingBranch,
  } as const;
}
