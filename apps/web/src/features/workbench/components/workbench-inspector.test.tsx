import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

const snapshot = {
  contextUsage: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "project-1",
  status: "idle",
  title: "Diff",
  turns: [
    {
      completedAt: "2026-07-24T00:01:00.000Z",
      error: null,
      id: "turn-1",
      items: [
        {
          changes: [
            {
              diff: "--- a/package.json\n+++ b/package.json\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
              kind: "update",
              path: "/workspace/package.json",
            },
          ],
          id: "change-1",
          status: "completed",
          type: "file_change",
        },
      ],
      startedAt: "2026-07-24T00:00:00.000Z",
      status: "completed",
    },
  ],
  updatedAt: "2026-07-24T00:01:00.000Z",
} satisfies RuntimeTaskSnapshot;

describe("WorkbenchInspector", () => {
  it("renders real task file changes as diff dialog triggers", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        onOpenFileDiff={() => undefined}
        projectName="CodeAgent"
        snapshot={snapshot}
      />,
    );

    expect(markup).toContain("1 个文件");
    expect(markup).toContain("package.json");
    expect(markup).toContain('aria-label="打开 package.json 的 Diff"');
    expect(markup).toContain('text-diff-added">+2</span>');
    expect(markup).toContain('text-diff-removed">-1</span>');
  });

  it("renders an explicit empty state without demo files", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector onOpenFileDiff={() => undefined} projectName="CodeAgent" />,
    );

    expect(markup).toContain("0 个文件");
    expect(markup).toContain("当前任务暂无文件变更");
    expect(markup).not.toContain("workbench-shell.tsx");
  });
});
