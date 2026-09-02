import type { AgentTask, AgentTaskPage } from "@/protocol/index.js";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { cacheCreatedProjectTask } from "./project-query-cache.js";

const existingTask: AgentTask = {
  id: "task-existing",
  pinned: false,
  projectId: "project-a",
  title: "已有任务",
  updatedAt: "2026-09-02T00:00:00Z",
};

const createdTask: AgentTask = {
  id: "task-created",
  pinned: false,
  projectId: "project-a",
  title: "新建任务",
  updatedAt: "2026-09-02T00:01:00Z",
};

describe("cacheCreatedProjectTask", () => {
  it("keeps the created task when an older task-list request finishes later", async () => {
    const queryClient = new QueryClient();
    let resolveStalePage: (page: AgentTaskPage) => void = () => undefined;
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const stalePage = new Promise<AgentTaskPage>((resolve) => {
      resolveStalePage = resolve;
    });
    const queryKey = ["projects", createdTask.projectId, "tasks"] as const;
    const staleFetch = queryClient.fetchInfiniteQuery({
      getNextPageParam: () => undefined,
      initialPageParam: undefined,
      queryFn: () => {
        markRequestStarted();
        return stalePage;
      },
      queryKey,
    });

    await requestStarted;
    await cacheCreatedProjectTask(queryClient, createdTask);
    resolveStalePage({ data: [existingTask], nextCursor: null });
    await Promise.allSettled([staleFetch]);

    expect(queryClient.getQueryData(queryKey)).toEqual({
      pageParams: [undefined],
      pages: [{ data: [createdTask], nextCursor: null }],
    });
  });
});
