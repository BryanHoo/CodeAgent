import type { AgentItem } from "@/protocol/index.js";

export type AgentFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];

export type FileChangeStats = Readonly<{
  additions: number;
  removals: number;
}>;

export type FileChangeSummary = Readonly<{
  additions: number;
  changes: readonly AgentFileChange[];
  removals: number;
}>;

export function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function countFileChangeLines(change: AgentFileChange): FileChangeStats {
  if (change.kind === "create" || change.kind === "delete") {
    // Codex 的新增、删除事件携带原始文件内容；末尾换行不额外算一行。
    let lines = change.diff.length > 0 && !change.diff.endsWith("\n") ? 1 : 0;
    for (let index = 0; index < change.diff.length; index += 1) {
      if (change.diff.charCodeAt(index) === 10) lines += 1;
    }
    return {
      additions: change.kind === "create" ? lines : 0,
      removals: change.kind === "delete" ? lines : 0,
    };
  }

  let additions = 0;
  let removals = 0;

  // 只统计补丁正文，避免把 Unified Diff 的文件头误计为代码变更。
  for (const line of change.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removals += 1;
    }
  }

  return { additions, removals };
}

export function summarizeFileChanges(changes: readonly AgentFileChange[]): FileChangeSummary {
  const uniqueChanges: AgentFileChange[] = [];
  const changeIndexByPath = new Map<string, number>();

  for (const change of changes) {
    const normalizedPath = change.path.replaceAll("\\", "/");
    const existingIndex = changeIndexByPath.get(normalizedPath);
    if (existingIndex === undefined) {
      changeIndexByPath.set(normalizedPath, uniqueChanges.length);
      uniqueChanges.push(change);
    } else {
      // 同一回复重复编辑同一文件时，卡片保留首次位置并审核最终 Diff。
      uniqueChanges[existingIndex] = change;
    }
  }

  let additions = 0;
  let removals = 0;
  for (const change of uniqueChanges) {
    const statistics = countFileChangeLines(change);
    additions += statistics.additions;
    removals += statistics.removals;
  }

  return { additions, changes: uniqueChanges, removals };
}

function getPatchFileHeaders(change: AgentFileChange): Readonly<{
  additionPath: string;
  deletionPath: string;
}> {
  const normalizedPath = change.path.replace(/^[/\\]+/, "").replaceAll("\\", "/");
  return {
    additionPath: change.kind === "delete" ? "/dev/null" : `b/${normalizedPath}`,
    deletionPath: change.kind === "create" ? "/dev/null" : `a/${normalizedPath}`,
  };
}

export function normalizeFileChangePatch(change: AgentFileChange): string {
  const { additionPath, deletionPath } = getPatchFileHeaders(change);
  const fileHeaders = `--- ${deletionPath}\n+++ ${additionPath}`;

  if (change.kind === "create" || change.kind === "delete") {
    // 原始内容可能包含补丁标记，必须先按类型处理，并保留空行和尾部空格。
    const lines = change.diff.length === 0 ? [] : change.diff.split("\n");
    if (change.diff.endsWith("\n")) lines.pop();
    if (lines.length === 0) return fileHeaders;
    const prefix = change.kind === "create" ? "+" : "-";
    const range = `1,${String(lines.length)}`;
    const hunkHeader = change.kind === "create" ? `@@ -0,0 +${range} @@` : `@@ -${range} +0,0 @@`;
    const body = lines.map((line) => `${prefix}${line}`);
    if (!change.diff.endsWith("\n")) body.push("\\ No newline at end of file");
    return [fileHeaders, hunkHeader, ...body].join("\n");
  }

  const trimmedDiff = change.diff.trimEnd();
  const hasFileHeaders = /^---\s/m.test(trimmedDiff) && /^\+\+\+\s/m.test(trimmedDiff);
  if (hasFileHeaders) {
    return trimmedDiff;
  }

  if (/^@@\s/m.test(trimmedDiff)) {
    return `${fileHeaders}\n${trimmedDiff}`;
  }

  const bodyLines = trimmedDiff.length === 0 ? [] : trimmedDiff.split("\n");
  let additions = 0;
  let removals = 0;
  let contextLines = 0;
  const normalizedBodyLines = bodyLines.map((line) => {
    if (line.startsWith("+")) {
      additions += 1;
      return line;
    }
    if (line.startsWith("-")) {
      removals += 1;
      return line;
    }
    contextLines += 1;
    return ` ${line}`;
  });
  const deletionCount = removals + contextLines;
  const additionCount = additions + contextLines;
  const hunkHeader = `@@ -1,${String(deletionCount)} +1,${String(additionCount)} @@`;

  return [fileHeaders, hunkHeader, ...normalizedBodyLines].join("\n");
}
