import { describe, expect, it } from "vitest";

import { readProjectOpenAppId, writeProjectOpenAppId } from "./project-open-preferences.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const apps = [
  { id: "finder", kind: "file-manager", name: "Finder" },
  { id: "zed", kind: "editor", name: "Zed" },
] as const;

describe("project open preferences", () => {
  it("stores independent app selections for each project", () => {
    const storage = new MemoryStorage();

    writeProjectOpenAppId(storage, "project-1", "zed");
    writeProjectOpenAppId(storage, "project-2", "finder");

    expect(readProjectOpenAppId(storage, "project-1", apps)).toBe("zed");
    expect(readProjectOpenAppId(storage, "project-2", apps)).toBe("finder");
  });

  it("ignores malformed and no-longer-available selections", () => {
    const storage = new MemoryStorage();
    storage.values.set("code-agent:project-open:app:v1", "not-json");
    expect(readProjectOpenAppId(storage, "project-1", apps)).toBeUndefined();

    writeProjectOpenAppId(storage, "project-1", "ghostty");
    expect(readProjectOpenAppId(storage, "project-1", apps)).toBeUndefined();
  });
});
