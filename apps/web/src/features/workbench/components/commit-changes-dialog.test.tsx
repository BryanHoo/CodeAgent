import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  CommitChangesDialog,
  collectCommitFileEntries,
  collectCommitRepositories,
} from "./commit-changes-dialog.js";
import { buildCommitChangeTree } from "./commit-changes-tree.js";

function renderCommitDialog(children: ReactNode): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const repository of [null, "frontend"] as const) {
    queryClient.setQueryData(["projects", "code-agent", "git-history", repository], {
      pageParams: [undefined],
      pages: [
        {
          branch: "feat/commit",
          commits: [
            {
              authoredAt: "2026-08-06T08:30:00+08:00",
              authorEmail: "developer@example.com",
              authorName: "Developer",
              sha: "e".repeat(40),
              title: "feat(git): 集成提交历史",
            },
          ],
          nextCursor: null,
          repositories: [],
          repository,
          repositoryMode: "root",
        },
      ],
    });
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const historyProps = {
  client: { getProjectGitHistory: () => Promise.reject(new Error("unexpected history fetch")) },
  commitReviewOpen: false,
  onOpenFileDiff: () => undefined,
  onSelectCommit: () => undefined,
  projectId: "code-agent",
} as const;

const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/commit",
  branches: ["feat/commit", "main"],
  repositoryMode: "root" as const,
  snapshot: "a".repeat(64),
  staged: [{ diff: "+staged", kind: "update" as const, path: "src/app.ts" }],
  unstaged: [
    { diff: "+unstaged", kind: "update" as const, path: "src/app.ts" },
    { diff: "+new", kind: "create" as const, path: "src/new.ts" },
  ],
};

