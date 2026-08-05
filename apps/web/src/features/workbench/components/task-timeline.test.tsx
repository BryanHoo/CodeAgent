import type { ReactNode } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/ui/tooltip.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import {
  resolveMessageResponseRendering,
  TaskSnapshotTimeline,
  TaskTimeline,
} from "./task-timeline.js";

function renderToStaticMarkup(children: ReactNode) {
  return renderReactToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

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
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "idle",
  title: "Markdown 渲染",
  turns: [completedTurn],
  updatedAt: "2026-07-24T00:01:00.000Z",
};

describe("TaskTimeline", () => {
  it("renders automatic approval review results in the assistant timeline", () => {
    const approvalReviewSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              action: { detail: "/bin/zsh -lc pwd", type: "command" },
              id: "auto-approval-review-review-1",
              rationale: "The user explicitly requested this read-only command.",
              riskLevel: "low",
              status: "approved",
              targetItemId: "command-1",
              type: "approval_review",
              userAuthorization: "high",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={approvalReviewSnapshot} />);

    expect(markup).toContain("自动审批：已批准");
    expect(markup).toContain("/bin/zsh -lc pwd");
    expect(markup).toContain("风险：低");
    expect(markup).toContain("用户授权：高");
    expect(markup).toContain("The user explicitly requested this read-only command.");
  });

  it("localizes the running state in English", async () => {
    await changeAppLanguage("en");
    try {
      const markup = renderToStaticMarkup(
        <TaskTimeline
          onProjectChange={() => undefined}
          projectId="项目-alpha"
          projects={[
            {
              createdAt: "2026-07-22T06:00:00.000Z",
              id: "项目-alpha",
              name: "项目-alpha",
              rootPath: "/workspace/项目-alpha",
            },
          ]}
          submissionStartedAt="2026-07-24T00:00:00.000Z"
        />,
      );

      expect(markup).toContain("Running");
      expect(markup).toContain('aria-label="AI response is running"');
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("keeps user and AI content unchanged when the interface is English", async () => {
    await changeAppLanguage("en");
    try {
      const contentSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        settings: { ...snapshot.settings, model: "gpt-5.6-codex" },
        turns: [
          {
            ...completedTurn,
            items: [
              {
                id: "message-user-raw",
                role: "user",
                text: "请保留中文输入与 Codex 专有名词",
                type: "message",
              },
              {
                id: "message-assistant-raw",
                role: "assistant",
                text: "已保留原始 AI 输出：Reasoning effort",
                type: "message",
              },
            ],
          },
        ],
      };

      const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={contentSnapshot} />);

      expect(markup).toContain("请保留中文输入与 Codex 专有名词");
      expect(markup).toContain("已保留原始 AI 输出：Reasoning effort");
      expect(markup).toContain("Copy message");
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("uses streaming Markdown only for the active assistant tail item", () => {
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "assistant",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: true, mode: "streaming" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: false,
        role: "assistant",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "user",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "assistant",
        turnStatus: "completed",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
  });

  it("shows the running shimmer while a new chat submission is pending", () => {
    const markup = renderToStaticMarkup(
      <TaskTimeline
        onProjectChange={() => undefined}
        projectId="code-agent"
        projects={[
          {
            createdAt: "2026-07-22T06:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            rootPath: "/workspace/CodeAgent",
          },
        ]}
        submissionStartedAt="2026-07-24T00:00:00.000Z"
      />,
    );

    expect(markup).toContain('data-ai-shimmer=""');
    expect(markup).toContain('aria-label="AI 回复正在运行"');
    expect(markup).toContain("正在运行");
  });

  it("keeps the local submission timer until the confirmed Turn produces assistant output", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:01:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          ...snapshot.turns,
          {
            completedAt: null,
            error: null,
            id: "turn-confirmed-without-output",
            items: [
              {
                id: "submitted-user-turn-confirmed-without-output",
                role: "user",
                text: "继续排查白屏",
                type: "message",
              },
            ],
            startedAt: "2026-07-24T00:00:00.000Z",
            status: "running",
          },
        ],
      };
      const store = createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 1, sessionId: "runtime-1" },
          snapshot: runningSnapshot,
        },
      );
      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={snapshot.projectId}
          runtime={{
            connectionState: "connected",
            error: null,
            isPending: false,
            snapshot: runningSnapshot,
            store,
          }}
          submissionStartedAt="2026-07-24T00:01:00.000Z"
          submissionTurnId="turn-confirmed-without-output"
          taskId={snapshot.id}
        />,
      );

      expect(markup).toContain("5s");
      expect(markup).not.toContain("1m 5s");
      expect(markup.match(/aria-label="AI 回复正在运行"/gu)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the timer to the Turn after its first assistant item arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:01:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-with-output",
            items: [
              {
                id: "submitted-user-turn-with-output",
                role: "user",
                text: "继续排查白屏",
                type: "message",
              },
              {
                id: "assistant-turn-with-output",
                role: "assistant",
                text: "正在检查",
                type: "message",
              },
            ],
            startedAt: "2026-07-24T00:00:00.000Z",
            status: "running",
          },
        ],
      };
      const store = createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 2, sessionId: "runtime-1" },
          snapshot: runningSnapshot,
        },
      );
      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={snapshot.projectId}
          runtime={{
            connectionState: "connected",
            error: null,
            isPending: false,
            snapshot: runningSnapshot,
            store,
          }}
          submissionStartedAt="2026-07-24T00:01:00.000Z"
          submissionTurnId="turn-with-output"
          taskId={snapshot.id}
        />,
      );

      expect(markup).toContain("1m 5s");
      expect(markup).not.toContain('dateTime="PT5S"');
      expect(markup.match(/aria-label="AI 回复正在运行"/gu)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the official-style empty chat prompt around the project selector", () => {
    const markup = renderToStaticMarkup(
      <TaskTimeline
        onProjectChange={() => undefined}
        projectId="code-agent"
        projects={[
          {
            createdAt: "2026-07-22T06:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            rootPath: "/workspace/CodeAgent",
          },
          {
            createdAt: "2026-07-22T06:30:00.000Z",
            id: "superwork",
            name: "superwork",
            rootPath: "/workspace/superwork",
          },
        ]}
      />,
    );

    expect(markup).toContain('<select aria-label="选择新聊天项目"');
    expect(markup).toContain(">CodeAgent<");
    expect(markup).toContain("我们应该在");
    expect(markup).toContain("中做些什么？");
    expect(markup).toContain("lucide-message-square-code");
    expect(markup).toContain("size-12");
    expect(markup).toContain("text-xl");
    expect(markup).toContain("mt-5");
    expect(markup).toContain("flex-wrap");
    expect(markup).toContain("items-center");
    expect(markup).toContain("justify-center");
    expect(markup).toContain("underline-offset-4");
    expect(markup).not.toContain("align-middle");
    expect(markup).not.toContain("选择一个任务查看历史。");
    expect(markup).not.toContain("lucide-folder-git-2");
    expect(markup).not.toContain("lucide-cloud");
    expect(markup).not.toContain("lucide-chevron-right");
    expect(markup).not.toContain("lucide-minus");
    expect(markup).not.toContain("size-20");
    expect(markup).not.toContain("text-3xl");
    expect(markup).not.toContain("text-4xl");
    expect(markup).not.toContain("lucide-chevron-down");
    expect(markup).not.toContain('aria-label="切换新聊天项目，当前 CodeAgent"');
  });

  it("renders live item content from the normalized store instead of a stale root snapshot", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "message-running",
              role: "assistant",
              text: "开始并继续",
              type: "message",
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running",
        },
      ],
    };
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-1" },
        snapshot: runningSnapshot,
      },
    );
    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={snapshot.projectId}
        runtime={{
          connectionState: "connected",
          error: null,
          isPending: false,
          snapshot: { ...runningSnapshot, turns: [] },
          store,
        }}
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("开始并继续");
  });

  it("normalizes the starting snapshot through the bounded task store", () => {
    const startingSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      pendingRequests: Array.from({ length: 21 }, (_, index) => ({
        availableDecisions: ["allow", "deny"] as const,
        createdAt: `2026-07-24T00:01:${String(index).padStart(2, "0")}.000Z`,
        expiresAt: null,
        grantRoot: `/workspace/expired-${String(index + 1)}`,
        itemId: `file-change-${String(index + 1)}`,
        projectId: snapshot.projectId,
        reason: null,
        requestId: `number:expired-${String(index + 1)}`,
        status: "expired" as const,
        taskId: snapshot.id,
        turnId: completedTurn.id,
        type: "file_change_approval" as const,
      })),
    };

    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={startingSnapshot.projectId}
        runtime={{
          connectionState: "connecting",
          error: null,
          isPending: true,
          snapshot: undefined,
          store: undefined,
        }}
        startingSnapshot={startingSnapshot}
        taskId={startingSnapshot.id}
      />,
    );

    expect(markup).not.toContain('data-approval-id="number:expired-1"');
    expect(markup).toContain('data-approval-id="number:expired-21"');
  });

  it("virtualizes Turn sections from the normalized store", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 100 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };
    const store = createTaskStore(
      { projectId: longSnapshot.projectId, taskId: longSnapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-long-history" },
        snapshot: longSnapshot,
      },
    );
    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={longSnapshot.projectId}
        runtime={{
          connectionState: "connected",
          error: null,
          isPending: false,
          snapshot: longSnapshot,
          store,
        }}
        taskId={longSnapshot.id}
      />,
    );

    expect(markup).toContain('aria-label="Turn 1"');
    expect(markup).not.toContain('aria-label="Turn 100"');
  });

  it("does not offer rollback for a failed latest turn in the normalized store", () => {
    const failedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "failed",
      turns: [
        {
          ...completedTurn,
          error: "执行失败",
          items: [
            {
              changes: [{ diff: "+失败前的修改", kind: "update", path: "/workspace/file.ts" }],
              id: "failed-change",
              status: "completed",
              type: "file_change",
            },
          ],
          status: "failed",
        },
      ],
    };
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-1" },
        snapshot: failedSnapshot,
      },
    );

    const markup = renderToStaticMarkup(
      <TaskTimeline
        canRollbackTurns
        projectId={snapshot.projectId}
        runtime={{
          connectionState: "connected",
          error: null,
          isPending: false,
          snapshot: failedSnapshot,
          store,
        }}
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("执行失败");
    expect(markup).not.toContain(">撤销<");
  });
});

