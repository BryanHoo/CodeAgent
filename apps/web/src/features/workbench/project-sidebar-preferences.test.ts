import { describe, expect, it } from "vitest";

import {
  readExpandedProjectIds,
  resolveInitialExpandedProjectIds,
  writeExpandedProjectIds,
} from "./project-sidebar-preferences.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("project sidebar preferences", () => {
  it("expands only the first project when no preference exists", () => {
    expect([...resolveInitialExpandedProjectIds(["project-1", "project-2"], null)]).toEqual([
      "project-1",
    ]);
  });

  it("restores the saved folder shape and ignores removed projects", () => {
    expect([
      ...resolveInitialExpandedProjectIds(
        ["project-1", "project-2", "project-3"],
        new Set(["project-2", "removed-project"]),
      ),
    ]).toEqual(["project-2"]);
  });

  it("preserves a saved state where every project is collapsed", () => {
    expect([...resolveInitialExpandedProjectIds(["project-1", "project-2"], new Set())]).toEqual(
      [],
    );
  });

  it("round-trips expanded project identifiers through browser storage", () => {
    const storage = new MemoryStorage();

    writeExpandedProjectIds(storage, new Set(["project-1", "project-3"]));

    expect(readExpandedProjectIds(storage)).toEqual(new Set(["project-1", "project-3"]));
  });

  it("falls back to defaults when saved data is malformed", () => {
    const storage = new MemoryStorage();
    storage.values.set("code-agent:project-sidebar:expanded-projects:v1", "not-json");

    expect(readExpandedProjectIds(storage)).toBeNull();
  });
});
