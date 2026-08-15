import type { Page } from "@playwright/test";

import { taskSnapshot, test, expect } from "../e2e/fixtures/app-shell.js";
import performanceBudgets from "../performance-budgets.json" with { type: "json" };
import { PerformanceTrace } from "./metrics.js";

const timestamp = "2026-08-14T00:00:00.000Z";

type BrowserSample = Readonly<{
  at: number;
  point:
    | "painted"
    | "provider_received"
    | "runtime_published"
    | "store_committed"
    | "transport_received";
  sequence: number;
}>;

interface BrowserProbeState {
  eventDurations: number[];
  hydrationAt: number;
  longTasks: number[];
  samples: BrowserSample[];
  start: () => void;
}

function createLongHistoryResponse() {
  const { items, itemsPerTurn } = performanceBudgets.longHistory;
  const turnCount = items / itemsPerTurn;
  const turns = Array.from({ length: turnCount }, (_, turnIndex) => {
    const running = turnIndex === turnCount - 1;
    return {
      completedAt: running ? null : timestamp,
      error: null,
      id: `turn-${String(turnIndex)}`,
      items: Array.from({ length: itemsPerTurn }, (_, itemIndex) => ({
        id: `message-${String(turnIndex)}-${String(itemIndex)}`,
        role: itemIndex % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `固定历史内容 ${String(turnIndex)}:${String(itemIndex)}`,
        type: "message" as const,
      })),
      startedAt: timestamp,
      status: running ? ("running" as const) : ("completed" as const),
    };
  });
  return {
    checkpoint: { sequence: 0, sessionId: "e2e-session" },
    snapshot: {
      ...taskSnapshot,
      status: "running" as const,
      title: "10,000 Item performance history",
      turns,
      updatedAt: timestamp,
    },
  };
}

function createSingleLargeTurnResponse() {
  const budget = performanceBudgets.singleLargeTurn;
  const commands = Array.from({ length: budget.items }, (_, index) => {
    const failed = index >= budget.items - budget.failedOperations;
    return {
      command: `large-operation-${String(index)}`,
      cwd: "/workspace/CodeAgent",
      exitCode: failed ? 1 : 0,
      id: `large-command-${String(index)}`,
      outputTruncated: false,
      status: failed ? ("failed" as const) : ("completed" as const),
      type: "command" as const,
    };
  });
  return {
    checkpoint: { sequence: 0, sessionId: "e2e-session" },
    snapshot: {
      ...taskSnapshot,
      title: "Single 10,000 operation Turn",
      turns: [
        {
          completedAt: timestamp,
          error: null,
          id: "single-large-turn",
          items: [
            ...commands,
            {
              changes: Array.from({ length: budget.files }, (_, index) => ({
                diff: "+updated",
                kind: "update" as const,
                path: `src/large-file-${String(index)}.ts`,
              })),
              id: "large-file-changes",
              status: "completed" as const,
              type: "file_change" as const,
            },
            {
              id: "large-final-answer",
              phase: "final_answer" as const,
              role: "assistant" as const,
              text: "Large Turn completed.",
              type: "message" as const,
            },
          ],
          startedAt: timestamp,
          status: "completed" as const,
        },
      ],
      updatedAt: timestamp,
    },
  };
}

