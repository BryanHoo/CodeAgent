import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GitHistoryDialog } from "./git-history-dialog.js";
import { GitHistoryContent } from "./git-history-list.js";

function renderDialog(page: {
  branch: string | null;
  commits: readonly {
    authoredAt: string;
    authorEmail: string;
    authorName: string;
    sha: string;
    title: string;
  }[];
  nextCursor: string | null;
  repositories: readonly string[];
  repository: string | null;
  repositoryMode: "children" | "root";
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["projects", "code-agent", "git-history", null], {
    pageParams: [undefined],
    pages: [page],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <GitHistoryDialog
        client={{
          getProjectGitCommitFileDiff: vi.fn(),
          getProjectGitCommitFiles: vi.fn(),
          getProjectGitHistory: vi.fn(),
        }}
        onClose={() => undefined}
        projectId="code-agent"
      />
    </QueryClientProvider>,
  );
}

describe("GitHistoryDialog", () => {
  it("renders reusable history content without a dialog shell", () => {
    const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const markup = renderToStaticMarkup(
      <GitHistoryContent
        active
        dateFormatter={dateFormatter}
        panelId="embedded-history"
        onSelectCommit={() => undefined}
        query={{
          data: {
            pages: [
              {
                branch: "main",
                commits: [
                  {
                    authoredAt: "2026-08-06T08:30:00+08:00",
                    authorEmail: "developer@example.com",
                    authorName: "Developer",
                    sha: "d".repeat(40),
                    title: "refactor(git): 复用历史列表",
                  },
                ],
                nextCursor: null,
                repositories: [],
                repository: null,
                repositoryMode: "root",
              },
            ],
          },
          error: null,
          fetchNextPage: () => undefined,
          hasNextPage: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: () => undefined,
        }}
      />,
    );

    expect(markup).toContain('id="embedded-history"');
    expect(markup).toContain("refactor(git): 复用历史列表");
    expect(markup).toContain("dddddddddddd");
    expect(markup).toContain("已加载全部提交");
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain('data-slot="dialog-content"');
  });

  it("shows child repositories and keeps pagination inside the history content", () => {
    const markup = renderDialog({
      branch: "feat/apps-web",
      commits: [
        {
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: "a".repeat(40),
          title: "feat(git): 添加历史记录",
        },
      ],
      nextCursor: "20",
      repositories: ["apps/web", "packages/server"],
      repository: "apps/web",
      repositoryMode: "children",
    });

    expect(markup).toContain('aria-labelledby="git-history-title"');
    expect(markup).toContain('data-slot="sheet-content"');
    expect(markup).not.toContain('data-slot="dialog-content"');
    expect(markup).toContain("当前分支：feat/apps-web");
    expect(markup).toContain('aria-label="子仓库"');
    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>apps\/web<\/button>/u);
    expect(markup).toMatch(/aria-selected="false"[^>]*role="tab"[^>]*>packages\/server<\/button>/u);
    expect(markup).toContain("feat(git): 添加历史记录");
    expect(markup).toContain("Developer");
    expect(markup).toContain("aaaaaaaaaaaa");
    expect(markup).toMatch(/lucide-history[^>]*size-4 shrink-0/u);
    expect(markup).toContain(">加载更多</button>");
    expect(markup).not.toContain("<footer");
    expect(markup).toMatch(/<\/ol><div[^>]*>[\s\S]*>加载更多<\/button><\/div>/u);
  });

  it("shows pagination for a single repository", () => {
    const markup = renderDialog({
      branch: "main",
      commits: [
        {
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: "b".repeat(40),
          title: "fix(git): 修复分页布局",
        },
      ],
      nextCursor: "20",
      repositories: [],
      repository: null,
      repositoryMode: "root",
    });

    expect(markup).not.toContain('aria-label="子仓库"');
    expect(markup).toContain('data-slot="git-history-content"');
    expect(markup).toMatch(/<\/ol><div[^>]*>[\s\S]*>加载更多<\/button><\/div>/u);
  });

  it("shows an end-of-history message after the final commit", () => {
    const markup = renderDialog({
      branch: null,
      commits: [
        {
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: "c".repeat(40),
          title: "docs(git): 更新历史说明",
        },
      ],
      nextCursor: null,
      repositories: [],
      repository: null,
      repositoryMode: "root",
    });

    expect(markup).toMatch(/<\/ol><div[^>]*>[\s\S]*已加载全部提交[\s\S]*<\/div>/u);
  });

  it("shows an empty state for a repository without commits", () => {
    const markup = renderDialog({
      branch: "main",
      commits: [],
      nextCursor: null,
      repositories: [],
      repository: null,
      repositoryMode: "root",
    });

    expect(markup).toContain("当前仓库暂无提交记录");
    expect(markup).not.toContain('aria-label="子仓库"');
    expect(markup).not.toContain(">加载更多</button>");
  });
});
