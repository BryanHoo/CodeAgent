import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../../../shared/ui/tooltip.js";
import {
  ComposerBranchSwitcher,
  ComposerModeTag,
  resolveQueuedPromptSummary,
} from "./workbench-composer-view.js";

describe("WorkbenchComposerView", () => {
  it("渲染可取消的计划模式标签", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerModeTag disabled={false} mode="plan" onRemove={() => undefined} />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-plan-mode=""');
    expect(markup).toContain('aria-label="取消计划模式"');
    expect(markup).toContain("计划");
  });

  it("渲染可取消的 Goal 模式标签", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerModeTag disabled={false} mode="goal" onRemove={() => undefined} />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-goal-mode=""');
    expect(markup).toContain('aria-label="取消目标模式"');
    expect(markup).toContain("目标");
    expect(markup).toContain("group-hover/composer-mode:opacity-100");
  });

  it("优先展示队列文本、Skill 和附件摘要", () => {
    const basePrompt = { files: [], id: "queue-1", skills: [] } as const;

    expect(resolveQueuedPromptSummary({ ...basePrompt, text: "继续修复" }, "1 个附件")).toBe(
      "继续修复",
    );
    expect(
      resolveQueuedPromptSummary(
        {
          ...basePrompt,
          skills: [
            {
              description: "检查代码",
              displayName: "Review",
              id: "review",
              name: "review",
              scope: "system",
            },
          ],
          text: "",
        },
        "1 个附件",
      ),
    ).toBe("$review");
    expect(resolveQueuedPromptSummary({ ...basePrompt, text: "" }, "1 个附件")).toBe("1 个附件");
  });

  it("将根仓库当前分支渲染为可访问的切换触发器", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerBranchSwitcher
          gitStatus={{
            baseBranches: ["origin/main", "main"],
            branch: "feat/review",
            branches: ["feat/review", "main"],
            repositoryMode: "root",
            snapshot: "a".repeat(64),
            staged: [],
            unstaged: [],
          }}
          onBranchChange={() => undefined}
          switchingBranch={undefined}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="切换分支，当前分支 feat/review"');
    expect(markup).toContain("feat/review");
  });

  it("聚合仓库模式只展示分支状态，不提供切换按钮", () => {
    const markup = renderToStaticMarkup(
      <ComposerBranchSwitcher
        gitStatus={{
          baseBranches: [],
          branch: null,
          branches: [],
          repositoryMode: "children",
          snapshot: "a".repeat(64),
          staged: [],
          unstaged: [],
        }}
        onBranchChange={() => undefined}
        switchingBranch={undefined}
      />,
    );

    expect(markup).toContain("未检出分支");
    expect(markup).not.toContain("<button");
  });
});
