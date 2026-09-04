import type { ScheduledTask } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("../workbench/components/workbench-composer.js", async () => {
  const { useEffect, useImperativeHandle, useState } = await import("react");
  return {
    WorkbenchComposer: (props: {
      captureSubmitVisible?: boolean;
      composerRef?: React.Ref<unknown>;
      footerVisible?: boolean;
      initialDraft?: {
        attachments: readonly unknown[];
        content: readonly unknown[];
      };
      onCaptureSubmission?: (
        prompt: ScheduledTask["prompt"],
        turnOptions: ScheduledTask["turnOptions"],
        attachments: readonly [],
      ) => Promise<void>;
      onInputStateChange?: (hasInput: boolean) => void;
      settings: ScheduledTask["turnOptions"];
    }) => {
      const { onInputStateChange } = props;
      const [hasInput, setHasInput] = useState(
        (props.initialDraft?.attachments.length ?? 0) > 0 ||
          (props.initialDraft?.content.length ?? 0) > 0,
      );
      useEffect(() => onInputStateChange?.(hasInput), [hasInput, onInputStateChange]);
      useImperativeHandle(props.composerRef, () => ({
        submitCurrent: async () => {
          try {
            await props.onCaptureSubmission?.(
              { attachments: [], skills: [], text: "Review", type: "prompt" },
              props.settings,
              [],
            );
            return true;
          } catch (error) {
            // 模拟真实 Composer 对捕获模式错误的唯一通知职责。
            const { notifyActionError } = await import("../notifications/action-notifications.js");
            notifyActionError(error);
            return false;
          }
        },
      }));
      return (
        <div
          data-capture-submit-visible={String(props.captureSubmitVisible)}
          data-footer-visible={String(props.footerVisible)}
        >
          <button onClick={() => setHasInput(true)} type="button">
            填写测试提示词
          </button>
        </div>
      );
    },
  };
});

import "../../shared/styles/globals.css";
import "../../shared/styles/scheduled-tasks.css";
import { createActionMutationCache } from "../notifications/action-notifications.js";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import {
  TauriSidebarClient,
  type InvokeImplementation,
} from "../../platform/tauri/sidebar-client.js";
import { ScheduledTaskEditor } from "./scheduled-task-editor.js";
import { ScheduledTaskList } from "./scheduled-task-list.js";
import { ScheduledTasksContainer } from "./scheduled-tasks-container.js";

const task: ScheduledTask = {
  createdAtUnixMs: 1,
  enabled: true,
  id: "schedule-a",
  lastRunAtUnixMs: 2,
  lastRunStatus: "failed",
  name: "每日巡检",
  nextRunAtUnixMs: 2_000_000_000_000,
  projectId: "project-a",
  projectName: "Project A",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  runs: [],
  schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  updatedAtUnixMs: 2,
};

