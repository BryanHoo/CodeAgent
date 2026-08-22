import type { Project, ProjectRoot } from "@code-agent/protocol";

export type ProjectRootSelection = Readonly<{
  path: string;
  projectId: string;
}>;

/** 按 Project 身份和 roots 成员关系派生当前根，失效选择直接回退 primary。 */
export function resolveSelectedProjectRoot(
  project: Pick<Project, "id" | "roots"> | undefined,
  selection: ProjectRootSelection | undefined,
): ProjectRoot | undefined {
  if (project === undefined) return undefined;
  return (
    project.roots.find(
      (root) => selection?.projectId === project.id && root.path === selection.path,
    ) ?? project.roots[0]
  );
}

/** 目录点击按首次选择顺序加入，再次点击则移除。 */
export function toggleProjectRootPath(paths: readonly string[], path: string): readonly string[] {
  return paths.includes(path)
    ? paths.filter((selectedPath) => selectedPath !== path)
    : [...paths, path];
}

/** 将已有目录提升到首项，首项即 Codex primary folder。 */
export function promoteProjectRootPath(paths: readonly string[], path: string): readonly string[] {
  if (!paths.includes(path) || paths[0] === path) return paths;
  return [path, ...paths.filter((selectedPath) => selectedPath !== path)];
}
