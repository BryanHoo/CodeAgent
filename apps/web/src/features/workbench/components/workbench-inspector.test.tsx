import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMcpServer } from "@code-agent/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchInspector as WorkbenchInspectorComponent } from "./workbench-inspector.js";

function WorkbenchInspector(
  props: Omit<ComponentProps<typeof WorkbenchInspectorComponent>, "projectRootId">,
) {
  return <WorkbenchInspectorComponent {...props} projectRootId="root-code-agent" />;
}

function renderInspectorMarkup(children: ReactNode): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
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

const lightweightGitStatus = {
  ...gitStatus,
  staged: gitStatus.staged.map((change) => ({ ...change, diff: "" })),
  unstaged: gitStatus.unstaged.map((change) => ({ ...change, diff: "" })),
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

const readyMcpServer = {
  authStatus: "oAuth",
  description: "Semantic repository search",
  error: null,
  failureReason: null,
  name: "fast-context",
  status: "ready",
  title: "Fast Context",
  toolCount: 2,
  version: "1.2.0",
} as const satisfies AgentMcpServer;

function readInspectorTabLabels(markup: string): string[] {
  return [...markup.matchAll(/role="tab"[^>]*>.*?<span>([^<]+)<\/span><\/button>/gsu)].map(
    (match) => match[1] ?? "",
  );
}

describe("WorkbenchInspector", () => {
  it("mounts the headless project file tree in the project tab", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectId="project-1"
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).toContain('data-project-file-tree=""');
  });

  it("renders the latest task plan as a plain status-aware queue at the bottom of context", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        taskId="task-1"
        task={{
          plan: {
            explanation: "先打通数据链路，再完成界面验证。",
            steps: [
              { status: "completed", text: "定义计划协议" },
              { status: "in_progress", text: "接入右栏上下文" },
              { status: "pending", text: "执行完整验证" },
            ],
          },
          turns: [],
        }}
      />,
    );

    expect(markup).toContain('aria-label="计划"');
    expect(markup).toContain('data-ai-queue=""');
    expect(markup).toContain("先打通数据链路，再完成界面验证。");
    expect(markup).toMatch(/data-status="completed"[^>]*>.*定义计划协议/su);
    expect(markup).toMatch(/data-status="in_progress"[^>]*>.*接入右栏上下文/su);
    expect(markup).toMatch(/data-status="pending"[^>]*>.*执行完整验证/su);
    expect(markup).toContain('aria-label="已完成"');
    const queueClassName = /class="([^"]*)" data-ai-queue=""/u.exec(markup)?.[1];
    expect(queueClassName).toBeDefined();
    expect(queueClassName).not.toMatch(/\b(?:rounded-surface|border|bg-panel|shadow-sm)\b/u);
    expect(markup.indexOf('aria-label="计划"')).toBeGreaterThan(
      markup.indexOf('aria-label="上下文来源"'),
    );
  });

  it("renders temporary task context directly without tabs or Project sources", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        contextOnly
        mcpServers={[readyMcpServer]}
        projectName="临时任务"
        projectPath=""
      />,
    );

    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain("项目目录");
    expect(markup).toContain('aria-label="MCP"');
    expect(markup).toContain("fast-context");
    expect(markup).not.toContain("Semantic repository search");
    expect(markup).toContain('aria-label="上下文来源"');
  });

  it("renders per-server MCP loading and ready states without provider descriptions", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        contextOnly
        mcpServers={[
          { ...readyMcpServer, name: "context7", status: "starting", toolCount: 0 },
          readyMcpServer,
        ]}
        projectName="临时任务"
        projectPath=""
      />,
    );

    expect(markup).toContain("context7");
    expect(markup).toContain("正在启动");
    expect(markup).toContain("fast-context");
    expect(markup).toContain("已就绪");
    expect(markup).not.toContain("Semantic repository search");
  });

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
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );

    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">项目</span></button>");
    expect(markup).not.toContain('aria-label="运行中的终端"');
    expect(markup).not.toContain("pnpm dev");
  });

  it("renders the uncommitted change summary in context and removes it from project", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        gitStatus={lightweightGitStatus}
        gitStatusDetails={gitStatus}
        tab="context"
        taskId="task-1"
      />,
    );
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={lightweightGitStatus}
        gitStatusDetails={gitStatus}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="project"
        taskId="task-1"
      />,
    );

    expect(markup).toContain("2 个变更");
    expect(markup).toContain('aria-label="未提交变更"');
    expect(markup).toContain('aria-label="变更统计"');
    expect(markup).toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).toContain(">提交</button>");
    expect(markup).toMatch(
      /aria-label="变更统计"[^>]*><span>2 个变更<\/span><span[^>]*>\+3<\/span><span[^>]*>-1<\/span>/u,
    );
    expect(markup).toContain(
      'aria-label="变更统计" class="flex min-h-6 items-center gap-1.5 px-2 text-caption text-muted-foreground"',
    );
    expect(markup).not.toContain('aria-label="变更文件导航"');
    expect(markup).not.toContain('aria-label="package.json，新增 2 行，删除 1 行"');
    expect(markup).not.toContain('aria-label="new-file.ts，新增 1 行，删除 0 行"');
    expect(projectMarkup).not.toContain('aria-label="未提交变更"');
    expect(projectMarkup).not.toContain('aria-label="变更统计"');
    expect(projectMarkup).not.toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).not.toContain("bg-brand");
    expect(markup).toContain('aria-label="运行环境"');
    expect(markup).not.toContain(">运行环境</h2>");
    expect(markup).not.toContain("grid-cols-2");
    const selectedTabClassName =
      /class="([^"]*)"[^>]*data-variant="ghost"[^>]*aria-selected="true"/u.exec(markup)?.[1];
    expect(selectedTabClassName).toBeDefined();
    expect(selectedTabClassName?.split(" ")).toContain("bg-control-hover");
    expect(selectedTabClassName?.split(" ")).toContain("text-foreground");
    expect(markup).not.toContain("shadow-toolbar");
    expect(markup).toContain("lucide-braces");
    expect(projectMarkup).toContain("lucide-folder-tree");
    expect(markup).toContain(">项目</span></button>");
    expect(markup).toContain(">变更</span></button>");
    expect(markup).toContain(">历史</span></button>");
    expect(markup).toContain(">上下文</span></button>");
    expect(projectMarkup).toContain('aria-label="项目文件"');
    expect(projectMarkup).toContain(">CodeAgent</span>");
    expect(projectMarkup).toContain('data-project-file-tree=""');
    expect(markup).not.toContain('aria-label="Git 变更文件"');
    expect(markup).not.toContain("未暂存");
    expect(markup).not.toContain("已暂存");

    expect(markup).not.toContain(">项目文件</span>");
  });

  it("orders tabs by context, project, changes and history when all are available", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={lightweightGitStatus}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(markup)).toEqual(["上下文", "项目", "变更", "历史"]);
    expect(markup).toContain("lucide-braces");
    expect(markup).toContain('data-size="toolbar"');
  });

  it("shows Git tabs only for repositories and hides changes for a clean worktree", () => {
    const cleanGitStatus = { ...gitStatus, staged: [], unstaged: [] };
    const cleanMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={cleanGitStatus}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="changes"
        taskId="task-1"
      />,
    );
    const nonGitMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={{ ...cleanGitStatus, repositoryMode: "none" }}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        taskId="task-1"
      />,
    );

    expect(readInspectorTabLabels(cleanMarkup)).toEqual(["上下文", "项目", "历史"]);
    expect(cleanMarkup).toMatch(/aria-selected="true"[^>]*>.*?<span>项目<\/span>/su);
    expect(readInspectorTabLabels(nonGitMarkup)).toEqual(["上下文", "项目"]);
  });

  it("shows the commit entry for immediate child Git repositories", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={{ ...gitStatus, repositoryMode: "children" }}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        taskId="task-1"
      />,
    );
    const commitButton = /<button[^>]*id="workbench-commit-changes"[^>]*>/u.exec(markup)?.[0];

    expect(commitButton).toBeDefined();
    expect(commitButton).not.toContain(' disabled=""');
  });

  it("shows only aggregate Git change stats in context", () => {
    const renderInspector = (expandedFileTreePaths: Set<string>) =>
      renderInspectorMarkup(
        <WorkbenchInspector
          expandedFileTreePaths={expandedFileTreePaths}
          gitStatus={nestedGitStatus}
          projectName="CodeAgent"
          projectPath="/workspace/CodeAgent"
          tab="context"
          taskId="task-1"
        />,
      );

    const fileVisibleMarkup = renderInspector(new Set(["src", "src/components"]));

    expect(fileVisibleMarkup).toMatch(
      /aria-label="变更统计"[^>]*><span>1 个变更<\/span><span[^>]*>\+2<\/span><span[^>]*>-1<\/span>/u,
    );
    expect(fileVisibleMarkup).not.toContain("后代新增");
    expect(fileVisibleMarkup).not.toContain('aria-label="变更文件导航"');
    expect(fileVisibleMarkup).not.toContain("src/components/app.tsx");
  });

  it("omits the uncommitted changes module when the working tree is clean", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        taskId="task-1"
      />,
    );
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="project"
      />,
    );

    expect(markup).not.toContain('aria-label="未提交变更"');
    expect(markup).not.toContain(">审核</button>");
    expect(markup).not.toContain(">提交</button>");
    expect(markup).not.toContain(">项目文件</span>");
    expect(projectMarkup).toContain(">CodeAgent</span>");
    expect(markup).not.toContain("workbench-shell.tsx");
    expect(markup).not.toContain('id="workbench-git-history"');
    expect(markup).not.toContain('aria-label="查看 Git 历史"');
  });

  it("shows a non-blocking retry status and offers a manual refresh after Git detection fails", () => {
    const projectMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={gitStatus}
        gitStatusError={new Error("not a git repository")}
        onOpenProjectFile={() => undefined}
        onRefreshGitStatus={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );
    const contextMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        gitStatus={gitStatus}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        taskId="task-1"
      />,
    );

    expect(projectMarkup).toContain("Git 变更刷新失败，正在自动重试");
    expect(contextMarkup).toContain("2 个变更");
    expect(projectMarkup).toContain("手动刷新");
    expect(projectMarkup).toContain('aria-label="手动刷新 Git 变更"');
  });

  it("renders the project file tree root loading state", () => {
    const loadingMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        onOpenProjectFile={() => undefined}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
      />,
    );
    expect(loadingMarkup).toContain('aria-label="正在读取项目文件..."');
    expect(loadingMarkup).toContain("CodeAgent");
    expect(loadingMarkup).toContain("animate-spin");
  });

  it("lists every subagent in context and exposes output dialog triggers", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
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
        taskId="task-1"
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
        mcpServers={[
          readyMcpServer,
          { ...readyMcpServer, authStatus: "unsupported", name: "chrome-devtools" },
          { ...readyMcpServer, authStatus: "unknown", name: "remote-context" },
        ]}
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
        taskId="task-1"
      />,
    );

    expect(markup).toContain('aria-label="MCP"');
    expect(markup).toContain("fast-context");
    expect(markup).toContain("chrome-devtools");
    expect(markup).toContain("remote-context");
    expect(markup).toContain("已就绪");
    expect(markup).toContain("2 个工具");
    expect(markup).toContain("OAuth");
    expect(markup).toContain("认证状态未知");
    expect(markup).toContain("版本 1.2.0");
    expect(markup).toContain('aria-label="重新加载 MCP"');
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
    expect(markup).not.toContain("项目 Agent 组件");
    expect(markup).not.toContain("Web Design");
    expect(markup).not.toContain("添加来源");
  });

  it("reuses timeline image preview and file download actions for attachment sources", () => {
    const markup = renderInspectorMarkup(
      <WorkbenchInspector
        projectId="project one"
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        task={{
          turns: [
            {
              completedAt: "2026-08-11T10:01:00.000Z",
              error: null,
              id: "turn-1",
              items: [
                {
                  attachments: [
                    {
                      id: "image/1",
                      kind: "image",
                      mediaType: "image/png",
                      name: "layout.png",
                      size: 1024,
                    },
                    {
                      id: "text/1",
                      kind: "text",
                      mediaType: "text/plain",
                      name: "notes.txt",
                      size: 128,
                    },
                    {
                      id: "file/1",
                      kind: "file",
                      mediaType: "application/pdf",
                      name: "report.pdf",
                      size: 2048,
                    },
                  ],
                  id: "message-1",
                  role: "user",
                  text: "检查附件",
                  type: "message",
                },
              ],
              startedAt: "2026-08-11T10:00:00.000Z",
              status: "completed",
            },
          ],
        }}
        taskId="task/1"
      />,
    );

    expect(markup).toContain('aria-label="查看图片 layout.png"');
    expect(markup).toContain('data-message-attachment="image"');
    expect(markup).toContain('aria-label="打开附件 notes.txt"');
    expect(markup).toContain('data-attachment-open="source"');
    expect(markup).toContain('aria-label="打开附件 report.pdf"');
    expect(markup).toContain('data-attachment-open="system"');
    expect(markup).not.toContain(" download=");
    expect(markup).not.toContain('aria-label="下载附件');
  });

  it("renders MCP loading, error, and empty states inside the context tab", () => {
    const renderState = (
      props: Readonly<{
        mcpServers?: readonly AgentMcpServer[];
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
          projectName="CodeAgent"
          projectPath="/workspace/CodeAgent"
          tab="context"
          taskId="task-1"
          {...props}
        />,
      );

    expect(renderState({ mcpServersPending: true })).toContain("正在读取 MCP...");
    const errorMarkup = renderState({ mcpServersError: new Error("MCP unavailable") });
    expect(errorMarkup).toContain("无法读取 MCP");
    expect(errorMarkup).toContain("MCP unavailable");
    expect(errorMarkup).not.toContain("查看错误日志");
    const retryErrorMarkup = renderInspectorMarkup(
      <WorkbenchInspector
        mcpServersError={new Error("mcpServerStatus/list failed")}
        projectName="CodeAgent"
        projectPath="/workspace/CodeAgent"
        tab="context"
        taskId="task-1"
      />,
    );
    expect(retryErrorMarkup).toContain("无法读取 MCP");
    expect(retryErrorMarkup).toContain("mcpServerStatus/list failed");
    expect(retryErrorMarkup).not.toContain("重新加载 MCP 失败");
    const failedMarkup = renderState({
      mcpServers: [
        {
          authStatus: null,
          description: null,
          error: "MCP startup timed out after 10s\nProcess exited with code 1",
          failureReason: "reauthenticationRequired",
          name: "docs",
          status: "failed",
          title: null,
          toolCount: 0,
          version: null,
        },
      ],
    });
    expect(failedMarkup).toContain("启动失败");
    expect(failedMarkup).toContain("需要重新认证");
    expect(failedMarkup).toContain("查看错误日志");
    expect(failedMarkup).toContain("MCP startup timed out after 10s");
    expect(renderState({ mcpServers: [] })).toContain("当前任务没有可读取的 MCP");
  });
});
