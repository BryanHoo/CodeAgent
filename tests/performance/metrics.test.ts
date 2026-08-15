import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { NodeResourceMonitor, PerformanceTrace, percentiles } from "./metrics.js";

describe("performance metrics", () => {
  it("calculates stable nearest-rank percentiles", () => {
    expect(percentiles([100, 1, 50, 10, 99])).toEqual({ p50: 50, p95: 100, p99: 100 });
  });

  it("summarizes latency between named pipeline points", () => {
    const trace = new PerformanceTrace();
    for (let sampleId = 0; sampleId < 100; sampleId += 1) {
      trace.record(sampleId, "provider_received", sampleId * 10);
      trace.record(sampleId, "runtime_published", sampleId * 10 + sampleId + 1);
    }

    expect(trace.summarize("provider_received", "runtime_published")).toEqual({
      count: 100,
      p50: 50,
      p95: 95,
      p99: 99,
    });
  });

  it("collects event-loop, RSS, CPU and GC resource deltas", async () => {
    const monitor = new NodeResourceMonitor(1);
    monitor.start();
    await delay(10);
    globalThis.gc?.();
    await delay(10);

    const sample = monitor.stop();

    expect(sample.cpuUserMicros).toBeGreaterThanOrEqual(0);
    expect(sample.cpuSystemMicros).toBeGreaterThanOrEqual(0);
    expect(sample.eventLoopDelayP99Ms).toBeGreaterThanOrEqual(0);
    expect(sample.gcCount).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(sample.rssDeltaBytes)).toBe(true);
  });
});