describe("TaskSnapshotTimeline", () => {
  it("virtualizes Turn sections from a long snapshot", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 100 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={longSnapshot} />);

    expect(markup).toContain('aria-label="Turn 1"');
    expect(markup).not.toContain('aria-label="Turn 100"');
  });

  it("removes resolved approvals while keeping pending approvals visible", () => {
    const approvalSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      pendingRequests: [
        {
          availableDecisions: ["allow", "deny"],
          createdAt: "2026-07-24T00:01:01.000Z",
          expiresAt: null,
          grantRoot: "/workspace/resolved-change",
          itemId: "file-change-resolved",
          projectId: "code-agent",
          reason: null,
          requestId: "number:resolved",
          status: "resolved",
          taskId: "task-1",
          turnId: "turn-1",
          type: "file_change_approval",
        },
        {
          availableDecisions: ["allow", "deny"],
          createdAt: "2026-07-24T00:01:02.000Z",
          expiresAt: null,
          grantRoot: "/workspace/pending-change",
          itemId: "file-change-pending",
          projectId: "code-agent",
          reason: null,
          requestId: "number:pending",
          status: "pending",
          taskId: "task-1",
          turnId: "turn-1",
          type: "file_change_approval",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={approvalSnapshot} />);

    expect(markup).not.toContain("/workspace/resolved-change");
    expect(markup).not.toContain("请求已处理");
    expect(markup).toContain("/workspace/pending-change");
  });

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
    expect(markup).toContain("space-y-4");
  });

  it("keeps the completed AI processing duration visible", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          completedAt: "2026-07-24T00:05:07.000Z",
          items: [
            {
              id: "message-assistant-duration",
              role: "assistant",
              text: "回复完成。",
              type: "message",
            },
          ],
        },
      ],
      updatedAt: "2026-07-24T00:05:07.000Z",
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={messageSnapshot} />);

    expect(markup).toContain('data-turn-processing-time=""');
    expect(markup).toContain("已处理");
    expect(markup).toContain('dateTime="PT5M7S"');
    expect(markup).toContain(">5m 7s</time>");
  });

  it("derives the running AI processing duration from the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:02:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          {
            ...completedTurn,
            completedAt: null,
            items: [
              {
                id: "message-assistant-running-duration",
                role: "assistant",
                text: "正在回复。",
                type: "message",
              },
            ],
            status: "running",
          },
        ],
        updatedAt: "2026-07-24T00:02:05.000Z",
      };

      const store = createTaskStore(
        { projectId: runningSnapshot.projectId, taskId: runningSnapshot.id },
        {
          checkpoint: { sequence: 1, sessionId: "runtime-duration" },
          snapshot: runningSnapshot,
        },
      );
      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={runningSnapshot.projectId}
          runtime={{
            connectionState: "connected",
            error: null,
            isPending: false,
            snapshot: runningSnapshot,
            store,
          }}
          taskId={runningSnapshot.id}
        />,
      );

      expect(markup).toContain('data-turn-processing-time=""');
      expect(markup).toContain('dateTime="PT2M5S"');
      expect(markup).toContain(">2m 5s</time>");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers task copy only beside the latest completed AI reply", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          id: "turn-older",
          items: [
            {
              id: "message-assistant-older",
              role: "assistant",
              text: "较早的回复。",
              type: "message",
            },
          ],
        },
        {
          ...completedTurn,
          id: "turn-latest",
          items: [
            {
              id: "message-assistant-latest",
              role: "assistant",
              text: "最新的回复。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline onForkTask={() => Promise.resolve()} snapshot={messageSnapshot} />,
    );

    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="复制任务"/g)).toHaveLength(1);
    expect(markup.indexOf('aria-label="复制任务"')).toBeGreaterThan(markup.indexOf("最新的回复。"));
  });

  it("renders one fixed review request instead of native review prompts", () => {
    const reviewSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "review-mode-turn-1",
              target: { type: "uncommitted_changes" },
              type: "review",
            },
            {
              id: "review-command",
              command: "git diff",
              cwd: "/workspace/CodeAgent",
              outputTruncated: false,
              status: "running",
              type: "command",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={reviewSnapshot} />);

    expect(markup.match(/请检查我未提交的更改/g)).toHaveLength(1);
    expect(markup).toContain("审查模式");
    expect(markup).not.toContain("Review the current code changes");
    expect(markup.indexOf("请检查我未提交的更改")).toBeLessThan(markup.indexOf("git diff"));
  });

  it("renders user image attachments as standalone previews before the text bubble", () => {
    const imageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              attachments: [
                {
                  id: "history/image-1",
                  kind: "image",
                  mediaType: "image/png",
                  name: "diagram.png",
                  size: 68,
                },
              ],
              id: "message-user-image",
              role: "user",
              text: "阅读并理解项目",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={imageSnapshot} />);

    expect(markup).toContain('aria-label="消息附件"');
    expect(markup).toContain('aria-label="查看图片 diagram.png"');
    expect(markup).toContain(
      'src="/v1/projects/code-agent/tasks/task-1/attachments/history%2Fimage-1"',
    );
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('data-message-attachment="image"');
    expect(markup).toContain('data-message-text="true"');
    expect(markup).toContain('width="160"');
    expect(markup).toContain('height="160"');
    expect(markup.indexOf('aria-label="消息附件"')).toBeLessThan(
      markup.indexOf('data-message-text="true"'),
    );
    expect(markup.match(/diagram\.png/g)).toHaveLength(2);
    expect(markup).not.toContain("data:image");
    expect(markup).not.toContain('target="_blank"');
  });

  it("renders pasted text as a file attachment instead of a text bubble", () => {
    const pastedTextSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              attachments: [
                {
                  id: "history/pasted-text-1",
                  kind: "text",
                  mediaType: "text/plain",
                  name: "Pasted text.txt",
                  size: 1_001,
                },
              ],
              id: "message-user-pasted-text",
              role: "user",
              text: "",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={pastedTextSnapshot} />);

    expect(markup).toContain('data-message-attachment="text"');
    expect(markup).toContain('data-attachment-preview="file"');
    expect(markup).toContain("Pasted text.txt");
    expect(markup).toContain("1001 B");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain('data-message-text="true"');
  });

  it("removes the old content-visibility fallback after Turn virtualization", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 51 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={longSnapshot} />);

    expect(markup.match(/data-index=/g)?.length).toBeLessThan(longSnapshot.turns.length);
    expect(markup).not.toContain("content-visibility:auto");
    expect(markup).not.toContain("contain-intrinsic-size:auto_300px");
  });

  it("renders only the raw failed turn error after its partial assistant reply", () => {
    const failedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "failed",
      turns: [
        {
          ...completedTurn,
          error: "上游服务暂时不可用",
          items: [
            {
              id: "message-assistant-partial",
              role: "assistant",
              text: "已经完成部分分析。",
              type: "message",
            },
          ],
          status: "failed",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={failedSnapshot} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("上游服务暂时不可用");
    expect(markup).not.toContain("Turn 执行失败");
    expect(markup.indexOf("已经完成部分分析。")).toBeLessThan(markup.indexOf("上游服务暂时不可用"));
  });

  it("renders skills carried by historical user messages", () => {
    const skillMessageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-user-skill",
              role: "user",
              skills: [{ name: "review-security" }, { name: "documentation-writer" }],
              text: "检查认证边界。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={skillMessageSnapshot} />);

    expect(markup).toContain('data-message-skill="review-security"');
    expect(markup).toContain('data-message-skill="documentation-writer"');
    expect(markup).toContain('data-skill-token=""');
    expect(markup).toContain("$review-security");
    expect(markup).toContain("$documentation-writer");
    expect(markup.indexOf("$review-security")).toBeLessThan(
      markup.indexOf("$documentation-writer"),
    );
    expect(markup).toContain("检查认证边界。");
    expect(markup).not.toContain("SKILL.md");
  });

  it("hides reasoning while keeping normal assistant text in one completed response", () => {
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

    // 原生 Reasoning 不向用户暴露，普通回复仍按同一 Turn 合并展示。
    expect(markup.match(/data-role="assistant"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1);
    expect(markup.match(/dateTime="2026-07-24T00:01:00.000Z"/g)).toHaveLength(1);
    expect(markup).toContain("我先检查消息判定。");
    expect(markup).toContain("已修正消息判定。");
    expect(markup).not.toContain("核对消息分组");
    expect(markup).not.toContain("正在核对时间线的分组逻辑。");
    expect(markup).not.toContain("data-ai-chain-of-thought");
  });

  it("does not render assistant actions while its turn is still running", () => {
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

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline onForkTask={() => Promise.resolve()} snapshot={runningSnapshot} />,
    );

    expect(markup).toContain("正在处理。");
    expect(markup).not.toContain('aria-label="复制消息"');
    expect(markup).not.toContain('aria-label="复制任务"');
    expect(markup).toContain('data-turn-processing-time=""');
    expect(markup).toContain('data-ai-shimmer=""');
    expect(markup).toContain("正在运行");
    expect(markup.indexOf("正在处理。")).toBeLessThan(markup.indexOf("正在运行"));
  });

  it("shows the user message before the AI Elements running shimmer", () => {
    const waitingForAssistantSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "message-user-waiting",
              role: "user",
              text: "你好",
              type: "message",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={waitingForAssistantSnapshot} />,
    );

    expect(markup).toContain('data-ai-shimmer=""');
    expect(markup).toContain("正在运行");
    expect(markup.indexOf("你好")).toBeLessThan(markup.indexOf("正在运行"));
  });

  it("does not expose completed reasoning content", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);

    expect(markup).not.toContain("data-ai-chain-of-thought");
    expect(markup).not.toContain("Preparing final build and test verification");
    expect(markup).not.toContain("Preparing implementation");
    expect(markup).not.toContain("思考过程");
  });

  it("keeps tools and commands visible without wrapping them in Chain of Thought", () => {
    const continuousReasoningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              content: "",
              id: "reasoning-prepare",
              summary: "**准备检查项目**",
              type: "reasoning",
            },
            {
              id: "tool-read-project",
              input: { path: "package.json" },
              name: "read_file",
              output: "CodeAgent",
              status: "completed",
              type: "tool",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "command-check-project",
              output: "268 passed",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              content: "",
              id: "reasoning-finish",
              summary: "**整理项目结论**",
              type: "reasoning",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={continuousReasoningSnapshot} />,
    );

    expect(markup).not.toContain("data-ai-chain-of-thought");
    expect(markup).not.toContain("准备检查项目");
    expect(markup).not.toContain("整理项目结论");
    expect(markup).toContain("read_file");
    expect(markup).toContain("pnpm check");
    expect(markup.indexOf("read_file")).toBeLessThan(markup.indexOf("pnpm check"));
  });

  it("does not render an empty reasoning placeholder", () => {
    const emptyReasoningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [{ content: "", id: "reasoning-empty", summary: "", type: "reasoning" }],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={emptyReasoningSnapshot} />);

    expect(markup).not.toContain('data-ai-chain-of-thought=""');
    expect(markup).not.toContain(">推理<");
  });

  it("defers completed ANSI command output until the tool is opened", () => {
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
    expect(markup).not.toContain('data-terminal=""');
    expect(markup).not.toContain('aria-label="复制命令输出"');
    expect(markup).not.toContain("请检查日志");
    expect(markup).not.toContain("\u001B[31m");
    expect(markup).not.toContain("输出已截断，仅显示最新内容。");
  });

  it("keeps a running command collapsed while preserving its visible running status", () => {
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

    expect(markup).not.toMatch(/<details[^>]* open/u);
    expect(markup).not.toContain('data-terminal=""');
    expect(markup).not.toContain("/workspace/CodeAgent");
    expect(markup).toContain('aria-label="AI 回复正在运行：pnpm test"');
    expect(markup).toContain("正在运行 pnpm test");
  });

  it("keeps the latest completed operation visible while the turn continues", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              command: "sed -n '1,240p' SKILL.md",
              cwd: "/workspace/CodeAgent",
              id: "command-read-skill",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              content: "",
              id: "reasoning-after-command",
              summary: "",
              type: "reasoning",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).toContain('data-ai-shimmer=""');
    expect(markup).toContain('aria-label="AI 回复正在运行：sed -n &#x27;1,240p&#x27; SKILL.md"');
    expect(markup).toContain("正在运行 sed -n &#x27;1,240p&#x27; SKILL.md");
    expect(markup).not.toContain("已运行");
  });

  it("defers completed generic tool input and output until the tool is opened", () => {
    const toolSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "tool-read-file",
              input: { path: "src/index.ts" },
              name: "read_file",
              output: { content: "export {};", lines: 1 },
              status: "completed",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={toolSnapshot} />);

    expect(markup).toContain("read_file");
    expect(markup).toContain("已完成");
    expect(markup).not.toContain(">参数<");
    expect(markup).not.toContain(">结果<");
    expect(markup).not.toContain("&quot;path&quot;: &quot;src/index.ts&quot;");
    expect(markup).not.toContain("&quot;lines&quot;: 1");
  });

  it("maps declined and interrupted agent items to official tool terminal states", () => {
    const toolSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "tool-declined",
              name: "request_permission",
              status: "declined",
              type: "tool",
            },
            {
              id: "tool-interrupted",
              name: "background_task",
              output: "连接已中断",
              status: "interrupted",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={toolSnapshot} />);

    expect(markup).toContain("已拒绝");
    expect(markup).toContain("失败");
    expect(markup).not.toMatch(/<details[^>]* open/u);
    expect(markup).not.toContain(">错误<");
    expect(markup).not.toContain("连接已中断");
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

  it("keeps structured subagent calls as simple non-interactive timeline statuses", () => {
    const subagentSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "collaboration-spawn",
              input: {
                model: "gpt-5.6-sol",
                prompt: "理解前端项目",
                reasoningEffort: "high",
                receiverTaskIds: ["child-frontend"],
                senderTaskId: "task-1",
              },
              name: "agent/spawn",
              output: {
                agents: [
                  {
                    message: "前端由 React 工作台与类型安全 Client 组成。",
                    status: "completed",
                    taskId: "child-frontend",
                  },
                ],
              },
              status: "completed",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={subagentSnapshot} />);

    expect(markup.match(/data-ai-task=""/g)).toHaveLength(1);
    expect(markup).toContain("启动子代理");
    expect(markup).toContain("1 个子代理已完成");
    expect(markup).not.toContain("子代理 child-frontend");
    expect(markup).not.toContain("理解前端项目");
    expect(markup).not.toContain("GPT-5.6-Sol");
    expect(markup).not.toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('aria-label="打开子代理 child-frontend 的实时输出"');
    expect(markup).not.toContain("前端由 React 工作台与类型安全 Client 组成。");
    expect(markup).not.toContain("agent/spawn");
    expect(markup).not.toContain("receiverTaskIds");
    expect(markup).not.toContain('data-ai-tool=""');
  });

  it("renders each changed file with its operation and diff statistics", () => {
    const browserCrypto = globalThis.crypto;
    // 局域网 HTTP 页面保留 getRandomValues，但不会暴露仅限安全上下文的 randomUUID。
    vi.stubGlobal("crypto", {
      getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
    });
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

    let markup: string;
    try {
      markup = renderToStaticMarkup(
        <TaskSnapshotTimeline canRollbackTurns snapshot={fileChangeSnapshot} />,
      );
    } finally {
      vi.unstubAllGlobals();
    }

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