describe("ScheduledTaskList", () => {
  it("renders search and an icon-only create action in the list header", async () => {
    await i18n.changeLanguage("zh-CN");
    const onCreate = vi.fn();
    const onEnabledChange = vi.fn();
    const onSelect = vi.fn();
    const setQuery = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskList
          activeId="schedule-a"
          loading={false}
          onCreate={onCreate}
          onEnabledChange={onEnabledChange}
          onSelect={onSelect}
          query="巡检"
          setQuery={setQuery}
          tasks={[task]}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "定时任务" })).toBeVisible();
    expect(
      screen.container.querySelector(".scheduled-task-list__header span")?.textContent,
    ).toBe("1");
    await expect.element(screen.getByText("每日巡检")).toBeVisible();
    expect(screen.container.querySelector("[data-tone='failed']")).not.toBeNull();
    await screen.getByRole("searchbox", { name: "搜索定时任务" }).fill("日报");
    const createButton = screen.getByRole("button", { name: "新建定时任务" });
    expect(createButton.element().textContent).toBe("");
    expect(createButton.element().querySelector("svg")).not.toBeNull();
    expect(createButton.element().getAttribute("data-size")).toBe("icon-toolbar");
    expect(createButton.element().getAttribute("data-variant")).toBe("default");
    await createButton.click();
    await screen.getByRole("button", { name: "每日巡检" }).click();
    await screen.getByRole("switch", { name: "停用每日巡检" }).click();
    expect(setQuery).toHaveBeenLastCalledWith("日报");
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onEnabledChange).toHaveBeenCalledWith("schedule-a", false);
  });

  it("uses an explicit editor save button and hides composer submission chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    const onSave = vi.fn(async () => undefined);
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor
          composerProps={{ settings: task.turnOptions } as never}
          onDelete={async () => undefined}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={onSave}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    expect(screen.container.querySelector("[data-capture-submit-visible='false']")).not.toBeNull();
    expect(screen.container.querySelector("[data-footer-visible='false']")).not.toBeNull();
    const prompt = screen.container.querySelector<HTMLElement>(".scheduled-task-prompt");
    expect(prompt).not.toBeNull();
    expect(getComputedStyle(prompt!).borderBottomWidth).toBe("0px");
    await screen.getByRole("button", { name: "保存任务" }).click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("disables save until required fields and composer input are complete", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor
          composerProps={{ settings: task.turnOptions } as never}
          onDelete={async () => undefined}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
        />
      </I18nextProvider>,
    );

    const save = screen.getByRole("button", { name: "保存任务" });
    await expect.element(save).toBeDisabled();
    await screen.getByRole("textbox", { name: "任务名称" }).fill("每日巡检");
    await expect.element(save).toBeDisabled();
    await screen.getByRole("button", { name: "填写测试提示词" }).click();
    await expect.element(save).toBeEnabled();
  });

  it("separates run, save, and destructive delete actions", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor
          composerProps={{ settings: task.turnOptions } as never}
          onDelete={async () => undefined}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    const toolbar = screen.container.querySelector(".scheduled-task-editor__toolbar");
    const dangerZone = screen.container.querySelector(".scheduled-task-danger-zone");
    expect(toolbar?.querySelector("[aria-label='立即运行']")).not.toBeNull();
    expect(toolbar?.querySelector("[aria-label='保存任务']")).not.toBeNull();
    expect(toolbar?.querySelector("[aria-label='删除']")).toBeNull();
    expect(dangerZone?.querySelector("[aria-label='删除']")?.getAttribute("data-variant")).toBe(
      "destructive",
    );
  });

  it("keeps the repeat field fixed when the date picker opens", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <ScheduledTaskEditor
          composerProps={{ settings: task.turnOptions } as never}
          onDelete={async () => undefined}
          onOpenRun={() => undefined}
          onProjectChange={() => undefined}
          onRunNow={async () => undefined}
          onSave={async () => undefined}
          projectId={task.projectId}
          projects={[]}
          skills={[]}
          task={task}
        />
      </I18nextProvider>,
    );

    const repeat = screen.getByRole("combobox", { name: "重复规则" });
    const topBeforeOpen = repeat.element().getBoundingClientRect().top;
    await screen.getByRole("textbox", { name: "触发时间" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    const topAfterOpen = repeat.element().getBoundingClientRect().top;

    expect(Math.abs(topAfterOpen - topBeforeOpen)).toBeLessThan(1);
  });

  it("shows one error toast when saving through the composer fails", async () => {
    await i18n.changeLanguage("zh-CN");
    const nativeMessage = "invalid args `input`: missing field `atUnixMs`";
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_scheduled_tasks") return { data: [] };
      return Promise.reject(nativeMessage);
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const queryClient = new QueryClient({ mutationCache: createActionMutationCache() });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ScheduledTasksContainer
            context={{
              client,
              draftSettings: task.turnOptions,
              fastModeAvailable: false,
              fastModeDefault: false,
              gitStatusQuery: {},
              models: [],
              modelsQuery: { isPending: false },
              navigate: vi.fn(),
              openProjectFolder: vi.fn(),
              projectFolderOpenDisabled: false,
              projectName: "Project A",
              projectPath: "/project-a",
              projectRoots: [],
              projects: [],
              setSelectedRootId: vi.fn(),
              skillsQuery: {},
              t: i18n.t,
            } as never}
            projectId="project-a"
            temporary={false}
          />
          <Toaster />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "新建定时任务" }).click();
    await screen.getByRole("textbox", { name: "任务名称" }).fill("每日巡检");
    await screen.getByRole("button", { name: "填写测试提示词" }).click();
    await screen.getByRole("button", { name: "保存任务" }).click();
    await expect.element(screen.getByText(nativeMessage)).toBeVisible();
    expect(screen.container.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });
});
