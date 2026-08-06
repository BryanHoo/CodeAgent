import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/ui/tooltip.js";
import { WorkbenchInspector, type ProjectFileTreeDirectoryState } from "./workbench-inspector.js";

function renderInspectorMarkup(children: ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/review",
  branches: ["feat/review", "main"],
  repositoryMode: "root" as const,
  snapshot: "a".repeat(64),
  staged: [
    {
      diff: "--- a/package.json\n+++ b/package.json\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "package.json",
    },
  ],
  unstaged: [
    {
      diff: "--- /dev/null\n+++ b/new-file.ts\n@@ -0,0 +1,1 @@\n+export {};",
      kind: "create" as const,
      path: "new-file.ts",
    },
  ],
};

const nestedGitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/tree-status",
  branches: ["feat/tree-status", "main"],
  repositoryMode: "root" as const,
  snapshot: "b".repeat(64),
  staged: [],
  unstaged: [
    {
      diff: "--- a/src/components/app.tsx\n+++ b/src/components/app.tsx\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "src/components/app.tsx",
    },
  ],
};

const fileTree = {
  entries: [
    { path: "src", type: "directory" as const },
    { path: "README.md", type: "file" as const },
  ],
  path: null,
};

const fileTreeDirectories: readonly ProjectFileTreeDirectoryState[] = [
  { data: fileTree, error: null, isFetching: false, isPending: false, path: null },
  {
    data: {
      entries: [{ path: "src/components", type: "directory" as const }],
      path: "src",
    },
    error: null,
    isFetching: false,
    isPending: false,
    path: "src",
  },
  {
    data: {
      entries: [{ path: "src/components/app.tsx", type: "file" as const }],
      path: "src/components",
    },
    error: null,
    isFetching: false,
    isPending: false,
    path: "src/components",
  },
];

