import { describe, expect, it } from "vitest";

import {
  getCodeLanguage,
  getNextSourceCursor,
  mergeProjectSourcePages,
  shouldLoadNextSourcePage,
} from "./project-source-dialog.js";

describe("getCodeLanguage", () => {
  it.each([
    ["src/example.ts", "typescript"],
    ["src/component.TSX", "tsx"],
    ["docs/guide.md", "markdown"],
    ["config/.env", "dotenv"],
    ["assets/archive.unknown", "text"],
    ["LICENSE", "text"],
  ])("maps %s to %s", (path, expectedLanguage) => {
    expect(getCodeLanguage(path)).toBe(expectedLanguage);
  });
});

describe("project source pagination", () => {
  it("merges loaded pages without losing content and exposes the final cursor", () => {
    expect(
      mergeProjectSourcePages([
        { content: "first\n", nextCursor: 6, path: "src/large.ts" },
        { content: "second\n", nextCursor: null, path: "src/large.ts" },
      ]),
    ).toEqual({
      content: "first\nsecond\n",
      nextCursor: null,
      path: "src/large.ts",
    });
  });

  it("stops pagination when the server repeats a cursor", () => {
    expect(
      getNextSourceCursor({ content: "first", nextCursor: 128, path: "src/large.ts" }, 0),
    ).toBe(128);
    expect(
      getNextSourceCursor({ content: "second", nextCursor: 128, path: "src/large.ts" }, 128),
    ).toBeUndefined();
    expect(
      getNextSourceCursor({ content: "last", nextCursor: null, path: "src/large.ts" }, 128),
    ).toBeUndefined();
  });

  it("loads the next page only when vertical scrolling approaches the bottom", () => {
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 950 }),
    ).toBe(false);
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 1_050 }),
    ).toBe(true);
  });
});
