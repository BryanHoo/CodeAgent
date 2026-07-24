import type { AgentItem } from "@code-agent/protocol";

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

function isUnifiedFilePatch(diff: string): boolean {
  const hasFileHeaders = /^---\s/m.test(diff) && /^\+\+\+\s/m.test(diff);
  return hasFileHeaders || /^@@\s/m.test(diff);
}

function countCompleteFileLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

export function countFileChangeLines(change: AgentFileChange): FileChangeStats {
  if (!isUnifiedFilePatch(change.diff)) {
    // Codex 有时直接返回新旧文件的完整内容，此时每一行都属于对应文件操作。
    if (change.kind === "create") {
      return { additions: countCompleteFileLines(change.diff), removals: 0 };
    }
    if (change.kind === "delete") {
      return { additions: 0, removals: countCompleteFileLines(change.diff) };
    }
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

  // Codex 的新增或删除补丁可能使用应用方向，最终统计以文件操作语义为准。
  if (change.kind === "create") {
    return { additions: Math.max(additions, removals), removals: 0 };
  }
  if (change.kind === "delete") {
    return { additions: 0, removals: Math.max(additions, removals) };
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
  const trimmedDiff = change.diff.trimEnd();
  const hasFileHeaders = /^---\s/m.test(trimmedDiff) && /^\+\+\+\s/m.test(trimmedDiff);
  const { additionPath, deletionPath } = getPatchFileHeaders(change);

  if (hasFileHeaders) {
    return trimmedDiff;
  }

  const fileHeaders = `--- ${deletionPath}\n+++ ${additionPath}`;
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
