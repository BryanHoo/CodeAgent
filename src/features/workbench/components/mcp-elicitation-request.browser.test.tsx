import type { PendingRequest } from "@/protocol/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpElicitationRequestCard } from "./mcp-elicitation-request.js";

vi.mock("../../../platform/tauri/external-url.js", () => ({
  openExternalUrl: vi.fn(),
}));

const urlRequest = {
  createdAt: "2026-08-30T01:00:00.000Z",
  expiresAt: null,
  itemId: "mcp-elicitation:request-1",
  message: "完成账户授权",
  mode: "url",
  projectId: "codeagent",
  requestId: "request-1",
  serverName: "docs",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "mcp_elicitation",
  url: "https://auth.example.com/oauth/authorize?client_id=codeagent",
} as const satisfies PendingRequest;

function TestProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nextProvider>
  );
}

describe("MCP URL elicitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays the destination and resolves only after the system browser opens", async () => {
    await i18n.changeLanguage("zh-CN");
    let finishOpen: (() => void) | undefined;
    vi.mocked(openExternalUrl).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={onResolve}
          request={urlRequest}
        />
      </TestProviders>,
    );

    await expect.element(screen.getByText("auth.example.com", { exact: true })).toBeVisible();
    await expect.element(screen.getByText(urlRequest.url, { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "同意并打开链接" }).click();

    expect(openExternalUrl).toHaveBeenCalledWith(urlRequest.url);
    expect(onResolve).not.toHaveBeenCalled();
    finishOpen?.();
    await vi.waitFor(() => {
      expect(onResolve).toHaveBeenCalledOnce();
    });
    expect(onResolve.mock.calls[0]?.[1]).toEqual({ action: "accept" });
  });

  it("does not resolve when opening the system browser fails", async () => {
    await i18n.changeLanguage("zh-CN");
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("open failed"));
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={onResolve}
          request={urlRequest}
        />
      </TestProviders>,
    );

    await screen.getByRole("button", { name: "同意并打开链接" }).click();
    await vi.waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith(urlRequest.url);
    });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("disables navigation for non-Web URL protocols", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <TestProviders>
        <McpElicitationRequestCard
          interactive
          onResolve={vi.fn().mockResolvedValue(undefined)}
          request={{ ...urlRequest, url: "javascript:alert(document.domain)" }}
        />
      </TestProviders>,
    );

    await expect.element(screen.getByText("URL 无效，无法打开")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "同意并打开链接" })).toBeDisabled();
  });
});
