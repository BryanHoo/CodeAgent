import { describe, expect, it } from "vitest";
import { countFileChangeLines, normalizeFileChangePatch, summarizeFileChanges } from "./file-change.js";

describe("完整文件内容的增删统计", () => {
  it.each(["create", "delete"] as const)("按 %s 类型统计所有内容行", (kind) => {
    const change = { path: "sample.txt", kind, diff: "first\n\n+++ content\n--- content\n" };
    expect(countFileChangeLines(change)).toEqual({
      additions: kind === "create" ? 4 : 0,
      removals: kind === "delete" ? 4 : 0,
    });
  });

  it.each(["", "line", "line\n", "line\n\n", "line\r\n\r\n"])("正确处理空内容和行尾：%j", (diff) => {
    const lines = diff === "" ? 0 : diff.endsWith("\n\n") || diff.endsWith("\r\n\r\n") ? 2 : 1;
    expect(countFileChangeLines({ path: "sample.txt", kind: "create", diff })).toEqual({ additions: lines, removals: 0 });
  });

  it("汇总新增、删除与修改文件", () => {
    expect(summarizeFileChanges([
      { path: "new.txt", kind: "create", diff: "first\nsecond\n" },
      { path: "old.txt", kind: "delete", diff: "old\n" },
      { path: "edit.txt", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new\n" },
    ])).toMatchObject({ additions: 3, removals: 2 });
  });
});

describe("完整文件内容的差异预览", () => {
  it.each(["create", "delete"] as const)("为 %s 生成完整补丁并保留空行和尾部空格", (kind) => {
    const prefix = kind === "create" ? "+" : "-";
    expect(normalizeFileChangePatch({ path: "sample.txt", kind, diff: "+++ text\n--- text\n@@ text\nlast  \n\n" })).toBe([
      `--- ${kind === "create" ? "/dev/null" : "a/sample.txt"}`,
      `+++ ${kind === "delete" ? "/dev/null" : "b/sample.txt"}`,
      kind === "create" ? "@@ -0,0 +1,5 @@" : "@@ -1,5 +0,0 @@",
      ...["+++ text", "--- text", "@@ text", "last  ", ""].map((line) => `${prefix}${line}`),
    ].join("\n"));
  });
});
