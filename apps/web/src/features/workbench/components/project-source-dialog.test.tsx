import { describe, expect, it } from "vitest";

import { getCodeLanguage } from "./project-source-dialog.js";

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
