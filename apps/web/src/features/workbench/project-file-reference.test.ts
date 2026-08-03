import { describe, expect, it } from "vitest";

import { classifyProjectFileReference } from "./project-file-reference.js";

describe("classifyProjectFileReference", () => {
  it.each(["images/result.png", "/workspace/project/design.JPG", "C:\\project\\screen.webp"])(
    "classifies %s as an image preview",
    (path) => {
      expect(classifyProjectFileReference(path)).toBe("image");
    },
  );

  it.each([
    "report.doc",
    "report.docx",
    "slides.ppt",
    "slides.pptx",
    "table.xls",
    "table.xlsx",
    "archive.zip",
  ])("classifies %s for the system default application", (path) => {
    expect(classifyProjectFileReference(path)).toBe("system");
  });

  it.each(["src/main.ts", "docs/guide.md", "data/config.json", "notes.txt"])(
    "classifies %s as a source preview",
    (path) => {
      expect(classifyProjectFileReference(path)).toBe("source");
    },
  );
});
