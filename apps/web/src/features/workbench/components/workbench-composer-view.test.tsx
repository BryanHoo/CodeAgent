import { describe, expect, it } from "vitest";

import { resolveQueuedPromptSummary } from "./workbench-composer-view.js";

describe("WorkbenchComposerView", () => {
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
});
