import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { HostFilePickerDialog } from "./host-file-picker-dialog.js";
import { flattenHostFilePickerRows } from "./host-file-picker-tree.js";

describe("HostFilePickerDialog", () => {
  it("renders the shared absolute path toolbar with hidden files disabled", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["host-file-picker", "directory", false, null], {
      entries: [{ name: "CodeAgent", path: "/Users/bryan/CodeAgent", type: "directory" }],
      parentPath: "/Users",
      path: "/Users/bryan",
      roots: [],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HostFilePickerDialog
            error={null}
            isConfirming={false}
            loadDirectory={vi.fn()}
            mode="directory"
            onClose={vi.fn()}
            onConfirm={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('aria-label="绝对路径"');
    expect(markup).toContain('value="/Users/bryan"');
    expect(markup).toContain('aria-label="显示隐藏文件"');
    expect(markup).toContain('role="tree"');
  });

  it("flattens only expanded branches and virtualizes large visible directories", async () => {
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      name: `folder-${String(index)}`,
      path: `/workspace/folder-${String(index)}`,
      type: "directory" as const,
    }));
    const rows = flattenHostFilePickerRows(
      { entries, parentPath: "/", path: "/workspace", roots: [] },
      new Map(),
      new Set(),
    );
    expect(rows).toHaveLength(1_000);

    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["host-file-picker", "directory", false, null], {
      entries,
      parentPath: "/",
      path: "/workspace",
      roots: [],
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HostFilePickerDialog
            error={null}
            isConfirming={false}
            loadDirectory={vi.fn()}
            mode="directory"
            onClose={vi.fn()}
            onConfirm={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(markup).toContain("folder-0");
    expect(markup).not.toContain("folder-999");
  });
});
