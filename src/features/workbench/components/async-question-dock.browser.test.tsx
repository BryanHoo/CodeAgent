import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AsyncQuestionProvider } from "./async-question-session.js";
import { AsyncQuestionDock } from "./async-question-dock.js";
import { questionItem, questionTask } from "./async-question-test-fixtures.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

test("switches groups and preserves answers while collapsed, then removes accepted groups", async () => {
  const submit = vi.fn(async () => true);
  const store = questionTask([questionItem("first", "第一组"), questionItem("second", "第二组")]);
  const screen = await render(<TooltipProvider>
    <AsyncQuestionProvider enabled submit={submit}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
  </TooltipProvider>);
  await expect.element(screen.getByText("第一组", { exact: true })).toBeVisible();
  await screen.getByRole("textbox").fill("保留草稿");
  await screen.getByRole("button", { name: /下一组问题|Next questions/u }).click();
  await expect.element(screen.getByText("第二组", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: /上一组问题|Previous questions/u }).click();
  await expect.element(screen.getByRole("textbox")).toHaveValue("保留草稿");
  await screen.getByRole("button", { name: /收起问题|Collapse questions/u }).click();
  await expect.element(screen.getByRole("textbox", { includeHidden: true })).not.toBeVisible();
  await screen.getByRole("button", { name: /展开问题|Expand questions/u }).click();
  await expect.element(screen.getByRole("textbox")).toHaveValue("保留草稿");
  await screen.getByRole("button", { name: /发送回答|Send answers/u }).click();
  await expect.element(screen.getByText("第二组", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: /发送回答|Send answers/u }).click();
  await expect.element(screen.getByRole("region", { name: /待回答问题|Pending questions/u })).not.toBeInTheDocument();
  expect(submit).toHaveBeenNthCalledWith(1, "第一组\n保留草稿");
  expect(submit).toHaveBeenNthCalledWith(2, "第二组\n当前文件");
});

test("stays above the composer while the timeline scrolls and bounds tall forms", async () => {
  const store = questionTask([{ ...questionItem("first"), questions: Array.from({ length: 16 }, (_, index) => ({
    title: `确认事项 ${index + 1}`, options: ["当前文件", "整个项目"],
  })) }]);
  const screen = await render(<TooltipProvider>
    <div style={{ display: "flex", flexDirection: "column", width: 720, height: 600 }}>
      <div data-testid="timeline" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div style={{ height: 2400 }}>执行记录</div>
      </div>
      <AsyncQuestionProvider enabled submit={async () => true}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
      <textarea aria-label="composer" style={{ height: 90, flexShrink: 0 }} defaultValue="未发送草稿" />
    </div>
  </TooltipProvider>);
  const region = screen.getByRole("region", { name: /待回答问题|Pending questions/u }).element();
  const before = region.getBoundingClientRect();
  const timeline = screen.getByTestId("timeline").element();
  timeline.scrollTop = 1200;
  expect(region.getBoundingClientRect().top).toBe(before.top);
  expect(before.height).toBeLessThan(360);
  expect(screen.getByRole("textbox", { name: "composer", exact: true }).element().getBoundingClientRect().top).toBeGreaterThanOrEqual(before.bottom);
  await page.screenshot({ path: "../../../../test-results/codeagent-153-question-dock.png" });
});
