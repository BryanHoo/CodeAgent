import type { ProjectGitStatus } from "@code-agent/protocol";

import { countFileChangeLines, type AgentFileChange } from "../../diff/file-change.js";

export type InspectorGitChangeState = Readonly<{
  allChanges: readonly AgentFileChange[];
  changeStats: Readonly<{ additions: number; removals: number }> | undefined;
  fileChangesByPath: ReadonlyMap<string, AgentFileChange>;
}>;

export function deriveInspectorGitChangeState(
  gitStatus: ProjectGitStatus | undefined,
  gitStatusDetails: ProjectGitStatus | undefined,
): InspectorGitChangeState {
  const allChanges = [...(gitStatus?.unstaged ?? []), ...(gitStatus?.staged ?? [])];
  const fileChangesByPath = new Map<string, AgentFileChange>();
  for (const change of allChanges) {
    if (!fileChangesByPath.has(change.path)) fileChangesByPath.set(change.path, change);
  }

  // 详情必须属于当前轻量快照，避免刷新竞态把旧行数展示到新文件集合上。
  const statsChanges =
    gitStatusDetails !== undefined && gitStatusDetails.snapshot === gitStatus?.snapshot
      ? [...gitStatusDetails.unstaged, ...gitStatusDetails.staged]
      : allChanges.every((change) => change.diff !== "")
        ? allChanges
        : undefined;
  const changeStats = statsChanges?.reduce(
    (total, change) => {
      const stats = countFileChangeLines(change);
      return {
        additions: total.additions + stats.additions,
        removals: total.removals + stats.removals,
      };
    },
    { additions: 0, removals: 0 },
  );

  return { allChanges, changeStats, fileChangesByPath };
}
