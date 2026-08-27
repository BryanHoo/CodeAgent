import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanItem } from "@/components/ai-elements/plan";
import { Terminal, TerminalContent, TerminalHeader } from "@/components/ai-elements/terminal";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";

describe("agent AI Elements", () => {
  it("renders message, tool, terminal and plan semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Message,
        { from: "assistant" },
        createElement(MessageContent, null, "已完成"),
        createElement(
          Tool,
          { defaultOpen: true },
          createElement(ToolHeader, { state: "output-available", title: "读取文件" }),
          createElement(ToolContent, null, "src/app/App.tsx"),
        ),
        createElement(
          Terminal,
          null,
          createElement(TerminalHeader, { command: "pnpm check:web" }),
          createElement(TerminalContent, { output: "Done" }),
        ),
        createElement(
          Plan,
          { defaultOpen: true },
          createElement(PlanHeader, { title: "实现计划" }),
          createElement(
            PlanContent,
            null,
            createElement(PlanItem, { status: "completed" }, "迁移组件"),
          ),
        ),
      ),
    );

    expect(markup).toContain('data-ai-element="message"');
    expect(markup).toContain('data-ai-element="tool"');
    expect(markup).toContain('data-ai-element="terminal"');
    expect(markup).toContain('data-ai-element="plan"');
    expect(markup).toContain("pnpm check:web");
  });
});
