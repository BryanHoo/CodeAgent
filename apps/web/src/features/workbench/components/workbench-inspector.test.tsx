import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchInspector, type ProjectFileTreeDirectoryState } from "./workbench-inspector.js";

const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/review",
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
  staged: [],
  unstaged: [
    {
      diff: "--- a/src/components/app.tsx\n+++ b/src/components/app.tsx\n@@ -1,1 +1,2 @@\n-old\n+new\n+next",
      kind: "update" as const,
      path: "src/components/app.tsx",
    },
  ],
};

const taskSettings = {
  approvalPolicy: "on-request" as const,
  approvalsReviewer: "auto_review" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
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
  it("keeps running terminals in context with an accessible stop action", () => {
    const markup = renderToStaticMarkup(
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
        settings={taskSettings}
      />,
    );

    expect(markup).toContain('aria-label="运行中的终端"');
    expect(markup).toContain("pnpm dev");
    expect(markup).toContain("/workspace/CodeAgent");
    expect(markup).toContain('aria-label="停止终端 pnpm dev"');
    expect(markup).toContain('aria-label="终端运行中"');
  });

  it("integrates inline change stats with neutral review and commit actions", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        onOpenSourceFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
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
    expect(markup).toMatch(/aria-label="审核 2 个未提交变更"[^>]*class="[^"]*bg-control/u);
    expect(markup).toMatch(/aria-label="提交 2 个未提交变更"[^>]*class="[^"]*bg-control/u);
    expect(markup).not.toContain("bg-accent");
    expect(markup).toContain('aria-label="项目文件"');
    expect(markup).toContain('role="tree"');
    expect(markup).toContain("src");
    expect(markup).toContain('aria-label="展开文件夹 src"');
    expect(markup).toContain("README.md");
    expect(markup).not.toContain("components");
    expect(markup).not.toContain('aria-label="Git 变更文件"');
    expect(markup).not.toContain("未暂存");
    expect(markup).not.toContain("已暂存");
  });

  it("renders loaded directory children only while their folders are expanded", () => {
    const srcExpandedMarkup = renderToStaticMarkup(
      <WorkbenchInspector
        expandedFileTreePaths={new Set(["src"])}
        fileTreeDirectories={fileTreeDirectories}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );
    const componentsExpandedMarkup = renderToStaticMarkup(
      <WorkbenchInspector
        expandedFileTreePaths={new Set(["src", "src/components"])}
        fileTreeDirectories={fileTreeDirectories}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );

    expect(srcExpandedMarkup).toContain('aria-label="展开文件夹 components"');
    expect(srcExpandedMarkup).not.toContain("app.tsx");
    expect(componentsExpandedMarkup).toContain("app.tsx");
  });

  it("moves Git change stats from the nearest collapsed ancestor to the visible file", () => {
    const renderInspector = (expandedFileTreePaths: Set<string>) =>
      renderToStaticMarkup(
        <WorkbenchInspector
          expandedFileTreePaths={expandedFileTreePaths}
          fileTreeDirectories={fileTreeDirectories}
          gitStatus={nestedGitStatus}
          onReviewChanges={() => undefined}
          projectName="CodeAgent"
          projectPath="/workspace/CodeAgent"
          settings={taskSettings}
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
    const markup = renderToStaticMarkup(
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
        settings={taskSettings}
      />,
    );

    expect(markup).not.toContain("removed.tsx</span>");
    expect(markup).toContain('aria-label="src/components，后代新增 0 行，删除 2 行"');
    expect(markup).not.toContain('aria-label="src，后代新增 0 行，删除 2 行"');
  });

  it("renders an explicit empty state without demo files", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        onOpenSourceFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );

    expect(markup).toContain("0 个变更");
    expect(markup).toContain('aria-label="暂无未提交变更可审核"');
    expect(markup).toContain('aria-label="暂无未提交变更可提交"');
    expect(markup).toContain(">审核</button>");
    expect(markup).toContain(">提交</button>");
    expect(markup).toContain("disabled");
    expect(markup).toContain("README.md");
    expect(markup).not.toContain("workbench-shell.tsx");
  });

  it("offers a manual refresh after Git detection stops", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        fileTreeDirectories={fileTreeDirectories}
        gitStatusError={new Error("not a git repository")}
        onOpenSourceFile={() => undefined}
        onReviewChanges={() => undefined}
        onRefreshGitStatus={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );

    expect(markup).toContain("Git 变更自动检测已停止");
    expect(markup).toContain("手动刷新");
    expect(markup).toContain('aria-label="手动刷新 Git 变更"');
  });

  it("renders project file tree root loading and error states", () => {
    const loadingMarkup = renderToStaticMarkup(
      <WorkbenchInspector
        fileTreeDirectories={[{ error: null, isFetching: true, isPending: true, path: null }]}
        onOpenSourceFile={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );
    const errorMarkup = renderToStaticMarkup(
      <WorkbenchInspector
        fileTreeDirectories={[
          {
            error: new Error("unavailable"),
            isFetching: false,
            isPending: false,
            path: null,
          },
        ]}
        onOpenSourceFile={() => undefined}
        onRefreshFileTreeDirectory={() => undefined}
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
      />,
    );
    expect(loadingMarkup).toContain("正在读取项目文件...");
    expect(errorMarkup).toContain("无法读取项目文件");
    expect(errorMarkup).toContain('aria-label="重新读取项目文件"');
    expect(errorMarkup).not.toContain("仅显示前 2000 个条目");
  });

  it("lists every subagent in context and exposes output dialog triggers", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchInspector
        onReviewChanges={() => undefined}
        onOpenSubagent={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
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

  it("renders real environment settings and deduplicated task sources", () => {
    const markup = renderToStaticMarkup(
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
        onReviewChanges={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        settings={taskSettings}
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
      />,
    );

    expect(markup).toContain("gpt-5.6-sol");
    expect(markup).toContain("高");
    expect(markup).toContain("自动审批");
    expect(markup).toContain("工作区可写");
    expect(markup).toContain("/workspace/CodeAgent");
    expect(markup).toContain("feat/review");
    expect(markup).toContain("项目目录");
    expect(markup).toContain("安全审查");
    expect(markup.match(/lucide-sparkles/gu)).toHaveLength(1);
    expect(markup).toContain("layout.png");
    expect(markup).not.toContain("This Mac");
    expect(markup).not.toContain("AI Elements");
    expect(markup).not.toContain("Web Design");
    expect(markup).not.toContain("添加来源");
  });
});
