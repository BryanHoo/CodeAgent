import { Buffer } from "node:buffer";

import { MAX_REALTIME_DIFF_BYTES, MAX_REALTIME_FILE_CHANGES } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import {
  CodexProtocolMappingError,
  mapCodexNotification,
  mapAgentTurn,
  mapAgentTurns,
  mapAgentModel,
  mapSandboxMode,
} from "./codex-protocol-mapping.js";

const mapNotification = (method: string, params: unknown) =>
  mapCodexNotification(
    method,
    params,
    () => undefined,
    () => undefined,
  );

describe("Codex protocol mapping", () => {
  it("removes repeated copied skill references when merging expanded skill history", () => {
    const turn = mapAgentTurn(
      {
        completedAt: 1_753_232_400,
        id: "turn-copied-skill",
        items: [
          {
            content: [
              {
                text: "$superwork:superwork-start $superwork:superwork-start 根据项目需求继续实现。",
                type: "text",
              },
            ],
            id: "user-copied-skill",
            type: "userMessage",
          },
          {
            content: [
              {
                text: [
                  "<skill>",
                  "<name>superwork:superwork-start</name>",
                  "<path>/Users/test/.codex/skills/superwork-start/SKILL.md</path>",
                  "执行 Superwork 流程。",
                  "</skill>",
                ].join("\n"),
                type: "text",
              },
            ],
            id: "expanded-copied-skill",
            type: "userMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      },
      () => undefined,
      () => undefined,
    );

    expect(turn.items).toContainEqual({
      id: "user-copied-skill",
      role: "user",
      skills: [{ name: "superwork:superwork-start" }],
      text: "根据项目需求继续实现。",
      type: "message",
    });
  });

  it("maps streaming plan, tool, file, and reasoning notifications", () => {
    expect(
      mapNotification("item/plan/delta", {
        delta: "## 计划",
        itemId: "plan-1",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({ itemId: "plan-1", payload: { delta: "## 计划" }, type: "plan.delta" });
    expect(
      mapNotification("item/mcpToolCall/progress", {
        itemId: "mcp-1",
        message: "正在读取资源",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({ payload: { message: "正在读取资源" }, type: "tool.progress" });
    expect(
      mapNotification("item/fileChange/patchUpdated", {
        changes: [{ diff: "+const ready = true;", kind: { type: "update" }, path: "src/app.ts" }],
        itemId: "patch-1",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: {
        changes: [{ diff: "+const ready = true;", kind: "update", path: "src/app.ts" }],
        originalByteLength: 20,
        truncated: false,
      },
      type: "file_change.updated",
    });
    expect(
      mapNotification("turn/diff/updated", {
        diff: "diff --git a/src/app.ts b/src/app.ts",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: { originalByteLength: 36, truncated: false },
      type: "turn.diff_updated",
    });
    expect(
      mapNotification("item/reasoning/summaryPartAdded", {
        itemId: "reasoning-1",
        summaryIndex: 2,
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: { delta: "", field: "summary", sectionIndex: 2 },
      type: "reasoning.delta",
    });
  });

  it("bounds realtime file patches by aggregate UTF-8 bytes and change count", () => {
    const leadingDiff = "a".repeat(MAX_REALTIME_DIFF_BYTES - 1);
    const nativeChanges = [
      { diff: leadingDiff, kind: { type: "update" }, path: "src/first.ts" },
      { diff: "汉字", kind: { type: "add" }, path: "src/second.ts" },
      ...Array.from({ length: MAX_REALTIME_FILE_CHANGES - 1 }, (_, index) => ({
        diff: "+x",
        kind: { type: "update" },
        path: `src/extra-${String(index)}.ts`,
      })),
    ];

    const event = mapNotification("item/fileChange/patchUpdated", {
      changes: nativeChanges,
      itemId: "patch-large",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(event?.type).toBe("file_change.updated");
    if (event?.type !== "file_change.updated") return;
    expect(event.payload.changes).toHaveLength(MAX_REALTIME_FILE_CHANGES);
    expect(event.payload.changes[1]?.diff).toBe("");
    expect(
      event.payload.changes.reduce(
        (bytes, change) => bytes + Buffer.byteLength(change.diff, "utf8"),
        0,
      ),
    ).toBe(MAX_REALTIME_DIFF_BYTES);
    expect(event.payload).toMatchObject({
      originalByteLength: nativeChanges.reduce(
        (bytes, change) => bytes + Buffer.byteLength(change.diff, "utf8"),
        0,
      ),
      truncated: true,
    });
  });

  it("truncates turn diffs on a valid UTF-8 boundary", () => {
    const diff = "汉".repeat(Math.ceil((MAX_REALTIME_DIFF_BYTES + 1) / 3));
    const surrogateDiff = `${"a".repeat(MAX_REALTIME_DIFF_BYTES - 1)}😀`;

    const event = mapNotification("turn/diff/updated", {
      diff,
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(event?.type).toBe("turn.diff_updated");
    if (event?.type !== "turn.diff_updated") return;
    expect(Buffer.byteLength(event.payload.diff, "utf8")).toBeLessThanOrEqual(
      MAX_REALTIME_DIFF_BYTES,
    );
    expect(event.payload.diff).not.toContain("�");
    expect(event.payload).toMatchObject({
      originalByteLength: Buffer.byteLength(diff, "utf8"),
      truncated: true,
    });

    const surrogateEvent = mapNotification("turn/diff/updated", {
      diff: surrogateDiff,
      threadId: "task-1",
      turnId: "turn-1",
    });
    expect(surrogateEvent?.type).toBe("turn.diff_updated");
    if (surrogateEvent?.type !== "turn.diff_updated") return;
    expect(Buffer.byteLength(surrogateEvent.payload.diff, "utf8")).toBe(
      MAX_REALTIME_DIFF_BYTES - 1,
    );
    expect(surrogateEvent.payload.diff).not.toContain("�");
    expect(surrogateEvent.payload).toMatchObject({
      originalByteLength: Buffer.byteLength(surrogateDiff, "utf8"),
      truncated: true,
    });
  });

  it("maps hooks, model status, warnings, and structured errors", () => {
    expect(
      mapNotification("hook/started", {
        run: {
          eventName: "afterToolUse",
          id: "hook-1",
          status: "running",
        },
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      itemId: "hook-hook-1",
      payload: { item: { eventName: "afterToolUse", kind: "hook", status: "running" } },
      type: "item.started",
    });
    expect(
      mapNotification("hook/completed", {
        run: {
          eventName: "sessionStart",
          id: "hook-thread",
          status: "completed",
          statusMessage: "Thread Hook 已完成",
        },
        threadId: "task-1",
        turnId: null,
      }),
    ).toMatchObject({
      payload: { code: "hook_status", level: "info", message: "Thread Hook 已完成" },
      type: "task.notice",
    });
    expect(
      mapNotification("warning", {
        message: "Process warning",
        threadId: null,
      }),
    ).toBeUndefined();
    expect(
      mapNotification("model/safetyBuffering/updated", {
        fasterModel: "gpt-mini",
        model: "gpt-main",
        reasons: [],
        showBufferingUi: true,
        threadId: "task-1",
        turnId: "turn-1",
        useCases: [],
      }),
    ).toMatchObject({
      payload: { item: { kind: "safety_buffering", status: "running" } },
      type: "item.started",
    });
    expect(
      mapNotification("model/rerouted", {
        fromModel: "gpt-main",
        reason: "highRiskCyberActivity",
        threadId: "task-1",
        toModel: "gpt-safe",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: { item: { fromModel: "gpt-main", kind: "model_rerouted", toModel: "gpt-safe" } },
      type: "item.completed",
    });
    expect(
      mapNotification("warning", { message: "配置即将失效", threadId: "task-1" }),
    ).toMatchObject({
      payload: { code: "runtime_warning", level: "warning" },
      type: "task.notice",
    });
    expect(
      mapNotification("error", {
        error: {
          additionalDetails: null,
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
          message: "连接中断",
        },
        threadId: "task-1",
        turnId: "turn-1",
        willRetry: true,
      }),
    ).toMatchObject({
      payload: { code: "connection_failed", httpStatusCode: 502, willRetry: true },
      type: "provider.error",
    });
  });

  it("maps supported sandbox modes and rejects unknown values", () => {
    expect(mapSandboxMode("read-only")).toBe("read-only");
    expect(mapSandboxMode("workspace-write")).toBe("workspace-write");
    expect(mapSandboxMode("danger-full-access")).toBe("danger-full-access");
    expect(() => mapSandboxMode("legacy-mode")).toThrow(CodexProtocolMappingError);
  });

  it("filters hidden models while preserving the supported effort catalog", () => {
    expect(
      mapAgentModel({
        defaultReasoningEffort: "high",
        description: "Test model",
        displayName: "GPT Test",
        hidden: false,
        isDefault: true,
        model: "gpt-test",
        supportedReasoningEfforts: [{ description: "Deep reasoning", reasoningEffort: "high" }],
      }),
    ).toMatchObject({
      defaultReasoningEffort: "high",
      displayName: "GPT Test",
      id: "gpt-test",
      isDefault: true,
    });
    expect(mapAgentModel({ hidden: true })).toBeUndefined();
  });

  it("preserves documented agent message phases and omits a null legacy phase", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "message-phase-turn",
        items: [
          {
            id: "commentary-message",
            phase: "commentary",
            text: "正在检查。",
            type: "agentMessage",
          },
          {
            id: "final-message",
            phase: "final_answer",
            text: "检查完成。",
            type: "agentMessage",
          },
          {
            id: "legacy-message",
            phase: null,
            text: "旧版消息。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      }).items,
    ).toEqual([
      {
        id: "commentary-message",
        phase: "commentary",
        role: "assistant",
        text: "正在检查。",
        type: "message",
      },
      {
        id: "final-message",
        phase: "final_answer",
        role: "assistant",
        text: "检查完成。",
        type: "message",
      },
      {
        id: "legacy-message",
        role: "assistant",
        text: "旧版消息。",
        type: "message",
      },
    ]);
  });

  it("projects a completed Codex review to one request and one authoritative result", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "review-turn",
        items: [
          {
            content: [
              {
                text: "Review the current code changes (staged, unstaged, and untracked files).",
                type: "text",
              },
            ],
            id: "review-prompt",
            type: "userMessage",
          },
          {
            aggregatedOutput: "diff --git a/a.ts b/a.ts",
            command: "git diff",
            cwd: "/workspace",
            exitCode: 0,
            id: "review-command",
            status: "completed",
            type: "commandExecution",
          },
          {
            id: "review-result",
            review: "- [P1] 修复消息顺序。",
            type: "exitedReviewMode",
          },
          {
            id: "review-agent-result",
            phase: "final_answer",
            text: "- [P1] 修复消息顺序。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      }),
    ).toMatchObject({
      items: [
        { id: "review-mode-review-turn", type: "review" },
        {
          id: "review-result",
          role: "assistant",
          text: "- [P1] 修复消息顺序。",
          type: "message",
        },
      ],
    });
  });

  it("uses one terminal agent message when an interrupted review has no review text", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "interrupted-review-turn",
        items: [
          { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
          {
            id: "review-commentary",
            phase: "commentary",
            text: "正在审查。",
            type: "agentMessage",
          },
          { id: "review-exit", review: null, type: "exitedReviewMode" },
          {
            id: "review-interrupted",
            phase: null,
            text: "Review was interrupted.",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "interrupted",
      }),
    ).toMatchObject({
      items: [
        { type: "review" },
        {
          id: "review-interrupted",
          role: "assistant",
          text: "Review was interrupted.",
          type: "message",
        },
      ],
      status: "interrupted",
    });
  });

  it("folds the persisted reviewer worker into one running review turn", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: null,
          error: null,
          id: "review-outer-turn",
          items: [{ id: "review-entered", review: "current changes", type: "enteredReviewMode" }],
          startedAt: null,
          status: "completed",
        },
        {
          completedAt: null,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt-1",
              type: "userMessage",
            },
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt-2",
              type: "userMessage",
            },
            {
              aggregatedOutput: "diff --git a/a.ts b/a.ts",
              command: "git diff",
              cwd: "/workspace",
              exitCode: 0,
              id: "review-command",
              status: "completed",
              type: "commandExecution",
            },
          ],
          startedAt: 1_753_228_800,
          status: "inProgress",
        },
      ]),
    ).toMatchObject([
      {
        completedAt: null,
        id: "review-outer-turn",
        items: [
          { id: "review-mode-review-outer-turn", type: "review" },
          { id: "review-command", type: "command" },
        ],
        startedAt: "2025-07-23T00:00:00.000Z",
        status: "running",
      },
    ]);
  });

  it("keeps only the worker interruption when both review turns terminate", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: 1_753_228_830,
          error: null,
          id: "review-outer-turn",
          items: [
            { id: "review-entered", review: "current changes", type: "enteredReviewMode" },
            {
              id: "review-failed",
              review: "Reviewer failed to output a response.",
              type: "exitedReviewMode",
            },
          ],
          startedAt: null,
          status: "interrupted",
        },
        {
          completedAt: null,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt",
              type: "userMessage",
            },
            {
              id: "review-interrupted",
              phase: null,
              text: "Review was interrupted. Please re-run /review and wait for it to complete.",
              type: "agentMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "interrupted",
        },
      ]),
    ).toMatchObject([
      {
        completedAt: "2025-07-23T00:00:30.000Z",
        id: "review-outer-turn",
        items: [
          { type: "review" },
          {
            text: "Review was interrupted. Please re-run /review and wait for it to complete.",
            type: "message",
          },
        ],
        status: "interrupted",
      },
    ]);
  });

  it("keeps a persisted review running until the outer turn exits review mode", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: null,
          error: null,
          id: "review-outer-turn",
          items: [{ id: "review-entered", review: "current changes", type: "enteredReviewMode" }],
          startedAt: null,
          status: "completed",
        },
        {
          completedAt: 1_753_228_810,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt",
              type: "userMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "completed",
        },
      ]),
    ).toMatchObject([
      {
        completedAt: null,
        id: "review-outer-turn",
        status: "running",
      },
    ]);
  });
});
