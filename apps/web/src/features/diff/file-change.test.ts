import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../conversation/runtime/task-runtime.js";
import {
  collectSnapshotFileChanges,
  countFileChangeLines,
  normalizeFileChangePatch,
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

  it("keeps only the latest change for each path in a task snapshot", () => {
    const snapshot = {
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      pinned: false,
      projectId: "project-1",
      status: "idle",
      title: "Diff",
      turns: [
        {
          completedAt: "2026-07-24T00:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            {
              changes: [
                { diff: "+first", kind: "update", path: "src/app.ts" },
                { diff: "+readme", kind: "create", path: "README.md" },
              ],
              id: "change-1",
              status: "completed",
              type: "file_change",
            },
          ],
          startedAt: "2026-07-24T00:00:00.000Z",
          status: "completed",
        },
        {
          completedAt: "2026-07-24T00:03:00.000Z",
          error: null,
          id: "turn-2",
          items: [
            {
              changes: [{ diff: "-first\n+second", kind: "update", path: "src/app.ts" }],
              id: "change-2",
              status: "completed",
              type: "file_change",
            },
          ],
          startedAt: "2026-07-24T00:02:00.000Z",
          status: "completed",
        },
      ],
      updatedAt: "2026-07-24T00:03:00.000Z",
    } satisfies RuntimeTaskSnapshot;

    const changes = collectSnapshotFileChanges(snapshot);

    expect(changes).toHaveLength(2);
    expect(changes.find((change) => change.path === "src/app.ts")?.diff).toBe("-first\n+second");
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
});
