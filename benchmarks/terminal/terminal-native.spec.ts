import { browser, expect } from "@wdio/globals";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { installWebviewMocks, passthroughNativeCommands, releaseApplicationStartup } from "../../tests/webview/mock-runtime.js";
import { sampleResources, summarizeResources, type ResourceSample } from "./resources.js";
import type { TerminalMetadata } from "../../src/protocol/project-terminal.js";

type NativeMetrics = { appPid: number; liveCount: number; sessions: { pid: number | null; outstandingBytes: number; queuedInputBytes: number }[] };
type EmulatorMetric = { parsedBytes: number; pendingBytes: number; peakPendingBytes: number; renders: number; lines: number; cols: number; rows: number; parseSamplesMs: number[] };
type TestWindow = Window & {
  __TAURI__: { core: { invoke: <T>(command: string) => Promise<T> } };
  __CODEAGENT_TERMINAL_TEST__: { create: (projectId: string, rootId: string) => Promise<void>; scopes: () => TerminalMetadata[]; close: (scope: TerminalMetadata) => Promise<void>; remove: (scope: TerminalMetadata) => Promise<void> };
  __CODEAGENT_TERMINAL_METRICS__: () => EmulatorMetric[];
};

async function nativeMetrics(): Promise<NativeMetrics> {
  const result = await browser.executeAsync((done: (value: NativeMetrics | string) => void) => {
    (window as TestWindow).__TAURI__.core.invoke<NativeMetrics>("inspect_project_terminal_test").then(done, (error: unknown) => done(String(error)));
  });
  if (typeof result === "string") throw new Error(result);
  return result;
}

async function observe(label: string, native: NativeMetrics, durationMs: number) {
  const samples: ResourceSample[] = [];
  const started = performance.now();
  const pids = native.sessions.flatMap((session) => session.pid === null ? [] : [session.pid]);
  do {
    samples.push(await sampleResources(native.appPid, pids, started));
    if (performance.now() - started >= durationMs) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, durationMs - (performance.now() - started))));
  } while (performance.now() - started <= durationMs + 5000);
  console.log("terminal measurement", label, summarizeResources(samples));
  return { label, samples, summary: summarizeResources(samples) };
}

describe("Release native terminal measurements", () => {
  before(async function () {
    if (process.platform !== "darwin" || process.env.CODEAGENT_WEBVIEW_RELEASE !== "1") { this.skip(); return; }
    await installWebviewMocks();
    await passthroughNativeCommands(["connect_project_terminals", "create_project_terminal", "write_project_terminal", "resize_project_terminal", "ack_project_terminal", "close_project_terminal", "remove_project_terminal"]);
    await releaseApplicationStartup();
    await $("aria/自定义 API").click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/API Key（可选）").setValue("sk-webview-test");
    await $("aria/连接").click();
    await $("aria/终端 0").waitForExist();
    const executable = resolve("src-tauri/target/aarch64-apple-darwin/release/codeagent");
    await promisify(execFile)("swift", ["-e", "import AppKit; let path = CommandLine.arguments[1]; for app in NSWorkspace.shared.runningApplications where app.executableURL?.path == path { print(app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])) }", executable]);
    await browser.waitUntil(async () => browser.execute(() => !document.hidden));
  });

  it("records baseline, 1/12 idle sessions, bounded output and cleanup", async () => {
    const phases: Awaited<ReturnType<typeof observe>>[] = [];
    const initial = await nativeMetrics();
    expect(initial.liveCount).toBe(0);
    phases.push(await observe("baseline-no-terminal", initial, 60000));
    let renderer: EmulatorMetric[] = [];
    let idleTerminalCalls = 0;
    let outputMetrics: NativeMetrics | undefined;
    let cleanupMs = 0;
    try {
      await $("aria/终端 0").click();
      await $("aria/终端 1").waitForExist();
      await browser.pause(2000);
      phases.push(await observe("one-idle-terminal", await nativeMetrics(), 60000));
      const result = await browser.executeAsync((done) => {
        const api = (window as TestWindow).__CODEAGENT_TERMINAL_TEST__;
        void (async () => {
          for (const [project, root, count] of [["codeagent", "root-codeagent", 3], ["codexly", "root-codexly", 4], ["terminal-bench-third", "root-terminal-bench-third", 4]] as const) {
            for (let index = 0; index < count; index += 1) await api.create(project, root);
          }
          done("ok");
        })().catch((error: unknown) => done(String(error)));
      });
      expect(result).toBe("ok");
      await browser.pause(2000);
      const twelve = await nativeMetrics();
      expect(twelve.liveCount).toBe(12);
      const countCalls = () => browser.execute(() => Object.entries(window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls ?? {}).filter(([name]) => name.includes("project_terminal")).reduce((total, [, calls]) => total + calls.length, 0));
      const before = await countCalls();
      for (let round = 1; round <= 3; round += 1) phases.push(await observe(`twelve-idle-${round}`, twelve, 60000));
      idleTerminalCalls = (await countCalls()) - before;
      expect(idleTerminalCalls).toBe(0);
      await browser.execute(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
        const command = "python3 -u -c 'import os,time; [(os.write(1,b\"0123456789abcdef\"*512+b\"\\r\\n\"),time.sleep(.1)) for _ in range(600)]'";
        const paste = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(paste, "clipboardData", { value: { getData: () => command } });
        textarea.dispatchEvent(paste);
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      });
      phases.push(await observe("sixty-second-output", twelve, 65000));
      outputMetrics = await nativeMetrics();
      renderer = await browser.execute(() => (window as TestWindow).__CODEAGENT_TERMINAL_METRICS__());
      expect(renderer.reduce((total, value) => total + value.parsedBytes, 0)).toBeGreaterThan(4 * 1024 * 1024);
      expect(renderer.every((value) => value.peakPendingBytes <= 272 * 1024 && value.lines <= 3200)).toBe(true);
      expect(outputMetrics.sessions.every((value) => value.outstandingBytes <= 256 * 1024 && value.queuedInputBytes <= 64 * 1024)).toBe(true);
    } finally {
      const started = performance.now();
      await browser.executeAsync((done) => {
        const api = (window as TestWindow).__CODEAGENT_TERMINAL_TEST__;
        if (api === undefined) { done("empty"); return; }
        Promise.all(api.scopes().map(async (scope) => { await api.close(scope); await api.remove(scope); })).then(() => done("closed"), (error: unknown) => done(String(error)));
      });
      cleanupMs = performance.now() - started;
      const closed = await nativeMetrics();
      const visibility = await browser.execute(() => document.visibilityState);
      const report = {
        measuredAt: new Date().toISOString(), build: "Release + webview-tests", platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), webview: browser.capabilities.browserVersion, visibility,
        scope: "App PID and its direct shell PIDs only; WebContent/GPU RSS not attributed. Test driver has a 50ms main-runloop pump. Fixture roots use a temporary directory; shells use user login profiles.",
        phases, idleTerminalCalls, renderer, outputMetrics, cleanupMs, remainingNativeSessions: closed.liveCount,
        unverified: ["WebContent/GPU memory", "native dialog confirmation", "Windows", "Linux", "input-to-paint latency", "switch-to-paint latency", ...(visibility === "hidden" ? ["native visible render"] : [])],
      };
      await mkdir("artifacts/terminal", { recursive: true });
      await writeFile("artifacts/terminal/release-native-measurements.json", JSON.stringify(report, null, 2));
      expect(closed.liveCount).toBe(0);
      expect(cleanupMs).toBeLessThan(3000);
    }
  });
});
