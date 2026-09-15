import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { projectGitStatusQueryOptions } from "../../projects/project-queries.js";
import { deriveInspectorGitChangeState } from "../components/workbench-inspector-git-status.js";
import { useProjectGitDetails } from "./use-project-git-details.js";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useProjectGitDetailsRefresh } from "./use-project-git-status-route-refresh.js";

it("详情快照超前时补读轻量状态，等待在途读取且同一不一致只校准一次", async () => {
  const refetch = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [fetching, setFetching] = useState(true);
    const [scope, setScope] = useState("project-a");
    useProjectGitDetailsRefresh(scope, true, "old", "new", fetching, refetch);
    return <>
      <button onClick={() => setFetching(false)}>结束读取</button>
      <button onClick={() => setFetching(true)}>开始读取</button>
      <button onClick={() => setScope("project-b")}>切换项目</button>
    </>;
  }
  const screen = await render(<Harness />);
  expect(refetch).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "结束读取" }).click();
  await expect.poll(() => refetch.mock.calls.length).toBe(1);
  await screen.getByRole("button", { name: "开始读取" }).click();
  await screen.getByRole("button", { name: "结束读取" }).click();
  expect(refetch).toHaveBeenCalledTimes(1);
  await screen.getByRole("button", { name: "切换项目" }).click();
  await expect.poll(() => refetch.mock.calls.length).toBe(2);
});

it("共享查询在文件再次修改后校准快照，并在切换项目后显示新项目统计", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let firstRead = true;
  const getProjectGitStatus = vi.fn(async (projectId: string, request: { includeDiff?: boolean }) => {
    const snapshot = projectId === "project-a" ? "latest-a" : "latest-b";
    const current: ProjectGitStatus = {
      baseBranches: [], branch: "main", branches: [], repositoryMode: "root", snapshot,
      staged: [], unstaged: [{
        path: "main.ts", kind: "update", diff: request.includeDiff ? "+new" : "",
        stats: { additions: request.includeDiff ? (projectId === "project-a" ? 7 : 9) : 0, removals: 0 },
      }],
    };
    if (firstRead && !request.includeDiff) {
      firstRead = false;
      return { ...current, snapshot: "before-edit" };
    }
    return current;
  });
  const client = { getProjectGitStatus };
  function Content() {
    const [projectId, setProjectId] = useState("project-a");
    const statusQuery = useQuery(projectGitStatusQueryOptions(projectId, "/root", client));
    const detailsQuery = useProjectGitDetails({
      activePanel: true, client, projectId, rootPath: "/root", scope: projectId, statusQuery, temporary: false,
    });
    const { changeStats } = deriveInspectorGitChangeState(statusQuery.data, detailsQuery.data);
    return <>
      <output>{changeStats === undefined ? "加载中" : `新增 ${changeStats.additions}`}</output>
      <button onClick={() => setProjectId("project-b")}>切换</button>
    </>;
  }
  const screen = await render(<QueryClientProvider client={queryClient}><Content /></QueryClientProvider>);
  await expect.element(screen.getByText("新增 7", { exact: true })).toBeVisible();
  expect(getProjectGitStatus.mock.calls.filter(([id, request]) => id === "project-a" && !request.includeDiff)).toHaveLength(2);
  await screen.getByRole("button", { name: "切换", exact: true }).click();
  await expect.element(screen.getByText("新增 9", { exact: true })).toBeVisible();
  queryClient.clear();
});
