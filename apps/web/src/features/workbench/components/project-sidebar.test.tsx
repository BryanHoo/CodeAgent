import type { PendingRequest } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  deriveProjectSidebarConnectionState,
  getProjectSidebarConnectionStatus,
  hasPendingApproval,
  TaskStatusIndicator,
  TaskActionMenu,
} from "./project-sidebar.js";

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
  it("detects only unresolved command and file change approvals", () => {
    const pendingCommandApproval: PendingRequest = {
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2026-07-23T00:00:00.000Z",
      cwd: "/workspace/CodeAgent",
      expiresAt: null,
      itemId: "command-1",
      networkAccess: null,
      projectId: "code-agent",
      reason: null,
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval",
    };

    expect(hasPendingApproval([pendingCommandApproval])).toBe(true);
    expect(hasPendingApproval([{ ...pendingCommandApproval, status: "resolved" }])).toBe(false);
  });

  it("replaces the task age with an accessible spinner while running", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        isAwaitingApproval={false}
        isRunning
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="任务运行中"');
    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("shows a primary approval icon instead of the running spinner while awaiting approval", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator isAwaitingApproval isRunning updatedAt="2026-07-23T00:01:00.000Z" />,
    );

    expect(markup).toContain('aria-label="任务等待审批"');
    expect(markup).toContain("text-accent");
    expect(markup).toContain("lucide-shield-question-mark");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("keeps showing the task age after the task stops", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt={new Date().toISOString()}
      />,
    );

    expect(markup).toContain("task-age");
    expect(markup).not.toContain('aria-label="任务运行中"');
  });
});
