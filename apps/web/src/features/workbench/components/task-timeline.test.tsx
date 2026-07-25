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

  it("keeps reasoning and assistant text in one response with one completed footer", () => {
    const multiItemResponseSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-assistant-progress",
              role: "assistant",
              text: "我先检查消息判定。",
              type: "message",
            },
            {
              content: "正在核对时间线的分组逻辑。",
              id: "reasoning-between-messages",
              summary: "**核对消息分组**",
              type: "reasoning",
            },
            {
              id: "message-assistant-final",
              role: "assistant",
              text: "已修正消息判定。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={multiItemResponseSnapshot} />,
    );

    // 同一 Turn 内的思考与文本属于一次 AI 回复，不应按 Agent Item 拆成多条消息。
    expect(markup.match(/data-role="assistant"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1);
    expect(markup.match(/dateTime="2026-07-24T00:01:00.000Z"/g)).toHaveLength(1);
  });

  it("does not render an assistant footer while its turn is still running", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "message-assistant-progress",
              role: "assistant",
              text: "正在处理。",
              type: "message",
            },
            {
              content: "",
              id: "reasoning-active",
              summary: "**继续思考**",
              type: "reasoning",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).toContain("正在处理。");
    expect(markup).not.toContain('aria-label="复制消息"');
    expect(markup).not.toContain("<time");
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

  it("renders completed ANSI command output in a copyable Terminal", () => {
    const ansiOutput = "\u001B[31m失败\u001B[0m\n请检查日志";
    const commandSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "command-completed",
              output: ansiOutput,
              outputTruncated: true,
              status: "completed",
              type: "command",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={commandSnapshot} />);

    expect(markup).toContain("pnpm check");
    expect(markup).toContain("已完成");
    expect(markup).toContain('data-terminal=""');
    expect(markup).toContain('data-streaming="false"');
    expect(markup).toContain('aria-label="复制命令输出"');
    expect(markup).toContain("失败");
    expect(markup).not.toContain("\u001B[31m");
    expect(markup).toContain("输出已截断，仅显示最新内容。");
    expect(markup).not.toContain("清空");
  });

  it("renders a running command as a streaming Terminal with its real cwd fallback", () => {
    const runningCommandSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              command: "pnpm test",
              cwd: "/workspace/CodeAgent",
              id: "command-running",
              outputTruncated: false,
              status: "running",
              type: "command",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningCommandSnapshot} />);

    expect(markup).toContain('data-terminal=""');
    expect(markup).toContain('data-streaming="true"');
    expect(markup).toContain('aria-label="正在接收命令输出"');
    expect(markup).toContain("/workspace/CodeAgent");
    expect(markup).not.toContain("输出已截断");
  });

  it("renders the active plan as a streaming, expanded Plan", () => {
    const planText = "1. 保留原始文本\n2. 接入 Plan 组件";
    const runningPlanSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [{ id: "plan-active", text: planText, type: "plan" }],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningPlanSnapshot} />);

    expect(markup).toContain('data-ai-plan=""');
    expect(markup).toContain('data-streaming="true"');
    expect(markup).toMatch(/<details[^>]* open/);
    expect(markup).toContain("正在生成计划");
    expect(markup).toContain(planText);
    expect(markup).not.toContain("lucide-wrench");
  });

  it("renders a completed plan as non-streaming collapsible content", () => {
    const planText = "# 实施计划\n\n- 保留 `Protocol`";
    const completedPlanSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [{ id: "plan-completed", text: planText, type: "plan" }],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={completedPlanSnapshot} />);

    expect(markup).toContain('data-ai-plan=""');
    expect(markup).toContain('data-streaming="false"');
    expect(markup).toContain("执行计划");
    expect(markup).toContain(planText);
    expect(markup).not.toContain("lucide-wrench");
  });

  it("renders activity items with compact and expandable AI Elements Tasks", () => {
    const activitySnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "activity-compact",
              label: "上下文压缩",
              status: "completed",
              type: "activity",
            },
            {
              detail: "/workspace/apps/web/src/App.tsx",
              id: "activity-detailed",
              label: "查看图片",
              status: "running",
              type: "activity",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={activitySnapshot} />);

    expect(markup.match(/data-ai-task=""/g)).toHaveLength(2);
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('data-status="in_progress"');
    expect(markup).toContain("上下文压缩");
    expect(markup).toContain("查看图片");
    expect(markup).toContain("/workspace/apps/web/src/App.tsx");
    expect(markup.match(/<details/g)).toHaveLength(1);
    expect(markup).not.toContain("lucide-wrench");
  });

  it("maps failed and pending activity statuses to AI Elements Task statuses", () => {
    const activitySnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "activity-failed",
              label: "进入审查",
              status: "failed",
              type: "activity",
            },
            {
              id: "activity-pending",
              label: "子任务活动",
              status: "pending",
              type: "activity",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={activitySnapshot} />);

    expect(markup).toContain('data-status="error"');
    expect(markup).toContain('data-status="pending"');
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

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline canRollbackTurns snapshot={fileChangeSnapshot} />,
    );

    expect(markup).toContain("已编辑 2 个文件");
    expect(markup).toContain('aria-label="本次修改了 2 个文件"');
    expect(markup).toContain(">撤销<");
    expect(markup).toContain(">审核<");
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
