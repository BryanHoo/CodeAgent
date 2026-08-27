import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/app/app-shell";

describe("AppShell", () => {
  it("renders the static three-pane coding workspace", () => {
    const markup = renderToStaticMarkup(createElement(AppShell));

    expect(markup).toContain('aria-label="任务导航"');
    expect(markup).toContain('aria-label="对话工作区"');
    expect(markup).toContain('aria-label="项目文件"');
    expect(markup).toContain('data-slot="prompt-input"');
    expect(markup).toContain("我们应该在 CodeAgent 中做些什么？");
    expect(markup).toContain("src-tauri");
  });

  it("keeps the workspace chrome visually minimal", () => {
    const markup = renderToStaticMarkup(createElement(AppShell));

    expect(markup).not.toContain("服务已连接");
    expect(markup).not.toContain(">在线<");
    expect(markup).not.toContain('aria-label="关闭项目面板"');
    expect(markup).toContain('data-size="compact"');
  });

  it("exposes independent controls for both workspace panels", () => {
    const markup = renderToStaticMarkup(createElement(AppShell));

    expect(markup).toContain('aria-label="收起任务导航"');
    expect(markup).toContain('aria-controls="task-sidebar"');
    expect(markup).toContain('aria-label="收起项目面板"');
    expect(markup).toContain('aria-controls="project-panel"');
  });
});