describe("WorkbenchInspector", () => {
  it("keeps the user-controlled project tab selected while terminals are running", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        backgroundTerminals={[
          {
            command: "pnpm dev",
            cwd: "/workspace/CodeAgent",
            id: "terminal-1",
            itemId: "command-1",
          },
        ]}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>项目<\/button>/u);
    expect(markup).not.toContain('aria-label="运行中的终端"');
    expect(markup).not.toContain("pnpm dev");
  });

  it("integrates inline change stats with neutral review and commit actions", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        onOpenProjectFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        gitStatus={gitStatus}
      />,
    );

    expect(markup).toContain("2 个变更");
    expect(markup).toContain('aria-label="未提交变更摘要"');
    expect(markup).toContain('aria-label="变更统计"');
    expect(markup).toContain('aria-label="变更操作"');
    expect(markup).toContain('aria-label="审核 2 个未提交变更"');
    expect(markup).toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(">审核</button>");
    expect(markup).toContain(">提交</button>");
    expect(markup).toMatch(
      /aria-label="变更统计"[^>]*><span>2 个变更<\/span><span[^>]*>\+3<\/span><span[^>]*>-1<\/span>/u,
    );
    expect(markup).toMatch(/<button[^>]*bg-control[^>]*aria-label="审核 2 个未提交变更"/u);
    expect(markup).toMatch(/<button[^>]*bg-control[^>]*aria-label="提交 2 个未提交变更"/u);
    expect(markup).not.toContain("bg-primary");
    expect(markup).toContain('aria-label="运行环境"');
    expect(markup).toMatch(/role="tab"[^>]*>项目<\/button>/u);
    expect(markup).toContain('aria-label="项目文件"');
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="收起文件夹 CodeAgent"');
    expect(markup).toContain(">CodeAgent</span>");
    expect(markup).toContain("src");
    expect(markup).toContain('aria-label="展开文件夹 src"');
    expect(markup).toContain("README.md");
    expect(markup).not.toContain("components");
    expect(markup).not.toContain('aria-label="Git 变更文件"');
    expect(markup).not.toContain("未暂存");
    expect(markup).not.toContain("已暂存");

    expect(markup).not.toContain(">项目文件</span>");
  });

  it("renders loaded directory children only while their folders are expanded", () => {
    const srcExpandedMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        expandedFileTreePaths={new Set(["src"])}
        fileTreeDirectories={fileTreeDirectories}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );
    const componentsExpandedMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        expandedFileTreePaths={new Set(["src", "src/components"])}
        fileTreeDirectories={fileTreeDirectories}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(srcExpandedMarkup).toContain('aria-label="展开文件夹 components"');
    expect(srcExpandedMarkup).not.toContain("app.tsx");
    expect(componentsExpandedMarkup).toContain("app.tsx");
  });

  it("uses context-menu and hover action triggers for project files and folders", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        projectName="CodeAgent"
        projectOpenApps={[
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "finder", kind: "file-manager", name: "Finder" },
        ]}
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup.match(/data-slot="context-menu-trigger"/gu)).toHaveLength(3);
    expect(markup.match(/data-slot="dropdown-menu-trigger"/gu)).toHaveLength(3);
    expect(markup).toContain('aria-label="打开 /workspace/CodeAgent 的方式"');
    expect(markup).toContain('aria-label="打开 src 的方式"');
    expect(markup).toContain('aria-label="打开 README.md 的方式"');
    expect(markup).toContain("group-hover/file-tree-node:opacity-100");
    expect(markup).toContain('role="treeitem"');
    expect(markup).toContain('aria-label="收起文件夹 CodeAgent"');
    expect(markup).toContain("README.md");
    expect(markup).toContain("src");
  });

  it("moves Git change stats from the nearest collapsed ancestor to the visible file", () => {
    const renderInspector = (expandedFileTreePaths: Set<string>) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          expandedFileTreePaths={expandedFileTreePaths}
          fileTreeDirectories={fileTreeDirectories}
          gitStatus={nestedGitStatus}
          onReviewChanges={() => undefined}
          projectName="CodeAgent"
          projectPath="/workspace/CodeAgent"
        />,
      );

    const collapsedMarkup = renderInspector(new Set());
    const srcExpandedMarkup = renderInspector(new Set(["src"]));
    const fileVisibleMarkup = renderInspector(new Set(["src", "src/components"]));

    expect(collapsedMarkup).toContain('aria-label="src，后代新增 2 行，删除 1 行"');
    expect(collapsedMarkup).not.toContain('aria-label="src/components，后代新增 2 行，删除 1 行"');
    expect(srcExpandedMarkup).not.toContain('aria-label="src，后代新增 2 行，删除 1 行"');
    expect(srcExpandedMarkup).toContain('aria-label="src/components，后代新增 2 行，删除 1 行"');
    expect(fileVisibleMarkup).not.toContain("后代新增");
    expect(fileVisibleMarkup).toContain(
      'aria-label="src/components/app.tsx，新增 2 行，删除 1 行"',
    );
    expect(fileVisibleMarkup).toMatch(
      /app\.tsx<\/span><span[^>]*aria-label="src\/components\/app\.tsx，新增 2 行，删除 1 行"/u,
    );
  });

  it("keeps stats on the deepest visible ancestor when the changed file is absent", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        expandedFileTreePaths={new Set(["src", "src/components"])}
        fileTreeDirectories={fileTreeDirectories}
        gitStatus={{
          ...nestedGitStatus,
          unstaged: [
            {
              diff: "--- a/src/components/removed.tsx\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old\n-content",
              kind: "delete",
              path: "src/components/removed.tsx",
            },
          ],
        }}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).not.toContain("removed.tsx</span>");
    expect(markup).toContain('aria-label="src/components，后代新增 0 行，删除 2 行"');
    expect(markup).not.toContain('aria-label="src，后代新增 0 行，删除 2 行"');
  });

  it("omits the uncommitted changes module when the working tree is clean", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        onOpenProjectFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).not.toContain('aria-label="未提交变更摘要"');
    expect(markup).not.toContain('aria-label="变更操作"');
    expect(markup).not.toContain(">审核</button>");
    expect(markup).not.toContain(">提交</button>");
    expect(markup).not.toContain(">项目文件</span>");
    expect(markup).toContain(">CodeAgent</span>");
    expect(markup).toContain("README.md");
    expect(markup).not.toContain("workbench-shell.tsx");
    expect(markup).not.toContain('id="workbench-git-history"');
    expect(markup).not.toContain('aria-label="查看 Git 历史"');
  });

  it("shows a non-blocking retry status and offers a manual refresh after Git detection fails", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        gitStatus={gitStatus}
        gitStatusError={new Error("not a git repository")}
        onOpenProjectFile={() => undefined}
        onReviewChanges={() => undefined}
        onRefreshGitStatus={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).toContain("Git 变更刷新失败，正在自动重试");
    expect(markup).toContain("2 个变更");
    expect(markup).toContain("手动刷新");
    expect(markup).toContain('aria-label="手动刷新 Git 变更"');
  });

  it("renders project file tree root loading and error states", () => {
    const loadingMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={[{ error: null, isFetching: true, isPending: true, path: null }]}
        onOpenProjectFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );
    const errorMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        fileTreeDirectories={[
          {
            error: new Error("unavailable"),
            isFetching: false,
            isPending: false,
            path: null,
          },
        ]}
        onOpenProjectFile={() => undefined}
        onRefreshFileTreeDirectory={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );
    expect(loadingMarkup).toContain("正在读取项目文件...");
    expect(errorMarkup).toContain("无法读取项目文件");
    expect(errorMarkup).toContain('aria-label="重新读取项目文件"');
    expect(errorMarkup).not.toContain("仅显示前 2000 个条目");
  });

  it("lists every subagent in context and exposes output dialog triggers", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onReviewChanges={() => undefined}
        onOpenSubagent={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        subagents={[
          {
            model: "gpt-5.6-sol",
            nickname: "前端分析",
            reasoningEffort: "high",
            status: "running",
            taskId: "child-frontend",
          },
          {
            nickname: "协议检查",
            status: "completed",
            taskId: "child-protocol",
          },
        ]}
        tab="context"
      />,
    );

    expect(markup).toContain('aria-label="子代理"');
    expect(markup).toContain("2 个子代理");
    expect(markup).toContain("前端分析");
    expect(markup).toContain("协议检查");
    expect(markup).not.toContain(">child-frontend<");
    expect(markup).not.toContain(">child-protocol<");
    expect(markup).not.toContain("检查前端实现");
    expect(markup).toContain("GPT-5.6-Sol · high");
    expect(markup).toContain('data-status="in_progress"');
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-label="查看子代理 前端分析 的输出"');
  });

  it("renders enabled MCP servers without the removed environment module", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        backgroundTerminals={[
          {
            command: "pnpm check",
            cwd: "/workspace/CodeAgent",
            id: "terminal-1",
            itemId: "command-1",
          },
        ]}
        gitStatus={gitStatus}
        mcpServers={[{ name: "fast-context" }, { name: "chrome-devtools" }]}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        skills={[
          {
            description: "Review security-sensitive changes",
            displayName: "安全审查",
            id: "skill-security",
            name: "review-security",
            scope: "repo",
          },
        ]}
        task={{
          turns: [
            {
              completedAt: "2026-07-30T10:01:00.000Z",
              error: null,
              id: "turn-1",
              items: [
                {
                  attachments: [
                    {
                      id: "attachment-1",
                      kind: "image",
                      mediaType: "image/png",
                      name: "layout.png",
                      size: 1024,
                    },
                  ],
                  id: "message-1",
                  role: "user",
                  skills: [{ name: "review-security" }, { name: "review-security" }],
                  text: "检查布局",
                  type: "message",
                },
              ],
              startedAt: "2026-07-30T10:00:00.000Z",
              status: "completed",
            },
          ],
        }}
        tab="context"
      />,
    );

    expect(markup).toContain('aria-label="MCP"');
    expect(markup).toContain("fast-context");
    expect(markup).toContain("chrome-devtools");
    expect(markup).not.toContain("gpt-5.6-sol");
    expect(markup).not.toContain("自动审批");
    expect(markup).not.toContain("工作区可写");
    expect(markup).not.toContain("思考量");
    expect(markup).not.toContain("沙盒");
    expect(markup).not.toContain("分支");
    expect(markup).toContain("/workspace/CodeAgent");
    expect(markup).toContain("项目目录");
    expect(markup).toContain("安全审查");
    expect(markup.match(/lucide-sparkles/gu)).toHaveLength(1);
    expect(markup).toContain("layout.png");
    expect(markup).not.toContain("This Mac");
    expect(markup).not.toContain("AI Elements");
    expect(markup).not.toContain("Web Design");
    expect(markup).not.toContain("添加来源");
  });

  it("renders MCP loading, error, and empty states inside the context tab", () => {
    const renderState = (
      props: Readonly<{
        mcpServers?: readonly Readonly<{ name: string }>[];
        mcpServersError?: Error;
        mcpServersPending?: boolean;
      }>,
    ) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          backgroundTerminals={[
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "terminal-1",
              itemId: "command-1",
            },
          ]}
          onReviewChanges={() => undefined}
          projectName="CodeAgent"
          projectPath="/workspace/CodeAgent"
          tab="context"
          {...props}
        />,
      );

    expect(renderState({ mcpServersPending: true })).toContain("正在读取 MCP...");
    expect(renderState({ mcpServersError: new Error("MCP unavailable") })).toContain(
      "无法读取 MCP",
    );
    expect(renderState({ mcpServers: [] })).toContain("当前任务没有可读取的 MCP");
  });
});
