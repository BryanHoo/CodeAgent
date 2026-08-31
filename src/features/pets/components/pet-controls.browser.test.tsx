import type { WorkbenchPetDescriptor } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import type { DesktopPetTask } from "../../../protocol/desktop-pet.js";
import "../../../shared/styles/desktop-pet.css";
import { GlobalSettingsPetsView } from "./global-settings-pets.js";
import { WorkbenchPetBubbles } from "./workbench-pet-bubbles.js";

const tasks = [
  {
    projectId: "project-a",
    rootPath: "/workspace/a",
    status: "running",
    taskId: "task-a",
    taskName: "正在执行的任务",
  },
  {
    projectId: "project-b",
    rootPath: "/workspace/b",
    status: "completed",
    taskId: "task-b",
    taskName: "已经完成的任务",
  },
] as const satisfies readonly DesktopPetTask[];

const downloadablePet = {
  animations: {},
  assetId: "a".repeat(64),
  availability: "downloadable",
  description: "测试宠物",
  displayName: "Codex",
  frame: { columns: 1, height: 32, rows: 1, width: 32 },
  id: "codex",
  source: "builtin",
} as const satisfies WorkbenchPetDescriptor;

describe("桌面宠物控件", () => {
  it("按输入顺序自然排列任务气泡", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <WorkbenchPetBubbles onTaskSelect={() => undefined} tasks={tasks} />
      </I18nextProvider>,
    );
    const bubbles = screen.getByRole("listitem").elements();

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.textContent).toContain("正在执行的任务");
    expect(bubbles[1]?.textContent).toContain("已经完成的任务");
    expect(bubbles[1]!.getBoundingClientRect().top - bubbles[0]!.getBoundingClientRect().bottom).toBe(
      6,
    );
  });

  it("通过下拉选项切换桌面宠物启用状态", async () => {
    await i18n.changeLanguage("zh-CN");
    const onEnabledChange = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsPetsView
          error={null}
          isLoading={false}
          onEnabledChange={onEnabledChange}
          onPetSelect={() => undefined}
          onRefresh={() => undefined}
          pets={[downloadablePet]}
          settings={{ enabled: true, selectedPetId: "codex" }}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "桌面宠物" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "启用桌面宠物" }).query()).toBeNull();
    await screen.getByRole("combobox", { name: "启用桌面宠物" }).click();
    await screen.getByRole("option", { name: "关闭" }).click();

    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});
