import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { requestNextProjectTaskPage } from "../../projects/project-context.js";
import {
  deriveProjectSidebarConnectionState,
  getProjectTaskPaginationControl,
  getProjectSidebarConnectionStatus,
  SidebarSettingsButton,
  TaskStatusIndicator,
  TaskActionMenu,
} from "./project-sidebar.js";

describe("Project task pagination", () => {
  it("requests only the selected Project next page", async () => {
    const fetchFirstProjectNextPage = vi.fn(() => Promise.resolve());
    const fetchSecondProjectNextPage = vi.fn(() => Promise.resolve());
    const projectTaskControllers = new Map([
      ["project-1", { fetchNextPage: fetchFirstProjectNextPage }],
      ["project-2", { fetchNextPage: fetchSecondProjectNextPage }],
    ]);

    await requestNextProjectTaskPage(projectTaskControllers, "project-2");

    expect(fetchFirstProjectNextPage).not.toHaveBeenCalled();
    expect(fetchSecondProjectNextPage).toHaveBeenCalledOnce();
  });

  it("ignores a next-page request for an unavailable Project", async () => {
    await expect(requestNextProjectTaskPage(new Map(), "missing-project")).resolves.toBeUndefined();
  });

  it("separates local expansion, remote loading, retry, and collapse actions", () => {
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: false,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "expand-and-load", disabled: false, label: "显示更多" });
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: true,
        isFetchingNextPage: true,
      }),
    ).toEqual({ action: "load", disabled: true, label: "正在加载更多" });
    expect(
      getProjectTaskPaginationControl({
        error: new Error("network"),
        hasHiddenLoadedTasks: false,
        hasNextPage: true,
        isExpanded: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "load", disabled: false, label: "重试加载更多" });
    expect(
      getProjectTaskPaginationControl({
        error: null,
        hasHiddenLoadedTasks: true,
        hasNextPage: false,
        isExpanded: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({ action: "collapse", disabled: false, label: "收起" });
  });
});

describe("ProjectSidebar connection status", () => {
  it("uses the active task terminal connection state", () => {
    for (const connectionState of ["closed", "connected", "connecting", "reconnecting"] as const) {
      expect(
        deriveProjectSidebarConnectionState({
          hasActiveTask: true,
          projectDataFailed: true,
          projectDataPending: true,
          taskConnectionState: connectionState,
        }),
      ).toBe(connectionState);
    }
  });

  it("derives an HTTP runtime status before a task terminal exists", () => {
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: false,
        projectDataPending: true,
        taskConnectionState: "connecting",
      }),
    ).toBe("connecting");
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: false,
        projectDataPending: false,
        taskConnectionState: "connecting",
      }),
    ).toBe("connected");
    expect(
      deriveProjectSidebarConnectionState({
        hasActiveTask: false,
        projectDataFailed: true,
        projectDataPending: false,
        taskConnectionState: "connecting",
      }),
    ).toBe("closed");
  });

  it("maps every transport state to a visible status", () => {
    expect(getProjectSidebarConnectionStatus("connected")).toEqual({
      label: "Online",
      toneClassName: "text-diff-added",
    });
    expect(getProjectSidebarConnectionStatus("connecting")).toEqual({
      label: "Connecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("reconnecting")).toEqual({
      label: "Reconnecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("closed")).toEqual({
      label: "Offline",
      toneClassName: "text-danger",
    });
  });
});

describe("SidebarSettingsButton", () => {
  it("opens settings in place without rendering a navigation link", () => {
    const markup = renderToStaticMarkup(
      <SidebarSettingsButton connectionState="connected" onOpen={vi.fn()} />,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("Settings");
    expect(markup).not.toContain("href=");
  });
});

describe("TaskActionMenu", () => {
  it("offers pin, rename, and archive commands", () => {
    const markup = renderToStaticMarkup(
      <TaskActionMenu
        isPending={false}
        onArchive={() => undefined}
        onPin={() => undefined}
        onRename={() => undefined}
        task={{
          id: "task-1",
          pinned: false,
          projectId: "code-agent",
          title: "结构化历史",
          updatedAt: "2026-07-23T00:01:00.000Z",
        }}
      />,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain("固定");
    expect(markup).toContain("重命名");
    expect(markup).toContain("归档");
  });
});

describe("TaskStatusIndicator", () => {
  it("replaces the task age with an accessible spinner while running", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator attention={null} isRunning updatedAt="2026-07-23T00:01:00.000Z" />,
    );

    expect(markup).toContain('aria-label="任务运行中"');
    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("shows a primary approval icon instead of the running spinner while awaiting approval", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator attention="approval" isRunning updatedAt="2026-07-23T00:01:00.000Z" />,
    );

    expect(markup).toContain('aria-label="任务等待审批"');
    expect(markup).toContain("text-accent");
    expect(markup).toContain("lucide-shield-question-mark");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("shows an accessible completed reply marker before the task age", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="completed"
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复已完成"');
    expect(markup).toContain("text-diff-added");
    expect(markup).toContain("lucide-circle-check");
    expect(markup).not.toContain("task-age");
  });

  it("shows an accessible unfinished reply marker before the task age", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="failed"
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复未完成"');
    expect(markup).toContain("text-danger");
    expect(markup).toContain("lucide-circle-alert");
    expect(markup).not.toContain("task-age");
  });

  it("keeps showing the task age after the task stops", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isRunning={false}
        updatedAt={new Date().toISOString()}
      />,
    );

    expect(markup).toContain("task-age");
    expect(markup).not.toContain('aria-label="任务运行中"');
  });
});
