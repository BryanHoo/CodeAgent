import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { CodexRuntimeGate } from "./codex-runtime-gate.js";

const runtimeMocks = vi.hoisted(() => ({
  download: vi.fn(),
  inspect: vi.fn(),
}));

vi.mock("../../../platform/tauri/codex-runtime-manager.js", () => ({
  downloadAndInspectCodexRuntime: runtimeMocks.download,
  inspectCodexRuntime: runtimeMocks.inspect,
}));

describe("CodexRuntimeGate", () => {
  it("shows live progress while downloading the private runtime", async () => {
    await i18n.changeLanguage("en");
    runtimeMocks.inspect.mockResolvedValue({
      detectedVersion: null,
      globalInstallCommand: "npm install -g @openai/codex@0.151.0",
      requiredVersion: "0.151.0",
      status: "missing",
    });
    let reportProgress:
      | ((progress: { downloadedBytes: number; sequence: number; totalBytes: number }) => void)
      | undefined;
    runtimeMocks.download.mockImplementation(
      (
        onProgress: (progress: {
          downloadedBytes: number;
          sequence: number;
          totalBytes: number;
        }) => void,
      ) => {
        reportProgress = onProgress;
        return new Promise(() => undefined);
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <CodexRuntimeGate>
            <p>Workbench</p>
          </CodexRuntimeGate>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "Download for this app" }).click();
    expect(reportProgress).toBeDefined();
    expect(screen.getByRole("progressbar", { name: "Download progress" }).query()).toBeNull();

    reportProgress?.({ downloadedBytes: 42, sequence: 1, totalBytes: 100 });

    const progressbar = screen.getByRole("progressbar", { name: "Download progress" });
    await expect.element(progressbar).toHaveAttribute("aria-valuenow", "42");
    await expect.element(screen.getByText("42%")).toBeVisible();
  });
});
