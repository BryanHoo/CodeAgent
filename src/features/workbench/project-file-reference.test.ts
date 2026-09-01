import { describe, expect, it } from "vitest";

import {
  getProjectFileContainingFolderPath,
  getProjectFileManagerOpenPath,
} from "./project-file-reference.js";

describe("project file containing folder", () => {
  it.each([
    ["/workspace/src/main.ts", "/workspace/src"],
    ["/main.ts", "/"],
    ["src/main.ts", "src"],
    ["main.ts", undefined],
    ["C:\\workspace\\src\\main.ts", "C:\\workspace\\src"],
  ])("resolves %s to %s", (path, expected) => {
    expect(getProjectFileContainingFolderPath(path)).toBe(expected);
  });

  it("preserves the file path for Finder reveal and uses the parent elsewhere", () => {
    expect(getProjectFileManagerOpenPath("/workspace/src/main.ts", "darwin")).toBe(
      "/workspace/src/main.ts",
    );
    expect(getProjectFileManagerOpenPath("/workspace/src/main.ts", "linux")).toBe(
      "/workspace/src",
    );
    expect(getProjectFileManagerOpenPath("C:\\workspace\\src\\main.ts", "win32")).toBe(
      "C:\\workspace\\src",
    );
  });
});
