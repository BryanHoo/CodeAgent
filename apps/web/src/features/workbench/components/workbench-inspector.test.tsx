import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchInspector } from "./workbench-inspector.js";

const gitStatus = {
  staged: [
    {
      diff: "--- a/package.json\n+++ b/package.json\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "package.json",
    },
  ],
  unstaged: [
    {
      diff: "--- /dev/null\n+++ b/new-file.ts\n@@ -0,0 +1,1 @@\n+export {};",
      kind: "create" as const,
      path: "new-file.ts",
    },
  ],
};

describe("WorkbenchInspector", () => {
  it("separates current project staged and unstaged changes as diff triggers", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        onOpenFileDiff={() => undefined}
        projectName="CodeAgent"
        gitStatus={gitStatus}
      />,
    );

    expect(markup).toContain("2 个变更");
    expect(markup).toContain("未暂存");
    expect(markup).toContain("已暂存");
    expect(markup).toContain("package.json");
    expect(markup).toContain("new-file.ts");
    expect(markup).toContain('aria-label="打开 已暂存文件 package.json 的 Diff"');
    expect(markup).toContain('aria-label="打开 未暂存文件 new-file.ts 的 Diff"');
    expect(markup).toContain(
      'aria-label="Git 变更文件" class="min-h-0 overflow-y-auto px-2.5 pb-2.5"',
    );
    expect(markup).not.toContain(">提交变更</button>");
  });

  it("hides an empty Git change group", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        gitStatus={{ staged: gitStatus.staged, unstaged: [] }}
        onOpenFileDiff={() => undefined}
        projectName="CodeAgent"
      />,
    );

    expect(markup).toContain('aria-label="已暂存"');
    expect(markup).not.toContain('aria-label="未暂存"');
    expect(markup).not.toContain("暂无文件");
  });

  it("renders an explicit empty state without demo files", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector onOpenFileDiff={() => undefined} projectName="CodeAgent" />,
    );

    expect(markup).toContain("0 个变更");
    expect(markup).toContain("当前项目暂无未提交变更");
    expect(markup).not.toContain("workbench-shell.tsx");
  });

  it("lists every subagent in context and exposes output dialog triggers", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        onOpenFileDiff={() => undefined}
        onOpenSubagent={() => undefined}
        projectName="CodeAgent"
        subagents={[
          {
            model: "gpt-5.6-sol",
            nickname: "前端分析",
            reasoningEffort: "high",
            status: "running",
            taskId: "child-frontend",
          },
          {
            nickname: "协议检查",
            status: "completed",
            taskId: "child-protocol",
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="子代理"');
    expect(markup).toContain("2 个子代理");
    expect(markup).toContain("前端分析");
    expect(markup).toContain("协议检查");
    expect(markup).not.toContain(">child-frontend<");
    expect(markup).not.toContain(">child-protocol<");
    expect(markup).not.toContain("检查前端实现");
    expect(markup).toContain("GPT-5.6-Sol · high");
    expect(markup).toContain('data-status="in_progress"');
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-label="查看子代理 前端分析 的输出"');
  });
});
