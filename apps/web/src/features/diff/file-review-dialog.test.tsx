import { describe, expect, it } from "vitest";

import {
  buildReviewFileList,
  getReviewNavigationDirection,
  resolveReviewIndex,
} from "./file-review-dialog.js";

describe("file review navigation", () => {
  it("moves between files without crossing review boundaries", () => {
    expect(resolveReviewIndex(0, "previous", 3)).toBe(0);
    expect(resolveReviewIndex(0, "next", 3)).toBe(1);
    expect(resolveReviewIndex(1, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "previous", 3)).toBe(1);
    expect(resolveReviewIndex(0, "next", 0)).toBe(0);
  });

  it("maps vertical and horizontal arrow keys to file navigation", () => {
    expect(getReviewNavigationDirection("ArrowUp")).toBe("previous");
    expect(getReviewNavigationDirection("ArrowLeft")).toBe("previous");
    expect(getReviewNavigationDirection("ArrowDown")).toBe("next");
    expect(getReviewNavigationDirection("ArrowRight")).toBe("next");
    expect(getReviewNavigationDirection("Enter")).toBeNull();
  });

  it("builds a flat changed-file list with per-file statistics", () => {
    const items = buildReviewFileList([
      {
        diff: "@@ -1 +1,2 @@\n-old\n+new\n+next",
        kind: "update",
        path: "apps/web/src/main.tsx",
      },
      {
        diff: "+export const dialog = true;",
        kind: "create",
        path: "apps\\web\\src\\dialog.tsx",
      },
      {
        diff: "-legacy",
        kind: "delete",
        path: "README.md",
      },
    ]);

    expect(items).toEqual([
      {
        additions: 2,
        changeIndex: 0,
        name: "main.tsx",
        path: "apps/web/src/main.tsx",
        removals: 1,
      },
      {
        additions: 1,
        changeIndex: 1,
        name: "dialog.tsx",
        path: "apps\\web\\src\\dialog.tsx",
        removals: 0,
      },
      {
        additions: 0,
        changeIndex: 2,
        name: "README.md",
        path: "README.md",
        removals: 1,
      },
    ]);
  });
});
