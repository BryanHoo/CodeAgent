import { describe, expect, it } from "vitest";

import {
  countFileChangeLines,
  normalizeFileChangePatch,
  summarizeFileChanges,
} from "./file-change.js";

describe("file change view model", () => {
  it("counts patch body lines without counting file headers", () => {
    expect(
      countFileChangeLines({
        diff: "--- a/package.json\n+++ b/package.json\n@@ -1,2 +1,3 @@\n-old\n+new\n+next",
        kind: "update",
        path: "package.json",
      }),
    ).toEqual({ additions: 2, removals: 1 });
  });

  it("uses the file operation as the final create and delete meaning", () => {
    expect(
      countFileChangeLines({ diff: "-first\n-second", kind: "create", path: "new.ts" }),
    ).toEqual({ additions: 2, removals: 0 });
    expect(
      countFileChangeLines({ diff: "+first\n+second", kind: "delete", path: "old.ts" }),
    ).toEqual({ additions: 0, removals: 2 });
  });

  it("counts complete file content returned for a created file", () => {
    expect(
      countFileChangeLines({
        diff: "export const enabled = true;\n\nexport function run() {}\n",
        kind: "create",
        path: "src/new-module.ts",
      }),
    ).toEqual({ additions: 3, removals: 0 });
  });

  it("normalizes a line-only provider diff into a renderable unified patch", () => {
    const patch = normalizeFileChangePatch({
      diff: "-const oldValue = true;\n+const nextValue = true;",
      kind: "update",
      path: "src/config.ts",
    });

    expect(patch).toContain("--- a/src/config.ts");
    expect(patch).toContain("+++ b/src/config.ts");
    expect(patch).toContain("@@ -1,1 +1,1 @@");
    expect(patch).toContain("-const oldValue = true;");
    expect(patch).toContain("+const nextValue = true;");
  });

  it("summarizes unique files with their latest response diff", () => {
    const firstChange = {
      diff: "@@ -1 +1 @@\n-old\n+middle",
      kind: "update" as const,
      path: "src\\config.ts",
    };
    const latestChange = {
      diff: "@@ -1 +1,2 @@\n-middle\n+new\n+next",
      kind: "update" as const,
      path: "src/config.ts",
    };
    const createdChange = {
      diff: "first\nsecond",
      kind: "create" as const,
      path: "src/new.ts",
    };

    expect(summarizeFileChanges([firstChange, latestChange, createdChange])).toEqual({
      additions: 4,
      changes: [latestChange, createdChange],
      removals: 1,
    });
  });
});
