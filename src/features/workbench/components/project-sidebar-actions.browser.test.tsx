import type { AppInfoResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/CodeAgent/blob/main/CHANGELOG.md",
  codexVersion: "0.153.4",
  latestVersion: "0.2.0",
  releaseNotes: "Update notes",
  releaseNotesVersion: "0.2.0",
  repositoryUrl: "https://github.com/BryanHoo/CodeAgent",
  status: "available",
  updateAvailable: true,
} satisfies AppInfoResponse;

describe("SidebarSettingsButton", () => {
  it("shows a compact upgrade hint next to the version and opens About", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpen = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <SidebarSettingsButton appInfo={appInfo} onOpen={onOpen} />
      </I18nextProvider>,
    );

    const aboutButton = screen.getByRole("button", { name: /CodeAgent v0\.1\.0/ });
    await expect.element(aboutButton).toHaveTextContent("v0.1.0 升级");
    await aboutButton.click();
    expect(onOpen).toHaveBeenCalledWith("about");
  });

  it("does not show the update hint when the app is current", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <SidebarSettingsButton
          appInfo={{
            ...appInfo,
            latestVersion: null,
            status: "current",
            updateAvailable: false,
          }}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByText("v0.1.0", { exact: true })).toBeVisible();
    expect(screen.getByText("升级").query()).toBeNull();
  });
});