describe("CommitChangesDialog", () => {
  it("builds stable nested folders for changed paths", () => {
    expect(
      buildCommitChangeTree([
        { diff: "+app", kind: "update", path: "src/app.ts" },
        { diff: "+button", kind: "create", path: "src/components/button.tsx" },
        { diff: "-readme", kind: "delete", path: "README.md" },
      ]),
    ).toEqual([
      { kind: "file", name: "README.md", path: "README.md", status: "delete" },
      {
        children: [
          { kind: "file", name: "app.ts", path: "src/app.ts", status: "update" },
          {
            children: [
              {
                kind: "file",
                name: "button.tsx",
                path: "src/components/button.tsx",
                status: "create",
              },
            ],
            kind: "folder",
            name: "components",
            path: "src/components",
          },
        ],
        kind: "folder",
        name: "src",
        path: "src",
      },
    ]);
  });

  it("compacts folder chains without direct files like the review tree", () => {
    expect(
      buildCommitChangeTree([
        { diff: "+server", kind: "create", path: "packages/server/src/index.ts" },
        { diff: "+web", kind: "create", path: "apps/web/src/main.tsx" },
      ]),
    ).toEqual([
      {
        children: [
          { kind: "file", name: "main.tsx", path: "apps/web/src/main.tsx", status: "create" },
        ],
        kind: "folder",
        name: "apps/web/src",
        path: "apps/web/src",
      },
      {
        children: [
          {
            kind: "file",
            name: "index.ts",
            path: "packages/server/src/index.ts",
            status: "create",
          },
        ],
        kind: "folder",
        name: "packages/server/src",
        path: "packages/server/src",
      },
    ]);
  });

  it("deduplicates commit paths and renders staged and unstaged trees in a right sheet", () => {
    expect(collectCommitFileEntries(gitStatus)).toEqual([
      { path: "src/app.ts", staged: true, unstaged: true },
      { path: "src/new.ts", staged: false, unstaged: true },
    ]);

    const markup = renderCommitDialog(
      <CommitChangesDialog
        {...historyProps}
        gitStatus={gitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
      />,
    );

    expect(markup).toContain('aria-labelledby="commit-changes-title"');
    expect(markup).toContain('data-slot="sheet-content"');
    expect(markup).toContain("inset-y-0 right-0");
    const headerMarkup = /<header[^>]*>[\s\S]*?<\/header>/u.exec(markup)?.[0] ?? "";
    expect(headerMarkup).not.toContain("feat/commit");
    expect(markup).toContain('aria-label="已暂存"');
    expect(markup).toContain('aria-label="未暂存"');
    expect(markup.match(/data-ai-file-tree=""/gu)).toHaveLength(2);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("src/app.ts");
    expect(markup).not.toContain("已选择 2 个文件");
    expect(markup).not.toMatch(/<label[^>]*for="commit-message"/u);
    expect(markup).toContain('data-slot="checkbox"');
    expect(markup).toContain("已暂存");
    expect(markup).toContain("未暂存");
    expect(markup).toContain('aria-label="生成 message 信息"');
    expect(markup).not.toContain(">生成 message</button>");
    expect(markup).toContain('data-slot="input-group"');
    expect(markup).toContain('data-slot="input-group-control"');
    expect(markup).toMatch(/<textarea[^>]*id="commit-message"[^>]*rows="1"/u);
    expect(markup).toContain(">提交</button>");
    expect(markup).toContain('aria-label="选择提交方式"');
    expect(markup).toMatch(/data-variant="default"[^>]*disabled=""[^>]*type="button"/u);
    expect(markup).toContain('data-slot="commit-sheet-body"');
    expect(markup).toContain('data-slot="commit-changes-scroll"');
    expect(markup).toContain('data-slot="commit-history-scroll"');
    expect(markup.match(/data-slot="collapsible-trigger"/gu)).toHaveLength(2);
    expect(markup).not.toContain("lucide-history");
    const historyBranchMarkup = /<span[^>]*title="feat\/commit"[^>]*>feat\/commit<\/span>/u.exec(
      markup,
    )?.[0];
    expect(historyBranchMarkup).toContain('aria-hidden="true"');
    expect(historyBranchMarkup).toContain("ml-auto");
    expect(markup).not.toContain("当前分支：feat/commit");
    expect(markup).toContain("feat(git): 集成提交历史");
  });

  it("hides empty change groups and colors file names by Git status", () => {
    const markup = renderCommitDialog(
      <CommitChangesDialog
        {...historyProps}
        gitStatus={{
          ...gitStatus,
          staged: [],
          unstaged: [
            { diff: "+new", kind: "create", path: "src/new.ts" },
            { diff: "+changed", kind: "update", path: "src/app.ts" },
            { diff: "-removed", kind: "delete", path: "src/old.ts" },
          ],
        }}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
      />,
    );

    expect(markup).not.toContain('aria-label="已暂存"');
    expect(markup.match(/data-ai-file-tree=""/gu)).toHaveLength(1);
    expect(
      /<div[^>]*class="[^"]*text-diff-added[^"]*"[^>]*aria-label="src\/new\.ts"[^>]*>/u.exec(
        markup,
      )?.[0],
    ).toBeDefined();
    expect(
      /<div[^>]*class="[^"]*text-warning[^"]*"[^>]*aria-label="src\/app\.ts"[^>]*>/u.exec(
        markup,
      )?.[0],
    ).toBeDefined();
    expect(
      /<div[^>]*class="[^"]*text-danger[^"]*"[^>]*aria-label="src\/old\.ts"[^>]*>/u.exec(
        markup,
      )?.[0],
    ).toBeDefined();
    expect(markup.indexOf('aria-label="未暂存: src/new.ts"')).toBeLessThan(
      markup.indexOf('title="src/new.ts">new.ts'),
    );
  });

  it("requires selecting a child repository before showing commit controls", () => {
    const childGitStatus = {
      ...gitStatus,
      repositoryMode: "children" as const,
      staged: [{ diff: "+staged", kind: "update" as const, path: "backend/src/server.ts" }],
      unstaged: [{ diff: "+unstaged", kind: "update" as const, path: "frontend/src/app.ts" }],
    };
    expect(collectCommitRepositories(childGitStatus)).toEqual(["backend", "frontend"]);

    const markup = renderCommitDialog(
      <CommitChangesDialog
        {...historyProps}
        gitStatus={childGitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        onSelectRepository={() => undefined}
        repositories={["backend", "frontend"]}
        selectedRepository={null}
      />,
    );

    expect(markup).toContain("选择 Git 项目");
    expect(markup).not.toContain("当前项目包含多个子仓库，暂不支持跨仓库提交");
    expect(markup).not.toContain('id="commit-message"');
    expect(markup).not.toContain(">提交并推送</button>");
  });

  it("shows repository-local changes after a child repository is selected", () => {
    const markup = renderCommitDialog(
      <CommitChangesDialog
        {...historyProps}
        gitStatus={gitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        onSelectRepository={() => undefined}
        repositories={["backend", "frontend"]}
        selectedRepository="frontend"
      />,
    );

    expect(markup).toContain('aria-labelledby="commit-repository-label"');
    expect(markup).toContain('id="commit-message"');
    expect(markup).toContain('aria-label="选择提交方式"');
  });

  it("shows commit success even when push fails", () => {
    const markup = renderCommitDialog(
      <CommitChangesDialog
        {...historyProps}
        gitStatus={gitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        result={{
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: "feat(git): 提交选择文件",
          pushError: {
            code: "provider_failure",
            message: "remote: Permission to repository denied",
          },
          pushStatus: "failed",
        }}
      />,
    );

    expect(markup).toContain("提交已完成");
    expect(markup).not.toContain("提交已完成，但推送失败");
    expect(markup).not.toContain("remote: Permission to repository denied");
    expect(markup).toContain("0123456");
  });
});
