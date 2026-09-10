import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsPage } from "./global-settings-page.js";
import { createFallbackSettings } from "./global-settings-model.js";

const { backgroundRead } = vi.hoisted(() => ({ backgroundRead: vi.fn() }));
vi.mock("./use-workbench-background-draft.js", () => ({
  useWorkbenchBackgroundDraft: () => {
    backgroundRead();
    return { background: {}, customImages: [], isLoading: false, isSavingImages: false, loadError: false };
  },
}));
vi.mock("./global-settings-background.js", () => ({ GlobalSettingsBackground: () => <div>Background loaded</div> }));

describe("settings lazy loading", () => {
  it("does not read background data before navigating to that section", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<TooltipProvider><GlobalSettingsPage apps={[]} error={null} isPending={false} models={[]} onClose={vi.fn()} onRetry={vi.fn()} onSave={async () => undefined} settings={createFallbackSettings([])} /></TooltipProvider>);
    await expect.element(screen.getByRole("heading", { name: "常规", exact: true })).toBeVisible();
    expect(backgroundRead).not.toHaveBeenCalled();
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("记忆");
    await expect.element(screen.getByRole("button", { name: "个性化", exact: true })).toBeVisible();
    expect(backgroundRead).not.toHaveBeenCalled();
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("");
    await screen.getByRole("button", { name: "工作台背景", exact: true }).click();
    await expect.element(screen.getByText("Background loaded")).toBeVisible();
    expect(backgroundRead).toHaveBeenCalled();
  });
});
