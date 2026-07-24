import { describe, expect, it } from "vitest";

import { resolveReviewIndex } from "./file-review-dialog.js";

describe("file review navigation", () => {
  it("moves between files without crossing review boundaries", () => {
    expect(resolveReviewIndex(0, "previous", 3)).toBe(0);
    expect(resolveReviewIndex(0, "next", 3)).toBe(1);
    expect(resolveReviewIndex(1, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "previous", 3)).toBe(1);
    expect(resolveReviewIndex(0, "next", 0)).toBe(0);
  });
});
