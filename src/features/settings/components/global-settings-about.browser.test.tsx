import type { AppInfoResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/CodeAgent/blob/main/CHANGELOG.md",
  codexVersion: "0.151.0",
  latestVersion: null,
  releaseNotes: "## [0.1.0] - 2026-08-31",
  releaseNotesVersion: "0.1.0",
  repositoryUrl: "https://github.com/BryanHoo/CodeAgent",
  status: "current",
  updateAvailable: false,
} satisfies AppInfoResponse;

describe("GlobalSettingsAbout", () => {
  it("keeps release notes available and links to the project changelog", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsAbout
          activeSection="about"
          appInfo={appInfo}
          error={null}
          isPending={false}
          onRetry={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.getByRole("link", { name: /BryanHoo\/CodeAgent/ })).toHaveAttribute(
      "href",
      appInfo.repositoryUrl,
    );
    await screen.getByRole("button", { name: "更新日志" }).click();
    expect(screen.getByRole("dialog")).toHaveTextContent("0.1.0 更新日志");
    expect(screen.getByRole("link", { name: "更多" })).toHaveAttribute(
      "href",
      appInfo.changelogUrl,
    );
  });
});
