import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";

describe("HostAttachmentPickerDialog", () => {
  it.each([
    ["file" as const, "选择本机文件", "notes.txt"],
    ["image" as const, "选择本机图片", "screen.png"],
  ])("renders the shared Web modal for %s selection", async (kind, title, name) => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["host-file-picker", kind, false, null], {
      entries: [{ name, path: `/Users/bryan/${name}`, type: "file" }],
      parentPath: "/Users",
      path: "/Users/bryan",
      roots: [],
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HostAttachmentPickerDialog
            client={{ importHostAttachment: vi.fn(), listHostFiles: vi.fn() }}
            kind={kind}
            onAdd={vi.fn()}
            onClose={vi.fn()}
            projectId="code-agent"
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain(title);
    expect(markup).toContain('aria-label="绝对路径"');
    expect(markup).toContain('aria-label="显示隐藏文件"');
    expect(markup).toContain(name);
  });
});
