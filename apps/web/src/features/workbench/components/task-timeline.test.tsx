import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";

const completedTurn: RuntimeTaskSnapshot["turns"][number] = {
  completedAt: "2026-07-24T00:01:00.000Z",
  error: null,
  id: "turn-1",
  items: [
    {
      content: "",
      id: "reasoning-1",
      summary: "**Preparing implementation**\n**Preparing final build and test verification**",
      type: "reasoning",
    },
  ],
  startedAt: "2026-07-24T00:00:00.000Z",
  status: "completed",
};

const snapshot: RuntimeTaskSnapshot = {
  contextUsage: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "code-agent",
  status: "idle",
  title: "Markdown 渲染",
  turns: [completedTurn],
  updatedAt: "2026-07-24T00:01:00.000Z",
};

describe("TaskSnapshotTimeline", () => {
  it("renders copy controls, timestamps, and spacing for user and assistant messages", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-user-1",
              role: "user",
              text: "请检查消息工具栏。",
              type: "message",
            },
            {
              id: "message-assistant-1",
              role: "assistant",
              text: "消息工具栏已检查。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={messageSnapshot} />);

    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(2);
    expect(markup).toContain('dateTime="2026-07-24T00:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-24T00:01:00.000Z"');
    expect(markup).toContain("gap-6");
    expect(markup).toContain("space-y-4");
  });

  it("renders a completed reasoning item as a collapsed readable summary", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);

    expect(markup).toContain(">Preparing final build and test verification<");
    expect(markup).not.toContain("**Preparing final build and test verification**");
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(markup).toContain("Preparing implementation");
  });

  it("renders a reasoning status without an empty disclosure", () => {
    const singleStepSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              content: "**Preparing final build and test verification**",
              id: "reasoning-2",
              summary: "**Preparing final build and test verification**",
              type: "reasoning",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={singleStepSnapshot} />);

    expect(markup).toContain(">Preparing final build and test verification<");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("lucide-chevron-right");
  });

  it("renders each changed file with its operation and diff statistics", () => {
    const fileChangeSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              changes: [
                {
                  diff: "--- a/package.json\n+++ b/package.json\n@@ -1,2 +1,10 @@\n-old\n+new\n+next",
                  kind: "update",
                  path: "/workspace/package.json",
                },
                {
                  diff: "--- a/docs/runtime-lifecycle.md\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-# Runtime lifecycle\n-Details",
                  kind: "create",
                  path: "/workspace/docs/runtime-lifecycle.md",
                },
              ],
              id: "file-change-1",
              status: "completed",
              type: "file_change",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={fileChangeSnapshot} />);

    expect(markup).toContain("已编辑");
    expect(markup).toContain("package.json");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("打开 Diff");
    expect(markup).toContain('text-diff-added">+2</span>');
    expect(markup).toContain('text-diff-removed">-1</span>');
    expect(markup).toContain("已创建");
    expect(markup).toContain("runtime-lifecycle.md");
    expect(markup).toContain("已创建 runtime-lifecycle.md，新增 2 行，删除 0 行");
    expect(markup).toContain('text-diff-added">+2</span>');
    expect(markup).toContain('text-diff-removed">-0</span>');
    expect(markup).not.toContain(">文件变更<");
    expect(markup).not.toContain("@@ -1,2 +1,10 @@");
  });
});
