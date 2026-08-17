import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { DropdownMenu } from "../../../shared/components/core/dropdown-menu.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { requestNextProjectTaskPage } from "../../projects/project-context.js";
import {
  deriveProjectSidebarConnectionState,
  getProjectTaskPaginationControl,
  getProjectSidebarConnectionStatus,
  groupTasksByProjectId,
  ProjectActionMenu,
  ProjectActions,
  ProjectPickerButton,
  SidebarSettingsButton,
  TaskStatusIndicator,
  getTaskRoute,
  TaskActionMenu,
} from "./project-sidebar.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";
import { TemporaryTasksHeading } from "./project-sidebar-task-list.js";

describe("Project task pagination", () => {
  it("offers a new task icon beside temporary tasks", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TemporaryTasksHeading onCreate={vi.fn()} />
      </TooltipProvider>,
    );

    expect(markup).toContain("临时任务");
    expect(markup).toContain('aria-label="新建任务"');
    expect(markup).toContain("lucide-plus");
  });

  it("keeps temporary task navigation outside Project routes", () => {
    expect(getTaskRoute("temporary", "task-1")).toEqual({
      params: { taskId: "task-1" },
      to: "/temporary/t/$taskId",
    });
    expect(getTaskRoute("project-1", "task-1")).toEqual({
      params: { projectId: "project-1", taskId: "task-1" },
      to: "/p/$projectId/t/$taskId",
    });
  });

  it("groups a large task list by Project while preserving task order", () => {
    const tasks = Array.from({ length: 300 }, (_, index) => ({
      id: `task-${String(index)}`,
      pinned: false,
      projectId: `project-${String(index % 3)}`,
      title: `Task ${String(index)}`,
      updatedAt: "2026-07-23T00:01:00.000Z",
    }));

    const tasksByProjectId = groupTasksByProjectId(tasks);

    expect(tasksByProjectId.get("project-0")).toHaveLength(100);
    expect(
      tasksByProjectId
        .get("project-0")
        ?.map((task) => task.id)
        .slice(0, 3),
    ).toEqual(["task-0", "task-3", "task-6"]);
    expect(tasksByProjectId.get("project-2")?.at(-1)?.id).toBe("task-299");
    expect(tasksByProjectId.get("missing-project")).toBeUndefined();
  });

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
        hasHiddenLoadedTasks: true,
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
      labelKey: "sidebar.connection.online",
      toneClassName: "text-diff-added",
    });
    expect(getProjectSidebarConnectionStatus("connecting")).toEqual({
      labelKey: "sidebar.connection.connecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("reconnecting")).toEqual({
      labelKey: "sidebar.connection.reconnecting",
      toneClassName: "text-warning",
    });
    expect(getProjectSidebarConnectionStatus("closed")).toEqual({
      labelKey: "sidebar.connection.offline",
      toneClassName: "text-danger",
    });
  });
});

describe("ProjectPickerButton", () => {
  it("opens the Web directory picker without exposing native picker state", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ProjectPickerButton disabled={false} onOpen={vi.fn()} />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="添加项目"');
    expect(markup).toContain('data-size="icon-sm"');
    expect(markup).not.toContain("LoaderCircle");
  });
});

describe("SidebarSettingsButton", () => {
  const appInfo = {
    appVersion: "1.3.0",
    codexVersion: "0.147.0",
    latestVersion: "1.3.0",
    releaseNotes: null,
    status: "current" as const,
    updateAvailable: false,
  };

  it("renders every connection status in Chinese", async () => {
    await changeAppLanguage("zh-CN");
    const cases = [
      ["connected", "在线"],
      ["connecting", "正在连接"],
      ["reconnecting", "正在重新连接"],
      ["closed", "离线"],
    ] as const;

    for (const [connectionState, label] of cases) {
      const markup = renderToStaticMarkup(
        <SidebarSettingsButton
          appInfo={appInfo}
          connectionState={connectionState}
          onOpen={vi.fn()}
        />,
      );
      expect(markup).toContain(`CodeAgent 1.3.0，终端连接状态：${label}`);
      expect(markup).toContain("v1.3.0");
      expect(markup).toContain(`>${label}</span>`);
      expect(markup).not.toContain("href=");
    }
  });

  it("renders every connection status in English", async () => {
    await changeAppLanguage("en");
    try {
      const cases = [
        ["connected", "Online"],
        ["connecting", "Connecting"],
        ["reconnecting", "Reconnecting"],
        ["closed", "Offline"],
      ] as const;

      for (const [connectionState, label] of cases) {
        const markup = renderToStaticMarkup(
          <SidebarSettingsButton
            appInfo={appInfo}
            connectionState={connectionState}
            onOpen={vi.fn()}
          />,
        );
        expect(markup).toContain(`CodeAgent 1.3.0, terminal connection status: ${label}`);
        expect(markup).toContain(`>${label}</span>`);
      }
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("uses a distinct version state when an update is available", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SidebarSettingsButton
        appInfo={{
          ...appInfo,
          latestVersion: "1.4.0",
          releaseNotes: "### 新增\n\n- 添加更新日志。",
          status: "available",
          updateAvailable: true,
        }}
        connectionState="connected"
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toContain("CodeAgent 1.3.0，有可用更新，终端连接状态：在线");
    expect(markup).toContain("lucide-circle-arrow-up");
    expect(markup).toContain('class="text-warning"');
  });
});

describe("TaskActionMenu", () => {
  it("offers pin, rename, and archive commands", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
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
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="结构化历史 的任务操作"');
    expect(markup).not.toContain("aria-labelledby");
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup.match(/data-slot="dropdown-menu-item"/gu)).toHaveLength(3);
    expect(markup).toContain("固定");
    expect(markup).toContain("重命名");
    expect(markup).toContain("归档");
  });
});

