import { expect, it } from "vitest";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { deriveInspectorGitChangeState } from "./workbench-inspector-git-status.js";

it("合并暂存和工作区统计，但拒绝其他快照的旧详情", () => {
  const status: ProjectGitStatus = {
    baseBranches: [], branch: "main", branches: ["main"], repositoryMode: "root", snapshot: "a".repeat(64),
    staged: [{ path: "a.txt", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
    unstaged: [{ path: "a.txt", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
  };
  const details: ProjectGitStatus = {
    ...status,
    staged: [{ ...status.staged[0]!, diff: "+staged", stats: { additions: 3, removals: 2 } }],
    unstaged: [{ ...status.unstaged[0]!, diff: "+worktree", stats: { additions: 4, removals: 1 } }],
  };
  const result = deriveInspectorGitChangeState(status, details);
  expect(result.changeStats).toEqual({ additions: 7, removals: 3 });
  expect(result.displayChanges).toHaveLength(1);
  expect(result.displayChanges[0]?.stats).toEqual({ additions: 7, removals: 3 });
  expect(deriveInspectorGitChangeState(status, { ...details, snapshot: "b".repeat(64) }).changeStats).toBeUndefined();
});
