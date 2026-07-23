import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TaskSnapshotTimeline } from "../workbench/components/task-timeline.js";
import {
  capabilitiesQueryOptions,
  projectTasksQueryOptions,
  projectsQueryOptions,
  taskSnapshotQueryOptions,
} from "./project-queries.js";

const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: "/workspace/CodeAgent",
} as const;

const task = {
  id: "task-1",
  pinned: false,
  projectId: "code-agent",
  title: "结构化历史",
  updatedAt: "2026-07-23T00:01:00.000Z",
} as const;

const snapshot = {
  ...task,
  status: "idle" as const,
  turns: [
    {
      completedAt: "2026-07-23T00:01:00.000Z",
      error: "模型服务不可用",
      id: "turn-1",
      items: [
        { id: "i1", role: "user" as const, text: "读取真实历史", type: "message" as const },
        {
          content: "按统一边界实现",
          id: "i2",
          summary: "分析协议",
          type: "reasoning" as const,
        },
        {
          command: "pnpm check",
          cwd: "/workspace/CodeAgent",
          id: "i3",
          output: "Done",
          outputTruncated: true,
          status: "completed" as const,
          type: "command" as const,
        },
        {
          changes: [{ diff: "+export {};", kind: "update" as const, path: "src/index.ts" }],
          id: "i4",
          status: "completed" as const,
          type: "file_change" as const,
        },
        {
          id: "i5",
          input: { path: "src/index.ts" },
          name: "filesystem/read_file",
          status: "completed" as const,
          type: "tool" as const,
        },
        { id: "i6", text: "1. 定义协议", type: "plan" as const },
        { detail: "完成压缩", id: "i7", label: "上下文压缩", type: "activity" as const },
      ],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "failed" as const,
    },
  ],
};

const snapshotResponse = {
  checkpoint: { sequence: 0, sessionId: "runtime-1" },
  snapshot,
};

describe("project queries", () => {
  it("loads projects, project tasks, and task snapshots through the client", async () => {
    const client = {
      getCapabilities: vi.fn(() =>
        Promise.resolve({
          provider: "codex",
          tasks: { list: true, read: true, start: true },
          turns: { interrupt: true, start: true },
        }),
      ),
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listTasks: vi.fn(() => Promise.resolve({ data: [task], nextCursor: null })),
      readTask: vi.fn(() => Promise.resolve(snapshotResponse)),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(queryClient.fetchQuery(projectsQueryOptions(client))).resolves.toEqual({
      data: [project],
      nextCursor: null,
    });
    await expect(queryClient.fetchQuery(capabilitiesQueryOptions(client))).resolves.toMatchObject({
      tasks: { start: true },
      turns: { interrupt: true, start: true },
    });
    await expect(
      queryClient.fetchQuery(projectTasksQueryOptions("code-agent", client)),
    ).resolves.toEqual({ data: [task], nextCursor: null });
    await expect(
      queryClient.fetchQuery(taskSnapshotQueryOptions("task-1", client)),
    ).resolves.toEqual(snapshotResponse);
  });

  it("loads and merges every task page returned by the client", async () => {
    const nextTask = { ...task, id: "task-2", title: "后续分页任务" };
    const client = {
      listProjects: vi.fn(() => Promise.resolve({ data: [project], nextCursor: null })),
      listTasks: vi
        .fn()
        .mockResolvedValueOnce({ data: [task], nextCursor: "next-page" })
        .mockResolvedValueOnce({ data: [nextTask], nextCursor: null }),
      readTask: vi.fn(() => Promise.resolve(snapshotResponse)),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(
      queryClient.fetchQuery(projectTasksQueryOptions("code-agent", client)),
    ).resolves.toEqual({ data: [task, nextTask], nextCursor: null });
    expect(client.listTasks).toHaveBeenNthCalledWith(1, "code-agent");
    expect(client.listTasks).toHaveBeenNthCalledWith(2, "code-agent", { cursor: "next-page" });
  });

  it("renders every structured item category from a task snapshot", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);

    for (const text of [
      "读取真实历史",
      "Turn 执行失败",
      "模型服务不可用",
      "分析协议",
      "pnpm check",
      "输出已截断",
      "src/index.ts",
      "filesystem/read_file",
      "1. 定义协议",
      "上下文压缩",
    ]) {
      expect(markup).toContain(text);
    }
  });
});
