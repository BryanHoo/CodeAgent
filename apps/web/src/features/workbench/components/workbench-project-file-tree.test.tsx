import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PROJECT_FILE_TREE_ROW_HEIGHT_PX,
  WorkbenchProjectFileTree,
  pruneCollapsedProjectFileTreePaths,
} from "./workbench-project-file-tree.js";

describe("WorkbenchProjectFileTree", () => {
  it("removes expanded descendants when their parent is collapsed", () => {
    expect([
      ...pruneCollapsedProjectFileTreePaths(
        new Set(["src", "src/components", "docs"]),
        new Set(["docs"]),
      ),
    ]).toEqual(["docs"]);
  });

  it("renders an accessible virtual tree with the existing compact row height", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkbenchProjectFileTree
          client={{
            listProjectFiles: vi.fn(() => Promise.resolve({ entries: [], path: null })),
          }}
          expandedPaths={new Set()}
          fileChangesByPath={new Map()}
          onExpandedPathsChange={() => undefined}
          onOpenFileDiff={() => undefined}
          onOpenProjectFile={() => undefined}
          onOpenProjectPath={() => undefined}
          onReferenceProjectPath={() => undefined}
          onRefreshProject={() => undefined}
          projectId="project-1"
          projectName="CodeAgent"
          projectOpenApps={[]}
          projectOpenPending={false}
          projectPath="/workspace/CodeAgent"
        />
      </QueryClientProvider>,
    );

    expect(PROJECT_FILE_TREE_ROW_HEIGHT_PX).toBe(28);
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="项目文件"');
    expect(markup).toContain("CodeAgent");
  });
});
