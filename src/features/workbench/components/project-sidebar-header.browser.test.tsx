import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";
import { ProjectSidebarHeader } from "./project-sidebar-header.js";

function ProjectSidebarHeaderHarness() {
  const [query, setQuery] = useState("");
  const [searchRequest, setSearchRequest] = useState(0);

  return (
    <aside className="workbench-sidebar w-sidebar bg-sidebar">
      <button onClick={() => setSearchRequest((request) => request + 1)} type="button">
        外部搜索
      </button>
      <ProjectSidebarHeader
        onClose={vi.fn()}
        query={query}
        searchRequest={searchRequest}
        setQuery={setQuery}
      />
    </aside>
  );
}

describe("ProjectSidebarHeader", () => {
  it("expands task search on demand and restores focus after closing", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ProjectSidebarHeaderHarness />
        </TooltipProvider>
      </I18nextProvider>,
    );

    const searchButton = screen.getByRole("button", { name: "搜索任务" });
    expect(screen.getByRole("textbox", { name: "搜索任务" }).query()).toBeNull();
    await expect.element(screen.getByRole("img", { name: "CodeAgent" })).toBeVisible();

    await searchButton.click();
    const searchInput = screen.getByRole("textbox", { name: "搜索任务" });
    expect(document.activeElement).toBe(searchInput.element());
    await page.screenshot({ path: "../../../../test-results/project-sidebar-search-expanded.png" });
    await searchInput.fill("Protocol");
    await userEvent.keyboard("{Escape}");

    expect(searchInput.query()).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(searchButton.element()));
    await expect.element(screen.getByRole("img", { name: "CodeAgent" })).toBeVisible();

    await searchButton.click();
    await expect.element(screen.getByRole("textbox", { name: "搜索任务" })).toHaveValue("");
    await screen.getByRole("button", { name: "外部搜索" }).click();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "搜索任务" }).element());
  });
});
