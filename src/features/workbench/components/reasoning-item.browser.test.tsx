import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import { TimelineItemContent } from "./task-timeline-items.js";

describe("reasoning summary tool", () => {
  it("shows a plain single-line title and expands the Markdown details", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <TimelineItemContent
        isLastTurnItem={false}
        item={{ id: "reason-1", text: "## **检查** [文件](https://example.com)\n\n详情内容", type: "reasoning" }}
        onOpenFileDiff={() => {}}
        onOpenSourceFile={() => {}}
        projectId="project-1"
        taskId="task-1"
        turnStatus="completed"
      />,
    );
    const title = screen.getByText("检查 文件");
    await expect.element(title).toBeVisible();
    expect(title.element().classList.contains("truncate")).toBe(true);
    expect(screen.getByText("详情内容").query()).toBeNull();
    await title.click();
    await expect.element(screen.getByText("详情内容")).toBeVisible();
  });
});
