import { describe, expect, it } from "vitest";

import {
  filterPromptCommandItems,
  getPromptCommandAvailability,
  movePromptCommandSelection,
  promptCommandItems,
  resolvePromptSlashCommand,
} from "./prompt-command.js";

const commandItems = [
  {
    action: "initialize",
    description: "创建包含 Codex 说明的 AGENTS.md 文件",
    id: "initialize",
    keywords: ["init", "初始化"],
    label: "初始化",
  },
  {
    action: "review",
    description: "审查未暂存的更改，或与某个分支进行比较",
    id: "review-code",
    keywords: ["review", "审查"],
    label: "代码审查",
  },
] as const;

function findCommand(action: (typeof promptCommandItems)[number]["action"]) {
  const command = promptCommandItems.find((item) => item.action === action);
  if (command === undefined) {
    throw new Error(`Missing prompt command: ${action}`);
  }
  return command;
}

describe("prompt slash command", () => {
  it("only resolves an unfinished command token at the start of the draft", () => {
    expect(resolvePromptSlashCommand("/", 1)).toEqual({ end: 1, query: "", start: 0 });
    expect(resolvePromptSlashCommand("/项目", 3)).toEqual({ end: 3, query: "项目", start: 0 });
    expect(resolvePromptSlashCommand(" /项目", 4)).toBeNull();
    expect(resolvePromptSlashCommand("说明 /项目", 6)).toBeNull();
    expect(resolvePromptSlashCommand("/项目 后续说明", 7)).toBeNull();
    expect(resolvePromptSlashCommand("/项目", 1)).toBeNull();
  });

  it("filters commands by labels and localized keywords", () => {
    expect(filterPromptCommandItems(commandItems, "初始化")).toEqual([commandItems[0]]);
    expect(filterPromptCommandItems(commandItems, "review")).toEqual([commandItems[1]]);
    expect(filterPromptCommandItems(commandItems, "missing")).toEqual([]);
  });

  it("wraps keyboard selection while keeping empty lists stable", () => {
    expect(movePromptCommandSelection(0, 1, 2)).toBe(1);
    expect(movePromptCommandSelection(1, 1, 2)).toBe(0);
    expect(movePromptCommandSelection(0, -1, 2)).toBe(1);
    expect(movePromptCommandSelection(4, 1, 0)).toBe(0);
  });

  it("lists the official task commands with descriptions", () => {
    expect(promptCommandItems.map((item) => item.label)).toEqual([
      "代码审查",
      "初始化",
      "副任务",
      "压缩",
      "反馈",
      "在新任务中继续",
    ]);
    expect(promptCommandItems.every((item) => item.description.length > 0)).toBe(true);
  });

  it("derives task command availability from task context and capabilities", () => {
    const capabilities = {
      feedback: { upload: true },
      provider: "codex",
      tasks: { fork: true, list: true, read: true, start: true },
      turns: { compact: true, interrupt: true, review: true, rollback: true, start: true },
    };
    const review = findCommand("review");
    const initialize = findCommand("initialize");

    expect(getPromptCommandAvailability(review, capabilities, true)).toEqual({
      available: true,
    });
    expect(getPromptCommandAvailability(review, capabilities, false)).toEqual({
      available: false,
      reason: "需要先打开一个任务",
    });
    expect(getPromptCommandAvailability(initialize, capabilities, false)).toEqual({
      available: true,
    });
    expect(
      getPromptCommandAvailability(
        review,
        { ...capabilities, turns: { ...capabilities.turns, review: false } },
        true,
      ),
    ).toEqual({ available: false, reason: "当前运行时不支持此命令" });
  });
});
