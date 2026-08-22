import type { ProjectFileSearchEntry } from "@code-agent/protocol";

import type { ProjectFileTreeItem } from "./project-file-tree-model.js";
import {
  getProjectTargetAbsolutePath,
  type ProjectOpenContextMenuTarget,
} from "./project-open-menu.js";

export function createProjectFileTreeOpenTarget(
  item: ProjectFileTreeItem,
  projectPath: string,
): ProjectOpenContextMenuTarget | null {
  if (item.kind === "status") return null;
  if (item.kind === "root") {
    return {
      absolutePath: projectPath,
      path: projectPath,
      relativePath: ".",
      type: "directory",
    };
  }
  return {
    absolutePath: getProjectTargetAbsolutePath(projectPath, item.path),
    path: item.path,
    relativePath: item.path,
    ...(item.type === "file"
      ? { reference: { name: item.name, path: item.path } satisfies ProjectFileSearchEntry }
      : {}),
    type: item.type,
  };
}
