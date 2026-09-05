import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { CodexRuntimeGate } from "./codex-runtime-gate.js";

const runtimeMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  download: vi.fn(),
  inspect: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("../../../platform/tauri/runtime.js", () => ({
  connectCodexRuntime: runtimeMocks.connect,
}));

vi.mock("../../../platform/tauri/codex-runtime-manager.js", () => ({
  downloadAndInspectCodexRuntime: runtimeMocks.download,
  inspectCodexRuntime: runtimeMocks.inspect,
}));

vi.mock("sonner", () => ({ toast: { warning: runtimeMocks.warning } }));

describe("CodexRuntimeGate", () => {
  beforeEach(() => {
    runtimeMocks.connect.mockReset().mockResolvedValue({ status: "idle", lastSeq: 0, provider: null });
    runtimeMocks.download.mockReset();
    runtimeMocks.inspect.mockReset();
    runtimeMocks.warning.mockReset();
  });

  it("restores the workbench without inspecting a runtime that stayed ready in the background", async () => {
    runtimeMocks.connect.mockResolvedValue({ status: "ready", lastSeq: 8, provider: "codex" });
    runtimeMocks.inspect.mockResolvedValue({
      detectedVersion: "0.153.4",
      globalInstallCommand: "npm install -g @openai/codex@0.153.4",
      requiredVersion: "0.153.4",
      status: "compatible",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
      </QueryClientProvider>,
    );

    await expect.element(screen.getByText("Workbench")).toBeVisible();
    expect(runtimeMocks.inspect).not.toHaveBeenCalled();
  });

  it("does not show version detection while reconnecting to the background", async () => {
    runtimeMocks.connect.mockImplementation(() => new Promise(() => undefined));
    runtimeMocks.inspect.mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CodexRuntimeGate><p>Workbench</p></CodexRuntimeGate>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status").query()).toBeNull();
  });

  it("shows staged progress while updating a managed runtime on startup", async () => {
    await i18n.changeLanguage("en");
    let reportProgress:
      | ((progress: {
          currentVersion: string;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
          totalBytes: number | null;
        }) => void)
      | undefined;
    runtimeMocks.inspect.mockImplementation(
      (onProgress: NonNullable<typeof reportProgress>) => {
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

    await vi.waitFor(() => expect(reportProgress).toBeDefined());
    reportProgress?.({
      currentVersion: "0.150.0",
      downloadedBytes: 0,
      phase: "preparing",
      sequence: 1,
      targetVersion: "0.153.4",
      totalBytes: null,
    });

    await expect.element(screen.getByRole("heading", { name: "Updating Codex" })).toBeVisible();
    const progressbar = screen.getByRole("progressbar", { name: "Codex update progress" });
    const progressFill = progressbar.element().firstElementChild;
    expect(progressFill).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(progressFill as HTMLElement).width).toBe("0px");

    reportProgress?.({
      currentVersion: "0.150.0",
      downloadedBytes: 42,
      phase: "downloading",
      sequence: 2,
      targetVersion: "0.153.4",
      totalBytes: 100,
    });

    await expect.element(screen.getByText("0.150.0")).toBeVisible();
    await expect.element(screen.getByText("0.153.4")).toBeVisible();
    await expect
      .element(progressbar)
      .toHaveAttribute("aria-valuenow", "42");
  });

  it("keeps the workbench available and offers retry after an automatic update fails", async () => {
    await i18n.changeLanguage("en");
    runtimeMocks.inspect
      .mockImplementationOnce(
        async (
          onProgress: (progress: {
            currentVersion: string;
            downloadedBytes: number;
            phase: string;
            sequence: number;
            targetVersion: string;
            totalBytes: number | null;
          }) => void,
        ) => {
          onProgress({
            currentVersion: "0.150.0",
            downloadedBytes: 24,
            phase: "failed",
            sequence: 3,
            targetVersion: "0.153.4",
            totalBytes: 100,
          });
          return {
            detectedVersion: "0.150.0",
            globalInstallCommand: "npm install -g @openai/codex@0.153.4",
            requiredVersion: "0.153.4",
            status: "compatible",
          };
        },
      )
      .mockResolvedValue({
        detectedVersion: "0.153.4",
        globalInstallCommand: "npm install -g @openai/codex@0.153.4",
        requiredVersion: "0.153.4",
        status: "compatible",
      });
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

    await expect.element(screen.getByText("Workbench")).toBeVisible();
    await vi.waitFor(() => expect(runtimeMocks.warning).toHaveBeenCalledTimes(1));
    const [message, options] = runtimeMocks.warning.mock.calls[0] ?? [];
    expect(message).toBe("Codex update did not finish");
    expect(options).toMatchObject({
      action: { label: "Retry update" },
      description: "Codex 0.150.0 is still available. Retry when the connection is restored.",
    });

    runtimeMocks.connect.mockResolvedValue({ status: "ready", lastSeq: 8, provider: "codex" });
    options.action.onClick();
    await vi.waitFor(() => expect(runtimeMocks.inspect).toHaveBeenCalledTimes(2));
  });

  it("shows live progress while downloading the private runtime", async () => {
    await i18n.changeLanguage("en");
    runtimeMocks.inspect.mockResolvedValue({
      detectedVersion: null,
      globalInstallCommand: "npm install -g @openai/codex@0.153.4",
      requiredVersion: "0.153.4",
      status: "missing",
    });
    let reportProgress:
      | ((progress: {
          currentVersion: string | null;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
          totalBytes: number;
        }) => void)
      | undefined;
    runtimeMocks.download.mockImplementation(
      (
        onProgress: (progress: {
          currentVersion: string | null;
          downloadedBytes: number;
          phase: string;
          sequence: number;
          targetVersion: string;
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

    reportProgress?.({
      currentVersion: null,
      downloadedBytes: 42,
      phase: "downloading",
      sequence: 1,
      targetVersion: "0.153.4",
      totalBytes: 100,
    });

    const progressbar = screen.getByRole("progressbar", { name: "Download progress" });
    await expect.element(progressbar).toHaveAttribute("aria-valuenow", "42");
    await expect.element(screen.getByText("42%")).toBeVisible();
  });
});
