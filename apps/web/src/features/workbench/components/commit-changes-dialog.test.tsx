import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/ui/tooltip.js";
import { CommitChangesDialog, collectCommitFileEntries } from "./commit-changes-dialog.js";

function renderCommitDialog(children: ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/commit",
  repositoryMode: "root" as const,
  snapshot: "a".repeat(64),
  staged: [{ diff: "+staged", kind: "update" as const, path: "src/app.ts" }],
  unstaged: [
    { diff: "+unstaged", kind: "update" as const, path: "src/app.ts" },
    { diff: "+new", kind: "create" as const, path: "src/new.ts" },
  ],
};

describe("CommitChangesDialog", () => {
  it("deduplicates paths and keeps the default file selection collapsed", () => {
    expect(collectCommitFileEntries(gitStatus)).toEqual([
      { path: "src/app.ts", staged: true, unstaged: true },
      { path: "src/new.ts", staged: false, unstaged: true },
    ]);

    const markup = renderCommitDialog(
      <CommitChangesDialog
        gitStatus={gitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
      />,
    );

    expect(markup).toContain('aria-labelledby="commit-changes-title"');
    expect(markup).toContain('aria-controls="commit-file-list"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="选择文件，已选择 2/2 个文件"');
    expect(markup).toContain("已选择 2 个文件");
    // 折叠态只保留一行摘要，文件明细和复选框按需渲染。
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("src/app.ts");
    expect(markup).not.toContain("已暂存");
    expect(markup).toContain("生成 message");
    expect(markup).toContain('id="commit-message"');
    expect(markup).toContain(">提交</button>");
    expect(markup).toContain("提交并推送");
    expect(markup).toMatch(/data-variant="default"[^>]*disabled=""[^>]*type="button"/u);
  });

  it("disables commit actions for aggregated child repositories", () => {
    const markup = renderCommitDialog(
      <CommitChangesDialog
        gitStatus={{ ...gitStatus, repositoryMode: "children" }}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
      />,
    );

    expect(markup).toContain("当前项目包含多个子仓库，暂不支持跨仓库提交");
    expect(markup).toMatch(/>生成 message<\/button>/u);
    expect(markup).toMatch(/disabled="" type="button">.*生成 message<\/button>/u);
  });

  it("shows commit success even when push fails", () => {
    const markup = renderCommitDialog(
      <CommitChangesDialog
        gitStatus={gitStatus}
        onClose={() => undefined}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        result={{
          branch: "feat/commit",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: "feat(git): 提交选择文件",
          pushStatus: "failed",
        }}
      />,
    );

    expect(markup).toContain("提交已完成，但推送失败");
    expect(markup).toContain("0123456");
  });
});
