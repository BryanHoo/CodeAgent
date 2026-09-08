import { describe, expect, it } from "vitest";

import {
  getShortcutDisplayKeys,
  matchesShortcut,
  WORKBENCH_SHORTCUTS,
} from "./keyboard-shortcuts.js";

const baseEvent = {
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  isComposing: false,
  key: "n",
  metaKey: true,
  repeat: false,
  shiftKey: false,
};

describe("workbench keyboard shortcuts", () => {
  it("matches the platform primary modifier and rejects unsafe key events", () => {
    const newTask = WORKBENCH_SHORTCUTS.find((shortcut) => shortcut.id === "newTask");
    expect(newTask).toBeDefined();
    expect(matchesShortcut(baseEvent, newTask!, true)).toBe(true);
    expect(matchesShortcut({ ...baseEvent, ctrlKey: true, metaKey: false }, newTask!, false)).toBe(
      true,
    );
    expect(matchesShortcut({ ...baseEvent, repeat: true }, newTask!, true)).toBe(false);
    expect(matchesShortcut({ ...baseEvent, isComposing: true }, newTask!, true)).toBe(false);
    expect(matchesShortcut({ ...baseEvent, altKey: true }, newTask!, true)).toBe(false);
  });

  it("provides familiar cross-platform shortcuts for every documented action", () => {
    expect(WORKBENCH_SHORTCUTS.map(({ id }) => id)).toEqual([
      "newTask",
      "searchTasks",
      "toggleSidebar",
      "toggleInspector",
      "toggleTerminal",
      "openSettings",
      "showShortcuts",
    ]);
    expect(getShortcutDisplayKeys(WORKBENCH_SHORTCUTS[0]!, true)).toEqual(["⌘", "N"]);
    expect(getShortcutDisplayKeys(WORKBENCH_SHORTCUTS[0]!, false)).toEqual(["Ctrl", "N"]);
  });
});
