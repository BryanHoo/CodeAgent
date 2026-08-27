import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/app/app-shell";

describe("AppShell", () => {
  it("renders the Codexly workbench structure with CodeAgent branding", () => {
    const markup = renderToStaticMarkup(createElement(AppShell));

    expect(markup).toContain('aria-label="任务导航"');
    expect(markup).toContain('aria-label="对话工作区"');
    expect(markup).toContain('aria-label="工作台检查器"');
    expect(markup).toContain('data-slot="prompt-input"');
    expect(markup).toContain("CodeAgent");
    expect(markup).toContain("上下文");
    expect(markup).toContain("更改");
    expect(markup).toContain('aria-label="CodeAgent 文件树"');
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
    expect(markup).toContain('aria-label="收起检查器"');
    expect(markup).toContain('aria-controls="workbench-inspector"');
  });
});
