import type { CDPSession, Page } from "@playwright/test";

import { taskSnapshot, test, expect } from "../e2e/fixtures/app-shell.js";
import performanceBudgets from "../performance-budgets.json" with { type: "json" };

const timestamp = "2026-08-14T00:00:00.000Z";
const targetItemId = "streaming-markdown-message";
const targetTurnId = "streaming-markdown-turn";
const completionMarker = "STREAMING_MARKDOWN_COMPLETE";

interface BrowserProbeState {
  longTasks: number[];
  publishedChunks: number;
  start: () => void;
}

function createMarkdown(bytes: number): string {
  const unit = `## Streaming benchmark

${"Agent response content ".repeat(160)}[source](/workspace/apps/web/src/file name.ts:12)

\`\`\`ts
export const measured = true;
\`\`\`

`;
  const suffix = `\n\n${completionMarker}`;
  return `${unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes - suffix.length)}${suffix}`;
}

function createSnapshot(initialMarkdown: string) {
  return {
    checkpoint: { sequence: 0, sessionId: "e2e-session" },
    snapshot: {
      ...taskSnapshot,
      status: "running" as const,
      title: "Streaming Markdown performance",
      turns: [
        {
          completedAt: null,
          error: null,
          id: targetTurnId,
          items: [
            {
              id: targetItemId,
              role: "assistant" as const,
              text: initialMarkdown,
              type: "message" as const,
            },
          ],
          startedAt: timestamp,
          status: "running" as const,
        },
      ],
      updatedAt: timestamp,
    },
  };
}

async function installStreamingMarkdownProbe(page: Page, chunks: readonly string[]) {
  await page.addInitScript(
    ({ deltas, itemId, turnId }) => {
      const encodeFrame = (frame: unknown) =>
        new TextEncoder().encode(JSON.stringify(frame)).buffer;
      interface ProbeState {
        longTasks: number[];
        publishedChunks: number;
        socket?: StreamingWebSocket;
        start: () => void;
        startRequested: boolean;
      }

      const state: ProbeState = {
        longTasks: [],
        publishedChunks: 0,
        start: () => {
          state.startRequested = true;
          state.socket?.start();
        },
        startRequested: false,
      };
      Reflect.set(globalThis, "__CODE_AGENT_MARKDOWN_PERFORMANCE__", state);

      try {
        new PerformanceObserver((list) => {
          state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
        }).observe({ entryTypes: ["longtask"] });
      } catch {
        // Chromium 门禁通过最终结果确认 Long Tasks API 可用。
      }

      class StreamingWebSocket extends EventTarget {
        public static readonly CLOSED = 3;
        public static readonly CLOSING = 2;
        public static readonly CONNECTING = 0;
        public static readonly OPEN = 1;

        public readonly bufferedAmount = 0;
        public readonly url: string;
        public readyState = StreamingWebSocket.CONNECTING;
        private nextChunk = 0;
        private started = false;

        public constructor(url: string | URL) {
          super();
          this.url = String(url);
          state.socket = this;
          queueMicrotask(() => {
            this.readyState = StreamingWebSocket.OPEN;
            this.dispatchEvent(new Event("open"));
            this.dispatchEvent(
              new MessageEvent("message", {
                data: encodeFrame({
                  latestSequence: 0,
                  sessionId: "e2e-session",
                  type: "connection.ready",
                  version: 2,
                }),
              }),
            );
            if (state.startRequested) this.start();
          });
        }

        public close(code = 1000, reason = ""): void {
          if (this.readyState === StreamingWebSocket.CLOSED) return;
          this.readyState = StreamingWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close", { code, reason }));
        }

        public send(data?: unknown): void {
          void data;
        }

        public start(): void {
          if (this.started || this.readyState !== StreamingWebSocket.OPEN) return;
          this.started = true;
          requestAnimationFrame(() => {
            this.publishNext();
          });
        }

        private publishNext(): void {
          const delta = deltas[this.nextChunk];
          if (delta === undefined || this.readyState !== StreamingWebSocket.OPEN) return;
          const sequence = this.nextChunk + 1;
          this.dispatchEvent(
            new MessageEvent("message", {
              data: encodeFrame({
                itemId,
                payload: { delta },
                provider: "codex",
                sequence,
                sessionId: "e2e-session",
                taskId: "task-1",
                timestamp: "2026-08-14T00:00:00.000Z",
                turnId,
                type: "message.delta",
                version: 2,
              }),
            }),
          );
          this.nextChunk += 1;
          state.publishedChunks = this.nextChunk;
          requestAnimationFrame(() => {
            this.publishNext();
          });
        }
      }

      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: StreamingWebSocket,
      });
    },
    { deltas: chunks, itemId: targetItemId, turnId: targetTurnId },
  );
}