async function installBrowserProbes(
  page: Page,
  samples: number,
  targetItemId: string,
  targetTurnId: string,
) {
  await page.addInitScript(
    ({ sampleCount, targetId, turnId }) => {
      const encodeFrame = (frame: unknown) =>
        new TextEncoder().encode(JSON.stringify(frame)).buffer;
      interface ProbeState {
        eventDurations: number[];
        hydrationAt: number;
        longTasks: number[];
        pendingPaint: Set<number>;
        samples: BrowserSample[];
        socket?: SampledWebSocket;
        start: () => void;
        startRequested: boolean;
      }
      const state: ProbeState = {
        eventDurations: [],
        hydrationAt: 0,
        longTasks: [],
        pendingPaint: new Set(),
        samples: [],
        start: () => {
          state.startRequested = true;
          state.socket?.start();
        },
        startRequested: false,
      };
      Reflect.set(globalThis, "__CODE_AGENT_PERFORMANCE_STATE__", state);
      Reflect.set(globalThis, "__CODE_AGENT_PERFORMANCE_OBSERVER__", (sample: BrowserSample) => {
        state.samples.push(sample);
        if (sample.point === "store_committed") state.pendingPaint.add(sample.sequence);
      });

      let paintScheduled = false;
      const mutations = new MutationObserver(() => {
        if (paintScheduled || state.pendingPaint.size === 0) return;
        paintScheduled = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const at = performance.now();
            for (const sequence of state.pendingPaint) {
              state.samples.push({ at, point: "painted", sequence });
            }
            state.pendingPaint.clear();
            paintScheduled = false;
          });
        });
      });
      const observeDocument = () => {
        const root = document.querySelector(":root");
        if (root === null) return;
        mutations.observe(root, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      };
      if (document.querySelector(":root") === null) {
        document.addEventListener("readystatechange", observeDocument, { once: true });
      } else {
        observeDocument();
      }

      try {
        new PerformanceObserver((list) => {
          state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
        }).observe({ entryTypes: ["longtask"] });
        const eventObserverOptions: PerformanceObserverInit & { durationThreshold: number } = {
          durationThreshold: 16,
          type: "event",
        };
        new PerformanceObserver((list) => {
          state.eventDurations.push(
            ...list
              .getEntries()
              .filter((entry) => Reflect.get(entry, "interactionId") !== 0)
              .map((entry) => entry.duration),
          );
        }).observe(eventObserverOptions);
      } catch {
        // Chromium 门禁会通过结果数量确认 API 是否可用。
      }

      class SampledWebSocket extends EventTarget {
        public static readonly CLOSED = 3;
        public static readonly CLOSING = 2;
        public static readonly CONNECTING = 0;
        public static readonly OPEN = 1;

        public readonly bufferedAmount: number;
        public readonly url: string;
        public readyState: number;
        private nextSequence: number;
        private started: boolean;

        public constructor(url: string | URL) {
          super();
          this.bufferedAmount = 0;
          this.url = String(url);
          this.readyState = SampledWebSocket.CONNECTING;
          this.nextSequence = 1;
          this.started = false;
          state.socket = this;
          state.hydrationAt = performance.now();
          if (state.startRequested) this.start();
          queueMicrotask(() => {
            this.readyState = SampledWebSocket.OPEN;
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
          });
        }

        public close(code = 1000, reason = ""): void {
          if (this.readyState === SampledWebSocket.CLOSED) return;
          this.readyState = SampledWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close", { code, reason }));
        }

        public send(data?: unknown): void {
          void data;
        }

        public start(): void {
          if (this.started) return;
          this.started = true;
          requestAnimationFrame(() => {
            this.publishNext();
          });
        }

        private publishNext(): void {
          if (this.nextSequence > sampleCount || this.readyState !== SampledWebSocket.OPEN) {
            return;
          }
          const sequence = this.nextSequence;
          state.samples.push({
            at: performance.now(),
            point: "provider_received",
            sequence,
          });
          queueMicrotask(() => {
            state.samples.push({
              at: performance.now(),
              point: "runtime_published",
              sequence,
            });
            this.dispatchEvent(
              new MessageEvent("message", {
                data: encodeFrame({
                  itemId: targetId,
                  payload: { delta: "x" },
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
            this.nextSequence += 1;
            requestAnimationFrame(() => {
              this.publishNext();
            });
          });
        }
      }

      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: SampledWebSocket,
      });
    },
    { sampleCount: samples, targetId: targetItemId, turnId: targetTurnId },
  );
}

function metric(metrics: readonly { name: string; value: number }[], name: string): number {
  const value = metrics.find((candidate) => candidate.name === name)?.value;
  if (value === undefined) throw new Error(`Missing Chromium metric: ${name}`);
  return value;
}

test("measures Timeline DOM, paint, interaction, memory and realtime latency", async ({ page }) => {
  const sampleCount = performanceBudgets.realtimePipeline.samples;
  const turnCount =
    performanceBudgets.longHistory.items / performanceBudgets.longHistory.itemsPerTurn;
  const targetTurnId = `turn-${String(turnCount - 1)}`;
  const targetItemId = `message-${String(turnCount - 1)}-${String(performanceBudgets.longHistory.itemsPerTurn - 1)}`;
  await installBrowserProbes(page, sampleCount, targetItemId, targetTurnId);
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({ contentType: "application/json", json: createLongHistoryResponse() });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");

  await page.goto("/p/code-agent/t/task-1");
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect(conversation).toBeVisible();
  await expect(conversation.getByText(`固定历史内容 ${String(turnCount - 1)}:9`)).toBeVisible();
  const hydrationMs = await page.evaluate(
    () =>
      (Reflect.get(globalThis, "__CODE_AGENT_PERFORMANCE_STATE__") as BrowserProbeState)
        .hydrationAt,
  );
  const mountedTurns = await conversation.locator('section[aria-label^="Turn "]').count();
  // DOM 门禁统计稳定保留节点，排除虚拟列表滚动后等待回收的 detached nodes。
  await cdp.send("HeapProfiler.collectGarbage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const baselineMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const baselineHeap = metric(baselineMetrics, "JSHeapUsedSize");
  const baselineCpu = metric(baselineMetrics, "TaskDuration");

  await page.evaluate(() => {
    const state = Reflect.get(globalThis, "__CODE_AGENT_PERFORMANCE_STATE__") as BrowserProbeState;
    state.start();
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = Reflect.get(
            globalThis,
            "__CODE_AGENT_PERFORMANCE_STATE__",
          ) as BrowserProbeState;
          return state.samples.filter((sample) => sample.point === "painted").length;
        }),
      { timeout: 30_000 },
    )
    .toBe(sampleCount);

  const peakMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const heapGrowth = metric(peakMetrics, "JSHeapUsedSize") - baselineHeap;
  const cpuDurationMs = (metric(peakMetrics, "TaskDuration") - baselineCpu) * 1_000;
  await cdp.send("HeapProfiler.collectGarbage");
  const retainedMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const gcRetainedBytes = metric(retainedMetrics, "JSHeapUsedSize") - baselineHeap;

  await conversation.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const scrollButton = page.getByRole("button", { name: "回到底部" });
  await expect(scrollButton).toBeVisible();
  await page.evaluate(() => {
    addEventListener(
      "pointerdown",
      () => Reflect.set(globalThis, "__CODE_AGENT_INTERACTION_STARTED_AT__", performance.now()),
      { capture: true, once: true },
    );
  });
  await scrollButton.click();
  const inpMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(
              performance.now() -
                (Reflect.get(globalThis, "__CODE_AGENT_INTERACTION_STARTED_AT__") as number),
            );
          });
        });
      }),
  );

  const browserState = await page.evaluate(() => {
    const state = Reflect.get(globalThis, "__CODE_AGENT_PERFORMANCE_STATE__") as {
      eventDurations: number[];
      longTasks: number[];
      samples: BrowserSample[];
    };
    return {
      eventDurations: state.eventDurations,
      longTasks: state.longTasks,
      samples: state.samples,
    };
  });
  const trace = new PerformanceTrace();
  for (const sample of browserState.samples) {
    trace.record(sample.sequence, sample.point, sample.at);
  }
  const stageLatency = {
    endToEnd: trace.summarize("provider_received", "painted"),
    publish: trace.summarize("provider_received", "runtime_published"),
    render: trace.summarize("store_committed", "painted"),
    store: trace.summarize("transport_received", "store_committed"),
    transport: trace.summarize("runtime_published", "transport_received"),
  };
  const maxLongTaskMs = Math.max(0, ...browserState.longTasks);
  console.info("Chromium Timeline performance", {
    cpuDurationMs,
    domNodes: dom.nodes,
    eventDurations: browserState.eventDurations,
    gcRetainedBytes,
    heapGrowth,
    hydrationMs,
    inpMs,
    maxLongTaskMs,
    mountedTurns,
    stageLatency,
  });

  expect(mountedTurns).toBeGreaterThan(0);
  expect(mountedTurns).toBeLessThanOrEqual(performanceBudgets.longHistory.maxMountedTurns);
  expect(dom.nodes).toBeLessThan(performanceBudgets.longHistory.maxDomNodes);
  expect(hydrationMs).toBeLessThan(performanceBudgets.longHistory.maxHydrationMs);
  expect(maxLongTaskMs).toBeLessThan(performanceBudgets.longHistory.maxLongTaskMs);
  expect(inpMs).toBeLessThan(performanceBudgets.longHistory.maxInpMs);
  expect(heapGrowth).toBeLessThan(performanceBudgets.longHistory.maxHeapGrowthBytes);
  expect(gcRetainedBytes).toBeLessThan(performanceBudgets.longHistory.maxGcRetainedBytes);
  expect(stageLatency.endToEnd.count).toBe(sampleCount);
  expect(stageLatency.endToEnd.p50).toBeLessThan(
    performanceBudgets.realtimePipeline.maxEndToEndP50Ms,
  );
  expect(stageLatency.endToEnd.p95).toBeLessThan(
    performanceBudgets.realtimePipeline.maxEndToEndP95Ms,
  );
  expect(stageLatency.endToEnd.p99).toBeLessThan(
    performanceBudgets.realtimePipeline.maxEndToEndP99Ms,
  );
});

