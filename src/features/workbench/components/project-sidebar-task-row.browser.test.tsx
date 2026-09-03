import type { AgentTask } from "@/protocol/index.js";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { sidebarWidthLimits } from "./workbench-panel-layout.js";
import { TaskActionMenu, TaskLink } from "./project-sidebar-task-row.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params: _params, to: _to, ...props }: ComponentProps<"a"> & {
    params?: unknown;
    to?: string;
  }) => <a {...props}>{children}</a>,
}));

const task: AgentTask = {
  id: "task-diagnostic-123",
  pinned: false,
  projectId: "project-a",
  title: "排查异常",
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("TaskActionMenu", () => {
  it("copies the current task ID", async () => {
    await i18n.changeLanguage("zh-CN");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>打开任务菜单</DropdownMenuTrigger>
          <TaskActionMenu
            isPending={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={task}
          />
        </DropdownMenu>
      </I18nextProvider>,
    );

    const copyItem = screen.getByRole("menuitem", { name: "复制任务 ID" });
    await copyItem.click();

    expect(writeText).toHaveBeenCalledWith(task.id);
  });

  it("使归档与普通菜单项保持同色", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>打开任务菜单</DropdownMenuTrigger>
          <TaskActionMenu
            isPending={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={task}
          />
        </DropdownMenu>
      </I18nextProvider>,
    );

    const archiveColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "归档" }).element(),
    ).color;
    const renameColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "重命名" }).element(),
    ).color;
    const deleteColor = getComputedStyle(
      screen.getByRole("menuitem", { name: "永久删除" }).element(),
    ).color;

    expect(archiveColor).toBe(renameColor);
    expect(archiveColor).not.toBe(deleteColor);
  });
});

describe("TaskLink", () => {
  it("在默认宽度侧边栏中单行完整展示常见长任务标题", async () => {
    await i18n.changeLanguage("zh-CN");
    const longTask = {
      ...task,
      title: "推送GitHub打包，发布 GitHub Draft 版本到 Release",
    };
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <div style={{ width: sidebarWidthLimits.default }}>
          <TaskLink
            active
            attention={null}
            isActionPending={false}
            isAwaitingApproval={false}
            isRunning={false}
            onArchive={vi.fn()}
            onDelete={vi.fn()}
            onPin={vi.fn()}
            onRename={vi.fn()}
            task={longTask}
          />
        </div>
      </I18nextProvider>,
    );

    const title = screen.getByText(longTask.title).element();

    // 常见长度的任务名应保持单行且无需省略。
    expect(getComputedStyle(title).whiteSpace).toBe("nowrap");
    expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth);
  });
});
