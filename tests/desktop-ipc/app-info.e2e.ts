import { browser, expect } from "@wdio/globals";

interface AppInfoResult {
  appVersion: string;
  codexVersion: string;
  error: string | null;
  status: string;
}

type IpcExecutionResult = { appInfo: AppInfoResult } | { ipcError: string };

describe("Desktop real IPC", () => {
  it("invokes the Rust app_info command from the real WebView", async () => {
    const version = process.env["CODE_AGENT_E2E_VERSION"];
    if (version === undefined) throw new Error("CODE_AGENT_E2E_VERSION is required");

    // WebDriver 的同步 execute 无法等待 Tauri IPC Promise，此处必须使用异步脚本协议。
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const result = await browser.executeAsync<IpcExecutionResult, []>(
      (done: (result?: IpcExecutionResult) => void) => {
        const tauri = (
          window as unknown as {
            __TAURI__?: {
              core?: {
                invoke?: (command: string, payload: Record<string, string>) => Promise<unknown>;
              };
            };
          }
        ).__TAURI__;
        const invoke = tauri?.core?.invoke;
        if (invoke === undefined) {
          done({ ipcError: "window.__TAURI__.core.invoke is unavailable" });
          return;
        }
        void invoke("app_info", { requestId: "desktop-ipc-e2e" }).then(
          (appInfo) => {
            done({ appInfo: appInfo as AppInfoResult });
          },
          (error: unknown) => {
            done({ ipcError: error instanceof Error ? error.message : String(error) });
          },
        );
      },
    );

    if ("ipcError" in result) throw new Error(result.ipcError);
    const { appInfo } = result;
    if (appInfo.error !== null) throw new Error(appInfo.error);
    expect(appInfo.appVersion).toBe(version);
    expect(appInfo.codexVersion).not.toBe("");
    expect(["available", "check-failed", "current"]).toContain(appInfo.status);
  });
});
