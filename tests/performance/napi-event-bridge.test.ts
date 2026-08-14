import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import performanceBudgets from "../performance-budgets.json" with { type: "json" };
import { NodeResourceMonitor } from "./metrics.js";

type PerformanceNativeBinding = Readonly<{
  performanceEventBridge: (events: number, callback: (frame: Buffer) => void) => void;
}>;

const addonPath = fileURLToPath(
  new URL("../../.cache/performance/code-agent-node-binding.node", import.meta.url),
);

describe("N-API event bridge performance", () => {
  it("delivers native ThreadsafeFunction frames within resource budgets", async () => {
    const binding = createRequire(import.meta.url)(addonPath) as PerformanceNativeBinding;
    const monitor = new NodeResourceMonitor(1);
    let expectedSequence = 1;

    monitor.start();
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      binding.performanceEventBridge(performanceBudgets.napiEventBridge.events, (frame: Buffer) => {
        try {
          const event = JSON.parse(frame.toString("utf8")) as { sequence: number };
          expect(event.sequence).toBe(expectedSequence);
          expectedSequence += 1;
          if (event.sequence === performanceBudgets.napiEventBridge.events) resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    const durationMs = performance.now() - startedAt;
    const resources = monitor.stop();

    console.info("N-API performance", { durationMs, resources });
    expect(expectedSequence - 1).toBe(performanceBudgets.napiEventBridge.events);
    expect(durationMs).toBeLessThan(performanceBudgets.napiEventBridge.maxDurationMs);
    expect(resources.eventLoopDelayP99Ms).toBeLessThan(
      performanceBudgets.nodeResources.maxEventLoopDelayP99Ms,
    );
    expect(resources.cpuSystemMicros + resources.cpuUserMicros).toBeLessThan(
      performanceBudgets.nodeResources.maxCpuMicros,
    );
    expect(resources.gcDurationMs).toBeLessThan(performanceBudgets.nodeResources.maxGcDurationMs);
    expect(resources.rssDeltaBytes).toBeLessThan(
      performanceBudgets.nodeResources.maxNapiRssGrowthBytes,
    );
  });
});