describe("Project folder actions", () => {
  const project = {
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "code-agent",
    name: "CodeAgent",
    rootPath: "/workspace/CodeAgent",
  };

  it("hides the action icon until the folder row is hovered or focused", () => {
    const markup = renderToStaticMarkup(
      <ProjectActions
        isPending={false}
        onRemove={() => undefined}
        onRename={() => undefined}
        project={project}
      />,
    );

    expect(markup).toContain("opacity-0");
    expect(markup).toContain("group-hover/project:opacity-100");
    expect(markup).toContain("focus-visible:opacity-100");
    expect(markup).toContain("data-[state=open]:opacity-100");
  });

  it("offers only rename and remove commands in that order", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu open>
        <ProjectActionMenu
          isPending={false}
          onRemove={() => undefined}
          onRename={() => undefined}
          project={project}
        />
      </DropdownMenu>,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('aria-label="CodeAgent 的项目操作"');
    expect(markup).not.toContain("aria-labelledby");
    expect(markup).toContain('data-slot="dropdown-menu-content"');
    expect(markup.match(/data-slot="dropdown-menu-item"/gu)).toHaveLength(2);
    expect(markup.indexOf("重命名")).toBeLessThan(markup.indexOf("删除"));
    expect(markup).not.toContain("新建任务");
    expect(markup).not.toContain("归档");
  });

  it("explains that rename and removal do not change the disk folder", () => {
    const renameMarkup = renderToStaticMarkup(
      <ProjectRenameDialog
        initialName={project.name}
        isPending={false}
        onClose={() => undefined}
        onRename={() => undefined}
      />,
    );
    const removeMarkup = renderToStaticMarkup(
      <ProjectRemoveDialog
        isPending={false}
        onClose={() => undefined}
        onRemove={() => undefined}
        project={project}
      />,
    );

    expect(renameMarkup).toContain("不会修改磁盘上的文件夹名称");
    expect(removeMarkup).toContain("不会删除磁盘上的文件夹及文件");
  });
});

describe("TaskStatusIndicator", () => {
  it("uses a slow breathing animation that respects reduced motion", () => {
    const css = readFileSync(
      new URL("../../../shared/styles/globals.css", import.meta.url),
      "utf8",
    );
    const keyframes = css.slice(
      css.indexOf("@keyframes task-status-breathe"),
      css.indexOf(
        "@media (prefers-reduced-motion: reduce)",
        css.indexOf("@keyframes task-status-breathe"),
      ),
    );
    const statusStyles = css.slice(
      css.indexOf(".task-status-dot {"),
      css.indexOf("@media (hover: none)"),
    );

    expect(css).toContain("@keyframes task-status-breathe");
    expect(css).toContain("--ui-color-task-running: light-dark(#3f8bdc, #5eabe9);");
    expect(css).toContain("--ui-color-task-waiting: light-dark(#d19a2b, #e1ad43);");
    expect(css).toContain("--ui-color-task-completed: light-dark(#48a765, #5dbd7a);");
    expect(css).toContain("--ui-color-task-failed: light-dark(#db5660, #eb7070);");
    expect(css).toContain("animation: task-status-breathe 4s");
    expect(keyframes).toContain("opacity: 0.68");
    expect(keyframes).toContain("opacity: 1");
    expect(keyframes).not.toContain("box-shadow");
    expect(statusStyles).not.toContain("box-shadow");
    expect(statusStyles).not.toContain("transform");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.task-status-dot--breathing[\s\S]*?animation: none;/u,
    );
  });

  it("shows a primary breathing dot while running", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval={false}
        isRunning
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="任务运行中"');
    expect(markup).toContain("text-task-running");
    expect(markup).toContain("task-status-dot--breathing");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("shows a yellow breathing dot while awaiting approval", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval
        isRunning
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="任务等待审批"');
    expect(markup).toContain("text-task-waiting");
    expect(markup).toContain("task-status-dot--breathing");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("task-age");
  });

  it("shows a static green dot when the reply completes", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="completed"
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复已完成"');
    expect(markup).toContain("text-task-completed");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("task-status-dot--breathing");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("shows a static red dot when the reply is interrupted", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention="failed"
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt="2026-07-23T00:01:00.000Z"
      />,
    );

    expect(markup).toContain('aria-label="AI 回复未完成"');
    expect(markup).toContain("text-task-failed");
    expect(markup).toContain("size-2");
    expect(markup).not.toContain("task-status-dot--breathing");
    expect(markup).not.toContain("lucide-");
    expect(markup).not.toContain("task-age");
  });

  it("keeps showing the task age after the task stops", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator
        attention={null}
        isAwaitingApproval={false}
        isRunning={false}
        updatedAt={new Date().toISOString()}
      />,
    );

    expect(markup).toContain("task-age");
    expect(markup).not.toContain('aria-label="任务运行中"');
  });
});
