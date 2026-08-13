import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  ProjectDirectoryPickerDialog,
  projectDirectoryListing,
} from "./project-directory-picker-dialog.js";

describe("ProjectDirectoryPickerDialog", () => {
  it("adapts project directory entries to the shared tree contract", () => {
    const listing: ProjectDirectoryListing = {
      entries: [{ name: "CodeAgent", path: "/workspace/CodeAgent" }],
      parentPath: "/",
      path: "/workspace",
      roots: [],
    };
    expect(projectDirectoryListing(listing).entries).toEqual([
      { name: "CodeAgent", path: "/workspace/CodeAgent", type: "directory" },
    ]);
  });

  it("renders the shared Web modal for project selection", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["host-file-picker", "directory", false, null], {
      entries: [{ name: "CodeAgent", path: "/workspace/CodeAgent", type: "directory" }],
      parentPath: "/",
      path: "/workspace",
      roots: [],
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ProjectDirectoryPickerDialog
            addError={null}
            client={{ listProjectDirectories: vi.fn() }}
            isAdding={false}
            onAdd={vi.fn()}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain("选择项目文件夹");
    expect(markup).toContain('aria-label="绝对路径"');
    expect(markup).toContain('aria-label="显示隐藏文件"');
    expect(markup).toContain("CodeAgent");
  });
});
