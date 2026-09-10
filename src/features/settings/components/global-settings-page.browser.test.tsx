import type { AgentGlobalSettings } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsPage } from "./global-settings-page.js";
import { createFallbackSettings } from "./global-settings-model.js";
import { getNotificationPreference } from "../notification-preference.js";
import "../../../shared/styles/globals.css";

const models = [{
  id: "gpt-5.4", displayName: "GPT-5.4", description: "", isDefault: true,
  inputModalities: ["text" as const], defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"].map((id) => ({ id, description: id })),
}];

async function renderSettings(initialSection: "appearance" | "commit" = "appearance") {
  await i18n.changeLanguage("zh-CN");
  const onClose = vi.fn();
  const onSave = vi.fn(async (_settings: AgentGlobalSettings) => undefined);
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <div style={{ height: "100dvh" }}>
          <GlobalSettingsPage
            apps={[]}
            error={null}
            initialSection={initialSection}
            isPending={false}
            models={models}
            onClose={onClose}
            onRetry={vi.fn()}
            onSave={onSave}
            settings={createFallbackSettings(models)}
          />
        </div>
      </TooltipProvider>
    </I18nextProvider>,
  );
  return { onClose, onSave, screen };
}

describe("GlobalSettingsPage", () => {
  it("uses only the outer search focus ring and names model defaults consistently", async () => {
    const { screen } = await renderSettings();
    const input = screen.getByRole("searchbox", { name: "搜索设置" }).element() as HTMLInputElement;
    input.focus();
    expect(input.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(input).outlineStyle).toBe("none");
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");
    expect(getComputedStyle(input.parentElement!).boxShadow).not.toBe("none");
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    await expect.element(screen.getByRole("heading", { name: "模型默认设置", exact: true })).toBeVisible();
  });
  it("frames settings groups and keeps labels smaller than section headings", async () => {
    const { screen } = await renderSettings();
    const heading = screen.getByRole("heading", { name: "通用", exact: true }).element();
    const group = heading.nextElementSibling as HTMLElement;
    const row = group.firstElementChild as HTMLElement;
    const label = row.querySelector("span")!;
    const description = row.querySelector("p")!;
    const cardStyle = getComputedStyle(group);
    expect(cardStyle.borderLeftWidth).toBe("1px");
    expect(cardStyle.borderRightWidth).toBe("1px");
    expect(Number.parseFloat(cardStyle.borderRadius)).toBe(8);
    expect(Number.parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThan(Number.parseFloat(getComputedStyle(label).fontSize));
    expect(Number.parseFloat(getComputedStyle(label).fontSize)).toBeGreaterThan(Number.parseFloat(getComputedStyle(description).fontSize));
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(66);
    expect(screen.getByRole("combobox", { name: "默认打开方式" }).element().getBoundingClientRect().height).toBeLessThanOrEqual(32);
    await screen.getByRole("button", { name: "提交消息", exact: true }).click();
    const panel = document.querySelector("#settings-panel-commit")!;
    expect(getComputedStyle(panel.lastElementChild!).borderLeftWidth).toBe("1px");
  });
  it("keeps permissions and runtime preferences in agent configuration", async () => {
    const { screen, onSave } = await renderSettings();
    expect(screen.getByRole("combobox", { name: "审批", exact: true }).all()).toHaveLength(0);
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    await screen.getByRole("combobox", { name: "审批", exact: true }).selectOptions("auto-review");
    await screen.getByRole("combobox", { name: "工作区", exact: true }).selectOptions("read-only");
    await screen.getByRole("combobox", { name: "网页搜索", exact: true }).selectOptions("live");
    await screen.getByRole("combobox", { name: "输出详细程度", exact: true }).selectOptions("high");
    expect(screen.getByRole("combobox", { name: "推理摘要", exact: true }).all()).toHaveLength(0);
    await expect.poll(() => onSave.mock.calls.at(-1)?.[0]).toMatchObject({
      approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxMode: "read-only",
      webSearch: "live", modelVerbosity: "high",
    });
    await screen.getByRole("combobox", { name: "输出详细程度", exact: true }).selectOptions("");
    await expect.poll(() => onSave.mock.calls.at(-1)?.[0]).toMatchObject({ modelVerbosity: null });
    for (const term of ["审批", "工作区", "网页搜索", "输出详细程度"]) {
      await screen.getByRole("searchbox", { name: "搜索设置" }).fill(term);
      await expect.element(screen.getByRole("button", { name: "智能体配置", exact: true })).toBeVisible();
      expect(screen.getByRole("button", { name: "常规", exact: true }).all()).toHaveLength(0);
    }
    await screen.getByRole("button", { name: "清除搜索" }).click();
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      await page.viewport(width, height);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `../../../../test-results/settings-page-agent-${width}.png` });
    }
    document.documentElement.dataset.theme = "dark";
    await page.screenshot({ path: "../../../../test-results/settings-page-agent-dark.png" });
    document.documentElement.dataset.theme = "light";
    await i18n.changeLanguage("en");
    await page.viewport(1280, 720);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: "../../../../test-results/settings-page-agent-en.png" });
    await i18n.changeLanguage("zh-CN");
  });
  it("keeps general preferences and follow-up controls in General", async () => {
    const { screen, onSave } = await renderSettings();
    for (const name of ["通用", "编辑器", "通知"]) {
      await expect.element(screen.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await screen.getByRole("button", { name: "引导", exact: true }).click();
    await expect.poll(() => onSave.mock.calls.at(-1)?.[0]).toMatchObject({ followUpBehavior: "steer" });
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "引导", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
  it("opens a full-page settings view with navigation and no modal", async () => {
    const { screen } = await renderSettings();
    await expect.element(screen.getByRole("main", { name: "全局设置" })).toBeVisible();
    expect(screen.getByRole("dialog").all()).toHaveLength(0);
    await expect.element(screen.getByRole("button", { name: "返回应用" })).toBeVisible();
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    await expect.element(screen.getByRole("combobox", { name: "模型", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "智能体配置", exact: true })).toHaveAttribute("aria-current", "page");
    await screen.getByRole("button", { name: "常规", exact: true }).click();

    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      await page.viewport(width, height);
      const bounds = screen.getByRole("main", { name: "全局设置" }).element().getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(width / 2);
      expect(bounds.height).toBe(height);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `../../../../test-results/settings-page-${width}.png` });
    }
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    document.documentElement.dataset.theme = "dark";
    await page.screenshot({ path: "../../../../test-results/settings-page-dark.png" });
    document.documentElement.dataset.theme = "light";
    await page.viewport(1440, 900);
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    await page.screenshot({ path: "../../../../test-results/settings-page-general.png" });
    await i18n.changeLanguage("en");
    await page.viewport(1280, 720);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: "../../../../test-results/settings-page-general-en.png" });
    await i18n.changeLanguage("zh-CN");
    await page.viewport(1440, 900);
  });

  it("finds settings by field label and keeps navigation available after clearing search", async () => {
    const { screen } = await renderSettings();
    const search = screen.getByRole("searchbox", { name: "搜索设置" });
    await search.fill("思考量");
    await expect.element(screen.getByRole("button", { name: "智能体配置", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "常规", exact: true }).all()).toHaveLength(0);
    await screen.getByRole("button", { name: "智能体配置", exact: true }).click();
    await expect.element(screen.getByRole("combobox", { name: "思考量", exact: true })).toBeVisible();
    await search.fill("no-matching-setting");
    await expect.element(screen.getByText("未找到相关设置")).toBeVisible();
    await screen.getByRole("button", { name: "清除搜索" }).click();
    await expect.element(screen.getByRole("button", { name: "常规", exact: true })).toBeVisible();
  });

  it("flushes the latest prompt before returning to the app", async () => {
    const { screen, onClose, onSave } = await renderSettings("commit");
    await screen.getByRole("textbox", { name: "提交提示词" }).fill("新的提交规则");
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    await screen.getByRole("button", { name: "提交消息", exact: true }).click();
    await expect.element(screen.getByRole("textbox", { name: "提交提示词" })).toHaveValue("新的提交规则");
    await screen.getByRole("button", { name: "返回应用" }).click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ commitMessagePrompt: "新的提交规则" }));
  });

  it("clears search before returning with Escape and defers to nested dialogs", async () => {
    const { screen, onClose } = await renderSettings();
    const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const search = screen.getByRole("searchbox", { name: "搜索设置" });
    await search.fill("思考量");
    escape();
    await expect.element(search).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    const modal = document.createElement("dialog");
    modal.open = true;
    document.body.append(modal);
    try {
      escape();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      modal.remove();
    }
    escape();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("updates the existing notification preference from the General switch", async () => {
    const { screen, onSave } = await renderSettings();
    const initial = getNotificationPreference();
    const toggle = screen.getByRole("switch", { name: "任务通知" });
    await expect.element(toggle).toHaveAttribute("aria-checked", String(initial));
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", String(!initial));
    expect(getNotificationPreference()).toBe(!initial);
    expect(onSave).not.toHaveBeenCalled();
    await toggle.click();
    expect(getNotificationPreference()).toBe(initial);
  });
});