test("bounds a collapsed 10,000 operation Turn", async ({ page }) => {
  const budget = performanceBudgets.singleLargeTurn;
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({ contentType: "application/json", json: createSingleLargeTurnResponse() });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const baselineMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const baselineHeap = metric(baselineMetrics, "JSHeapUsedSize");
  const hydrationStartedAt = performance.now();

  await page.goto("/p/code-agent/t/task-1");
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect(conversation.getByText("Large Turn completed.", { exact: true })).toBeVisible();
  const firstRecentIndex = budget.items - budget.recentOperations;
  await expect(
    conversation.getByText(`large-operation-${String(firstRecentIndex - 1)}`, { exact: true }),
  ).toHaveCount(0);
  await expect(
    conversation.getByText(`large-operation-${String(firstRecentIndex)}`, { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByText(`large-operation-${String(budget.items - 1)}`, { exact: true }),
  ).toBeVisible();
  const completedOperations = budget.items - budget.failedOperations;
  await expect(page.getByRole("button", { name: "展开执行过程" })).toContainText(
    `已完成 ${completedOperations.toLocaleString("zh-CN")} 项操作 · ${String(budget.failedOperations)} 项失败 · ${String(budget.files)} 个文件`,
  );
  const hydrationMs = performance.now() - hydrationStartedAt;
  const peakMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const heapGrowth = metric(peakMetrics, "JSHeapUsedSize") - baselineHeap;
  await cdp.send("HeapProfiler.collectGarbage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const retainedMetrics = (await cdp.send("Performance.getMetrics")).metrics;
  const gcRetainedBytes = metric(retainedMetrics, "JSHeapUsedSize") - baselineHeap;
  console.info("Chromium single large Turn performance", {
    domNodes: dom.nodes,
    gcRetainedBytes,
    heapGrowth,
    hydrationMs,
  });

  expect(dom.nodes).toBeLessThan(budget.maxDomNodes);
  expect(hydrationMs).toBeLessThan(budget.maxHydrationMs);
  expect(heapGrowth).toBeLessThan(budget.maxHeapGrowthBytes);
  expect(gcRetainedBytes).toBeLessThan(budget.maxGcRetainedBytes);
});
