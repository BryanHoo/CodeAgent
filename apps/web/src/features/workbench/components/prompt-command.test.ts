import { describe, expect, it } from "vitest";

import {
  filterPromptCommandItems,
  movePromptCommandSelection,
  resolvePromptSlashCommand,
} from "./prompt-command.js";

const commandItems = [
  { id: "select-project", keywords: ["project", "项目"], label: "选择项目" },
  { id: "review-code", keywords: ["review", "审查"], label: "代码审查" },
] as const;

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
    expect(filterPromptCommandItems(commandItems, "项目")).toEqual([commandItems[0]]);
    expect(filterPromptCommandItems(commandItems, "review")).toEqual([commandItems[1]]);
    expect(filterPromptCommandItems(commandItems, "missing")).toEqual([]);
  });

  it("wraps keyboard selection while keeping empty lists stable", () => {
    expect(movePromptCommandSelection(0, 1, 2)).toBe(1);
    expect(movePromptCommandSelection(1, 1, 2)).toBe(0);
    expect(movePromptCommandSelection(0, -1, 2)).toBe(1);
    expect(movePromptCommandSelection(4, 1, 0)).toBe(0);
  });
});
