import type { AgentEvent, AgentItem } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useStore } from "zustand";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { i18n } from "../../../i18n/i18n.js";
import { createTaskStore, type TaskStore } from "../../conversation/runtime/task-store.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";

const reasoning: AgentItem = { id: "reasoning", type: "reasoning", summary: "", content: "" };
const noop = () => undefined;

function Timeline({ store }: { store: TaskStore }) {
  const itemKeys = useStore(store, (state) => state.itemKeysByTurnId["turn"]!);
  return (
    <StoredAssistantTimelineItems
      itemKeys={itemKeys}
      lastTurnItemKey={itemKeys.at(-1)}
      onOpenFileDiff={noop}
      onOpenSourceFile={noop}
      projectId="project"
      store={store}
      taskId="task"
      turnStatus="running"
    />
  );
}

describe("streaming reasoning timeline", () => {
  it("reveals the first summary and keeps all subsequent sections while preserving user expansion", async () => {
    await i18n.changeLanguage("zh-CN");
    const store = createTaskStore({ projectId: "project", taskId: "task" }, {
      checkpoint: { sequence: 0, sessionId: "session" },
      snapshot: {
        id: "task", projectId: "project", title: "Reasoning", status: "running",
        contextUsage: null, goal: null, plan: null, pinned: false, pendingRequests: [],
        settings: {
          approvalPolicy: "on-request", approvalsReviewer: "user", model: "gpt-5.6-sol",
          reasoningEffort: "high", sandboxMode: "workspace-write",
        },
        turns: [{ id: "turn", status: "running", items: [reasoning], error: null, startedAt: null, completedAt: null }],
        turnsNextCursor: null, updatedAt: "2026-09-09T00:00:00Z",
      },
    });
    let sequence = 0;
    const baseEvent = {
      provider: "codex", sessionId: "session", taskId: "task", turnId: "turn",
      itemId: "reasoning", timestamp: "2026-09-09T00:00:00Z", version: 2,
    } as const;
    const append = (delta: string, sectionIndex: number, field: "summary" | "content" = "summary") => {
      store.getState().applyEvents([{
        ...baseEvent, type: "reasoning.delta", payload: { delta, field, sectionIndex }, sequence: ++sequence,
      } satisfies AgentEvent]);
    };
    const screen = await render(<Timeline store={store} />);
    const initialKeys = store.getState().itemKeysByTurnId["turn"];
    append("raw content", 0, "content");
    append("", 0);
    append(" \n", 0);
    expect(store.getState().itemKeysByTurnId["turn"]).toBe(initialKeys);
    expect(screen.getByText("正在推理").query()).toBeNull();

    append("**Checking files**", 0);
    const trigger = screen.getByText("正在推理");
    await expect.element(trigger).toBeInTheDocument();
    // Vitest 的 WebKit 可见性判断仅识别 summary 本身，误判其内部 span 为隐藏。
    await expect.element(trigger.element().closest("summary")).toBeVisible();
    const details = trigger.element().closest("details")!;
    expect(details.open).toBe(false);
    await trigger.click();
    await expect.element(screen.getByText("Checking files")).toBeVisible();

    const visibleKeys = store.getState().itemKeysByTurnId["turn"];
    append("\n\nRead the complete source.", 0);
    append("", 1);
    append("**Checking tests**\n\n", 1);
    append("Keep every following word.", 1);
    await expect.element(screen.getByText("Keep every following word.")).toBeVisible();
    await expect.element(screen.getByText("Read the complete source.")).toBeVisible();
    expect(details.open).toBe(true);
    expect(store.getState().itemKeysByTurnId["turn"]).toBe(visibleKeys);

    // 完成事件是权威全文；替换后仍保留两段正文和用户展开状态。
    store.getState().applyEvents([{
      ...baseEvent, type: "item.completed", sequence: ++sequence,
      payload: { item: { ...reasoning, summary: "**Checking files**\n\nFinal first section.\n\n**Checking tests**\n\nFinal second section." } },
    } satisfies AgentEvent]);
    await expect.element(screen.getByText("Final first section.")).toBeVisible();
    await expect.element(screen.getByText("Final second section.")).toBeVisible();
    expect(details.open).toBe(true);
    expect(screen.getByText("raw content").query()).toBeNull();

    // 恢复到空摘要后，服务端可能直接发送完成全文而没有任何摘要 Delta。
    const snapshot = store.getState().reconstructSnapshot()!;
    store.getState().hydrate({
      checkpoint: { sequence, sessionId: "session" },
      snapshot: { ...snapshot, turns: snapshot.turns.map((turn) => ({ ...turn, items: [reasoning] })) },
    });
    await expect.element(trigger).not.toBeInTheDocument();
    store.getState().applyEvents([{
      ...baseEvent, type: "item.completed", sequence: ++sequence,
      payload: { item: { ...reasoning, summary: "Summary delivered only on completion." } },
    } satisfies AgentEvent]);
    await expect.element(trigger).toBeInTheDocument();
    await trigger.click();
    await expect.element(screen.getByText("Summary delivered only on completion.")).toBeVisible();
  });
});
