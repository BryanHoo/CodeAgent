import type { AgentItem } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { groupConsecutiveTimelineOperations } from "./task-timeline-operation-groups.js";

function groupItems(items: readonly AgentItem[]) {
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  return groupConsecutiveTimelineOperations(
    items.map((item) => item.id),
    (itemKey) => itemsById.get(itemKey),
  );
}

const webSearch: AgentItem = {
  id: "search-1",
  name: "web_search",
  status: "completed",
  type: "tool",
};
const command: AgentItem = {
  command: "curl https://api.github.com/repos/example/project",
  cwd: "/workspace",
  id: "command-1",
  outputOmitted: { bytes: 0, lines: 0 },
  status: "completed",
  type: "command",
};
const mcpTool: AgentItem = {
  id: "mcp-1",
  name: "mcp__docs__search",
  status: "completed",
  type: "tool",
};
const fileChange: AgentItem = {
  changes: [
    { diff: "+created", kind: "create", path: "src/created.ts" },
    { diff: "-before\n+after", kind: "update", path: "src/updated.ts" },
    { diff: "-deleted", kind: "delete", path: "src/deleted.ts" },
  ],
  id: "file-change-1",
  status: "completed",
  type: "file_change",
};

describe("groupConsecutiveTimelineOperations", () => {
  it("groups visually consecutive operations across hidden reasoning items", () => {
    const items: AgentItem[] = [
      webSearch,
      { content: "", id: "reasoning-1", summary: "", type: "reasoning" },
      command,
      { content: "raw reasoning", id: "reasoning-2", summary: "", type: "reasoning" },
      mcpTool,
      fileChange,
      { id: "assistant-1", role: "assistant", text: "继续分析", type: "message" },
    ];

    expect(groupItems(items)).toEqual([
      {
        itemKeys: ["search-1", "command-1", "mcp-1", "file-change-1"],
        key: "search-1",
        type: "operation_group",
      },
      { itemKey: "assistant-1", type: "item" },
    ]);
  });

  it("groups multiple file changes stored in one item", () => {
    expect(groupItems([fileChange])).toEqual([
      {
        itemKeys: ["file-change-1"],
        key: "file-change-1",
        type: "operation_group",
      },
    ]);
  });

  it("keeps visible reasoning as an operation group boundary", () => {
    const items: AgentItem[] = [
      webSearch,
      { content: "", id: "reasoning-visible", summary: "核对资料", type: "reasoning" },
      command,
    ];

    expect(groupItems(items)).toEqual([
      { itemKey: "search-1", type: "item" },
      { itemKey: "reasoning-visible", type: "item" },
      { itemKey: "command-1", type: "item" },
    ]);
  });
});
