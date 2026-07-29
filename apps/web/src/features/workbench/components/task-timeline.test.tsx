import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskSnapshotTimeline, TaskTimeline } from "./task-timeline.js";

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
  it("renders the empty chat project selector without an intermediate button", () => {
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
    expect(markup).toContain("underline-offset-4");
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
    expect(markup).toContain("gap-6");
    expect(markup).toContain("space-y-4");
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

  it("renders user image attachments as viewable previews", () => {
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
                  mediaType: "image/png",
                  name: "diagram.png",
                  size: 68,
                },
              ],
              id: "message-user-image",
              role: "user",
              text: "",
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
      'href="/v1/projects/code-agent/tasks/task-1/attachments/history%2Fimage-1"',
    );
    expect(markup).toContain(
      'src="/v1/projects/code-agent/tasks/task-1/attachments/history%2Fimage-1"',
    );
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('width="144"');
    expect(markup).toContain('height="144"');
    expect(markup).not.toContain("data:image");
  });

  it("defers rendering work for long task histories with stable intrinsic turn sizes", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 51 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={longSnapshot} />);

    expect(markup.match(/content-visibility:auto/g)).toHaveLength(51);
    expect(markup.match(/contain-intrinsic-size:auto_300px/g)).toHaveLength(51);
  });

  it("renders a failed turn error after its partial assistant reply", () => {
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
    expect(markup).toContain("Turn 执行失败");
    expect(markup).toContain("上游服务暂时不可用");
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
    expect(markup).toContain('aria-label="AI 回复正在运行：pnpm test"');
    expect(markup).toContain("正在运行 pnpm test");
    expect(markup).not.toContain("输出已截断");
  });

  it("renders generic tool input and output in separate structured sections", () => {
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
    expect(markup).toContain(">参数<");
    expect(markup).toContain(">结果<");
    expect(markup).toContain("&quot;path&quot;: &quot;src/index.ts&quot;");
    expect(markup).toContain("&quot;lines&quot;: 1");
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
    expect(markup).toContain(">错误<");
    expect(markup).toContain("连接已中断");
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
