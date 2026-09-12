import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AgentFileChangeSchema } from "@/protocol/index.js";
import { getFileChangeStats, normalizeFileChangePatch, summarizeFileChanges } from "./file-change.js";

it("只读取原生统计，不扫描 Diff 正文", () => {
  const change = {
    path: "sample.txt", kind: "update" as const,
    stats: { additions: 12, removals: 7 },
    get diff(): string { throw new Error("渲染统计不应读取正文"); },
  };
  expect(getFileChangeStats(change)).toEqual({ additions: 12, removals: 7 });
});

it("协议必须携带非负整数统计，不接受缺失字段或回退扫描", () => {
  const change = { path: "sample.txt", kind: "update", diff: "" };
  expect(Value.Check(AgentFileChangeSchema, change)).toBe(false);
  expect(Value.Check(AgentFileChangeSchema, { ...change, stats: { additions: 1, removals: 0 } })).toBe(true);
  for (const additions of [-1, 1.5]) {
    expect(Value.Check(AgentFileChangeSchema, { ...change, stats: { additions, removals: 0 } })).toBe(false);
  }
});

it("同路径重复修改只汇总最终原生统计，并保留首次位置", () => {
  const change = { path: "src/a.ts", kind: "update" as const, diff: "", stats: { additions: 8, removals: 3 } };
  const other = { ...change, path: "src/b.ts", stats: { additions: 1, removals: 1 } };
  const latest = { ...change, path: "src\\a.ts", stats: { additions: 2, removals: 0 } };
  expect(summarizeFileChanges([change, other, latest])).toEqual({ additions: 3, removals: 1, changes: [latest, other] });
});

describe("原生统计汇总", () => {
  it("汇总新增、删除与修改文件", () => {
    expect(summarizeFileChanges([
      { path: "new.txt", kind: "create", diff: "first\nsecond\n", stats: { additions: 2, removals: 0 } },
      { path: "old.txt", kind: "delete", diff: "old\n", stats: { additions: 0, removals: 1 } },
      { path: "edit.txt", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new\n", stats: { additions: 1, removals: 1 } },
    ])).toMatchObject({ additions: 3, removals: 2 });
  });
});

describe("完整文件内容的差异预览", () => {
  it.each(["create", "delete"] as const)("为 %s 生成完整补丁并保留空行和尾部空格", (kind) => {
    const prefix = kind === "create" ? "+" : "-";
    expect(normalizeFileChangePatch({ path: "sample.txt", kind, diff: "+++ text\n--- text\n@@ text\nlast  \n\n", stats: { additions: kind === "create" ? 5 : 0, removals: kind === "delete" ? 5 : 0 } })).toBe([
      `--- ${kind === "create" ? "/dev/null" : "a/sample.txt"}`,
      `+++ ${kind === "delete" ? "/dev/null" : "b/sample.txt"}`,
      kind === "create" ? "@@ -0,0 +1,5 @@" : "@@ -1,5 +0,0 @@",
      ...["+++ text", "--- text", "@@ text", "last  ", ""].map((line) => `${prefix}${line}`),
    ].join("\n"));
  });
});
