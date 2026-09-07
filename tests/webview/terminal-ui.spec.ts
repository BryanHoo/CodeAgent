import { browser, expect } from "@wdio/globals";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { installWebviewMocks, passthroughNativeCommands, releaseApplicationStartup } from "./mock-runtime.js";
import { measureSystemInputLatency, measureTerminalLatency, summarizeLatency } from "./terminal-latency.js";
import { postTerminalSystemText } from "./terminal-system-keyboard.js";
import { terminalNativeDialog } from "./terminal-native-dialog.js";

async function enterCommand(command: string): Promise<void> {
  await browser.execute((text) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => text } });
    textarea.dispatchEvent(paste);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  }, command);
}

async function clearNativeTerminals(): Promise<void> {
  const result = await browser.executeAsync((done: (value: string) => void) => {
    const api = (window as unknown as { __CODEAGENT_TERMINAL_TEST__?: { scopes: () => unknown[]; close: (scope: unknown) => Promise<void>; remove: (scope: unknown) => Promise<void> } }).__CODEAGENT_TERMINAL_TEST__;
    if (api === undefined) { done("unavailable"); return; }
    Promise.all(api.scopes().map(async (scope) => { await api.close(scope); await api.remove(scope); })).then(() => done("closed"), (error: unknown) => done(String(error)));
  });
  expect(["closed", "unavailable"]).toContain(result);
}