function metric(metrics: readonly { name: string; value: number }[], name: string): number {
  const value = metrics.find((candidate) => candidate.name === name)?.value;
  if (value === undefined) throw new Error(`Missing Chromium metric: ${name}`);
  return value;
}

async function collectMetrics(cdp: CDPSession) {
  return (await cdp.send("Performance.getMetrics")).metrics;
}

for (const budget of performanceBudgets.streamingMarkdown.cases) {
  test(`measures ${String(budget.bytes)} byte streaming Markdown CPU and memory`, async ({
    page,
  }) => {
    const markdown = createMarkdown(budget.bytes);
    const chunks = Array.from(
      { length: Math.ceil(markdown.length / budget.chunkBytes) },
      (_, index) => markdown.slice(index * budget.chunkBytes, (index + 1) * budget.chunkBytes),
    ).filter((chunk) => chunk.length > 0);
    await installStreamingMarkdownProbe(page, chunks);
    await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: createSnapshot(""),
      });
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const blankHeap = metric(await collectMetrics(cdp), "JSHeapUsedSize");

    await page.goto("/p/code-agent/t/task-1");
    const conversation = page.getByRole("log", { name: "会话内容" });
    await expect(conversation).toBeVisible();
    await cdp.send("HeapProfiler.collectGarbage");
    const streamBaseline = await collectMetrics(cdp);
    const baselineHeap = metric(streamBaseline, "JSHeapUsedSize");
    const baselineCpu = metric(streamBaseline, "TaskDuration");
    await page.evaluate(() => {
      const state = Reflect.get(
        globalThis,
        "__CODE_AGENT_MARKDOWN_PERFORMANCE__",
      ) as BrowserProbeState;
      state.longTasks.length = 0;
      state.start();
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = Reflect.get(
              globalThis,
              "__CODE_AGENT_MARKDOWN_PERFORMANCE__",
            ) as BrowserProbeState;
            return state.publishedChunks;
          }),
        { timeout: 30_000 },
      )
      .toBe(chunks.length);
    await expect(conversation.getByText(completionMarker, { exact: true })).toBeVisible();
    // 等待最终 Markdown 的异步高亮与绘制结束，再采集稳定态 CPU 和内存数据。
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestIdleCallback(
                () => {
                  resolve();
                },
                { timeout: 1_000 },
              );
            });
          });
        }),
    );

    const peakMetrics = await collectMetrics(cdp);
    const cpuDurationMs = (metric(peakMetrics, "TaskDuration") - baselineCpu) * 1_000;
    const heapUsedBytes = metric(peakMetrics, "JSHeapUsedSize") - blankHeap;
    const streamHeapGrowthBytes = metric(peakMetrics, "JSHeapUsedSize") - baselineHeap;
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const gcRetainedBytes = metric(await collectMetrics(cdp), "JSHeapUsedSize") - blankHeap;
    const longTasks = await page.evaluate(() => {
      const state = Reflect.get(
        globalThis,
        "__CODE_AGENT_MARKDOWN_PERFORMANCE__",
      ) as BrowserProbeState;
      return state.longTasks;
    });
    const maxLongTaskMs = Math.max(0, ...longTasks);
    console.info("Chromium streaming Markdown performance", {
      bytes: budget.bytes,
      chunks: chunks.length,
      cpuDurationMs,
      gcRetainedBytes,
      heapUsedBytes,
      maxLongTaskMs,
      streamHeapGrowthBytes,
    });
    expect(cpuDurationMs).toBeLessThan(budget.maxCpuDurationMs);
    expect(maxLongTaskMs).toBeLessThan(performanceBudgets.streamingMarkdown.maxLongTaskMs);
    expect(heapUsedBytes).toBeLessThan(budget.maxHeapUsedBytes);
    expect(streamHeapGrowthBytes).toBeLessThan(budget.maxStreamHeapGrowthBytes);
    expect(gcRetainedBytes).toBeLessThan(budget.maxGcRetainedBytes);
  });
}
