import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { DropdownMenu } from "../../../shared/components/core/dropdown-menu.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { requestNextProjectTaskPage } from "../../projects/project-context.js";
import {
  getProjectTaskPaginationControl,
  groupTasksByProjectId,
  shouldShowProjectTaskEmptyState,
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

  it("does not show the empty state before an expanded Project task query settles", () => {
    expect(shouldShowProjectTaskEmptyState(undefined, 0, "")).toBe(false);
    expect(
      shouldShowProjectTaskEmptyState(
        {
          error: null,
          isPending: true,
        },
        0,
        "",
      ),
    ).toBe(false);
    expect(
      shouldShowProjectTaskEmptyState(
        {
          error: null,
          isPending: false,
        },
        0,
        "",
      ),
    ).toBe(true);
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

  it("renders the version without a connection status in Chinese", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SidebarSettingsButton appInfo={appInfo} onOpenAbout={vi.fn()} onOpenSettings={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="设置"');
    expect(markup).toContain('aria-label="设置，CodeAgent 1.3.0"');
    expect(markup.match(/<button/gu)).toHaveLength(2);
    expect(markup).toContain("v1.3.0");
    expect(markup).not.toContain("在线");
    expect(markup).not.toContain("lucide-wifi");
    expect(markup).not.toContain("href=");
  });

  it("renders the version without a connection status in English", async () => {
    await changeAppLanguage("en");
    try {
      const markup = renderToStaticMarkup(
        <SidebarSettingsButton appInfo={appInfo} onOpenAbout={vi.fn()} onOpenSettings={vi.fn()} />,
      );

      expect(markup).toContain('aria-label="Settings"');
      expect(markup).toContain('aria-label="Settings, CodeAgent 1.3.0"');
      expect(markup).not.toContain("Online");
      expect(markup).not.toContain("lucide-wifi");
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
        onOpenAbout={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain("设置，CodeAgent 1.3.0，有可用更新");
    expect(markup).toContain("lucide-circle-arrow-up");
    expect(markup).toMatch(/class="[^"]*text-warning/u);
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
  it("keeps the activity animation limited to opacity with a reduced-motion fallback", () => {
    const styles = readFileSync(
      new URL("../../../shared/styles/globals.css", import.meta.url),
      "utf8",
    );
    const activityRule = /\.sidebar-task-activity\s*\{(?<declarations>[^}]*)\}/u.exec(styles);

    expect(activityRule?.groups?.["declarations"]).toContain(
      "animation: sidebar-task-activity 1.2s ease-in-out infinite",
    );
    expect(activityRule?.groups?.["declarations"]).not.toMatch(
      /(?:^|\n)\s*(?:border|transform|will-change)\s*:/u,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sidebar-task-activity\s*\{[\s\S]*?animation: none/u,
    );
  });

  it("replaces the task age with an accessible low-cost activity indicator while running", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator attention={null} isRunning updatedAt="2026-07-23T00:01:00.000Z" />,
    );

    expect(markup).toContain('aria-label="任务运行中"');
    expect(markup).toContain("-mr-2");
    expect(markup).toContain("w-7");
    expect(markup).toContain("justify-center");
    expect(markup).toContain("text-brand/60");
    expect(markup).toContain("sidebar-task-activity");
    expect(markup).not.toContain("sidebar-task-spinner");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("task-age");
  });

  it("shows a primary approval icon instead of the activity indicator while awaiting approval", () => {
    const markup = renderToStaticMarkup(
      <TaskStatusIndicator attention="approval" isRunning updatedAt="2026-07-23T00:01:00.000Z" />,
    );

    expect(markup).toContain('aria-label="任务等待审批"');
    expect(markup).toContain("text-brand");
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