describe("project terminal native UI", () => {
  after(async () => { await clearNativeTerminals(); });
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      await mkdir("artifacts/terminal", { recursive: true });
      await browser.saveScreenshot("artifacts/terminal/native-terminal-failure.png");
      console.log("terminal diagnostics", await browser.execute(() => ({ error: document.querySelector('[data-project-terminal] [role="alert"]')?.textContent, xterm: document.querySelector(".xterm") !== null, calls: Object.fromEntries(Object.entries(window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls ?? {}).filter(([key]) => key.includes("terminal")).map(([key, value]) => [key, value.length])) })));
    }
  });
  before(async () => {
    await installWebviewMocks();
    await passthroughNativeCommands(["connect_project_terminals", "create_project_terminal", "write_project_terminal", "resize_project_terminal", "ack_project_terminal", "close_project_terminal", "remove_project_terminal"]);
    await browser.execute(() => {
      const target = window as unknown as {
        __terminalProof: { marker: boolean; keyboard: boolean; frames: number };
      };
      target.__terminalProof = { marker: false, keyboard: false, frames: 0 };
      const original = window.__CODEAGENT_WEBVIEW_TEST_INVOKE__!;
      let tail = "";
      window.__CODEAGENT_WEBVIEW_TEST_INVOKE__ = (command, args, options) => {
        if (command === "create_project_terminal") {
          const channel = (args as { onOutput: { onmessage: (value: unknown) => void } }).onOutput;
          const receive = channel.onmessage;
          channel.onmessage = (message) => {
            if (message instanceof ArrayBuffer && message.byteLength > 16) {
              (window as unknown as { __terminalSystemProbe?: { nativeOutput: () => void } }).__terminalSystemProbe?.nativeOutput();
              target.__terminalProof.frames += 1;
              // 只保留固定探针的命中结果，不记录用户 shell 启动内容。
              const text = tail + new TextDecoder().decode(new Uint8Array(message, 16));
              target.__terminalProof.marker ||= text.includes("NATIVE_PTY_READY");
              target.__terminalProof.keyboard ||= text.includes("NATIVE_KEYBOARD_READY");
              tail = text.slice(-1024);
            }
            receive(message);
          };
        }
        return original(command, args, options);
      };
    });
    await releaseApplicationStartup();
    await $("aria/自定义 API").click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/API Key（可选）").setValue("sk-webview-test");
    await $("aria/连接").click();
    await $('[aria-label="切换项目 CodeAgent"]').waitForDisplayed();
  });

  it("lazily creates a real PTY, accepts UI paste and retains it while hidden", async () => {
    expect(await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls.create_project_terminal?.length ?? 0)).toBe(0);
    await $("aria/终端 0").click();
    await $(".xterm-helper-textarea").waitForExist();
    await enterCommand("printf 'NATIVE_%s\\n' 'PTY_READY'");
    await browser.waitUntil(async () => browser.execute(() => (window as unknown as { __terminalProof: { marker: boolean } }).__terminalProof.marker));
    await $("aria/终端 1").waitForDisplayed();
    await $("aria/隐藏终端").click();
    expect(await $(".xterm").isExisting()).toBe(false);
    await $("aria/终端 1").click();
    await $(".xterm-helper-textarea").waitForExist();
    expect(await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls.create_project_terminal?.length ?? 0)).toBe(1);
  });

  it("renders the real terminal in a visible native window", async function () {
    if (process.platform === "darwin") {
      // 直接启动的测试二进制可能未成为前台应用；只激活当前构建路径对应的进程。
      const executable = resolve("src-tauri/target/aarch64-apple-darwin", process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug", "codeagent");
      await promisify(execFile)("swift", ["-e", "import AppKit; let path = CommandLine.arguments[1]; for app in NSWorkspace.shared.runningApplications where app.executableURL?.path == path { print(app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])) }", executable]);
      await browser.waitUntil(async () => browser.execute(() => !document.hidden), { timeout: 5000 }).catch(() => undefined);
    }
    if (await browser.execute(() => document.hidden)) {
      console.warn("Native render proof unavailable: WKWebView remains hidden after activating the test process.");
      this.skip();
      return;
    }
    const geometry = await browser.execute(() => {
      const panel = document.querySelector("[data-project-terminal]")!.getBoundingClientRect();
      const footer = document.querySelector("[data-terminal-footer]")!.getBoundingClientRect();
      const screen = document.querySelector(".xterm-screen")!.getBoundingClientRect();
      return { ordered: panel.bottom <= footer.top, width: screen.width, height: screen.height, canvases: document.querySelectorAll(".xterm canvas").length };
    });
    expect(geometry.ordered).toBe(true);
    expect(geometry.width).toBeGreaterThan(100);
    expect(geometry.height).toBeGreaterThan(40);
    await mkdir("artifacts/terminal", { recursive: true });
    await browser.saveScreenshot("artifacts/terminal/native-terminal.png");
  });

  it("records 200 input and 200 retained-tab render observations", async function () {
    if (process.env.CODEAGENT_WEBVIEW_RELEASE !== "1") { this.skip(); return; }
    const input = await measureTerminalLatency("input");
    // 丢弃采样输入，不把其作为命令执行。
    await browser.execute(() => document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "u", code: "KeyU", keyCode: 85, ctrlKey: true, bubbles: true, cancelable: true })));
    expect(input.error).toBeUndefined();
    await $("aria/新建终端").click();
    await $("aria/终端 2").waitForExist();
    await browser.pause(1000);
    const switched = await measureTerminalLatency("switch");
    await mkdir("artifacts/terminal", { recursive: true });
    await writeFile("artifacts/terminal/release-render-latency.json", JSON.stringify({
      measuredAt: new Date().toISOString(), build: "Release + webview-tests", webview: browser.capabilities.browserVersion,
      method: "Synthetic single-character UI paste -> real PTY echo -> timestamp captured inside xterm onRender; retained-tab click -> onRender timestamp. requestAnimationFrame only polls completion and is excluded from the duration. Not physical keyboard or display presentation timestamps; test-driver scheduling remains included.",
      input: { ...input, summary: summarizeLatency(input.samplesMs), targetP95Ms: 30 },
      switched: { ...switched, summary: summarizeLatency(switched.samplesMs), targetP95Ms: 50 },
    }, null, 2));
    expect(switched.error).toBeUndefined();
    expect(input.samplesMs).toHaveLength(200);
    expect(switched.samplesMs).toHaveLength(200);
    expect([...input.samplesMs, ...switched.samplesMs].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls.create_project_terminal?.length)).toBe(2);
    await $("aria/结束终端").click();
    await $("aria/移除已退出终端").waitForExist();
    await $("aria/移除已退出终端").click();
    await $("aria/终端 1").waitForExist();
  });

  it("accepts macOS system keyboard input", async function () {
    if (process.platform !== "darwin") { this.skip(); return; }
    const permission = await promisify(execFile)("swift", ["-e", "import CoreGraphics; print(CGPreflightPostEventAccess())"]);
    if (permission.stdout.trim() !== "true") {
      console.warn("System keyboard proof unavailable: macOS event posting permission is not granted.");
      this.skip();
      return;
    }
    expect(await browser.execute(() => document.hidden)).toBe(false);
    await browser.execute(() => document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!.focus());
    await postTerminalSystemText("printf 'NATIVE_%s\\n' 'KEYBOARD_READY'");
    await browser.waitUntil(async () => browser.execute(() => (window as unknown as { __terminalProof: { keyboard: boolean } }).__terminalProof.keyboard));
  });

  it("records 200 trusted system-key echo render observations", async function () {
    this.timeout(90000);
    if (process.platform !== "darwin" || process.env.CODEAGENT_WEBVIEW_RELEASE !== "1") { this.skip(); return; }
    const permission = await promisify(execFile)("swift", ["-e", "import CoreGraphics; print(CGPreflightPostEventAccess())"]);
    if (permission.stdout.trim() !== "true") { this.skip(); return; }
    const result = await measureSystemInputLatency();
    await writeFile("artifacts/terminal/release-system-key-latency.json", JSON.stringify({
      measuredAt: new Date().toISOString(), build: "Release + webview-tests", webview: browser.capabilities.browserVersion,
      method: "CGEvent.postToPid -> trusted keydown capture -> real PTY echo -> timestamp captured inside xterm onRender. requestAnimationFrame only polls completion and is excluded from duration. Not a display presentation timestamp.",
      ...result, summary: summarizeLatency(result.samplesMs), inputToOutput: summarizeLatency(result.inputToOutputMs), outputToRender: summarizeLatency(result.outputToRenderMs), targetP95Ms: 30,
    }, null, 2));
    expect(result.failure).toBeNull();
    expect(result.trustedKeys).toBe(200);
    expect(result.samplesMs).toHaveLength(200);
    expect(result.inputToOutputMs).toHaveLength(200);
    expect(result.outputToRenderMs).toHaveLength(200);
    expect([...result.samplesMs, ...result.inputToOutputMs, ...result.outputToRenderMs].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it("retains the real exit code and removes the exited tab", async () => {
    await enterCommand("exit 7");
    await $("aria/终端 0").waitForDisplayed();
    await browser.waitUntil(async () => browser.execute(() => document.querySelector("[data-project-terminal]")?.textContent?.includes("7") ?? false));
    await $("aria/移除已退出终端").click();
    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('[data-project-terminal] [role="tab"]').length === 0));
    expect(await browser.execute(() => document.querySelectorAll('[data-project-terminal] [role="tab"]').length)).toBe(0);
  });

  it("cancels and confirms the actual native window-close dialog", async function () {
    if (process.platform !== "darwin" || process.env.CODEAGENT_WEBVIEW_RELEASE !== "1") { this.skip(); return; }
    const permission = await promisify(execFile)("swift", ["-e", "import ApplicationServices; print(AXIsProcessTrusted())"]);
    if (permission.stdout.trim() !== "true") { this.skip(); return; }
    await clearNativeTerminals();
    await $("aria/新建终端").click();
    await $("aria/终端 1").waitForExist();
    await terminalNativeDialog("request");
    const blocked = await browser.executeAsync((done: (value: string) => void) => {
      const api = (window as unknown as { __CODEAGENT_TERMINAL_TEST__: { create: (project: string, root: string) => Promise<void> } }).__CODEAGENT_TERMINAL_TEST__;
      api.create("codeagent", "root-codeagent").then(() => done("UNEXPECTED_CREATION"), (error: unknown) => done(error !== null && typeof error === "object" && "code" in error ? String(error.code) : String(error)));
    });
    expect(blocked).toContain("TERMINAL_OWNER_CLOSING");
    await terminalNativeDialog("cancel");
    expect(await browser.execute(() => document.hidden)).toBe(false);
    await $("aria/新建终端").click();
    await $("aria/终端 2").waitForExist();
    await terminalNativeDialog("request");
    await terminalNativeDialog("confirm");
    await browser.waitUntil(async () => browser.execute(() => document.hidden));
    const live = await browser.executeAsync((done: (value: number | string) => void) => {
      const invoke = (window as unknown as { __TAURI__: { core: { invoke: (command: string) => Promise<{ liveCount: number }> } } }).__TAURI__.core.invoke;
      invoke("inspect_project_terminal_test").then((value) => done(value.liveCount), (error: unknown) => done(String(error)));
    });
    expect(live).toBe(0);
  });
});
