import type { CodeAgentEngine } from "@code-agent/engine-node";
import type { EventStreamMetricsResponse } from "@code-agent/protocol";
import { createCodeAgentServer } from "@code-agent/server";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import performanceBudgets from "../performance-budgets.json" with { type: "json" };
import { NodeResourceMonitor, PerformanceTrace } from "./metrics.js";

function createEngine(
  subscribe: CodeAgentEngine["eventSubscribe"],
  close: () => Promise<void>,
): CodeAgentEngine {
  const eventMetricsGet: CodeAgentEngine["eventMetricsGet"] = () =>
    Promise.resolve({
      projects: [
        {
          coalescedEvents: 0,
          pendingDeltas: 0,
          projectId: "project-performance",
          providerEventsReceived: performanceBudgets.delta.serverEvents,
          publishedEvents: performanceBudgets.delta.serverEvents,
          queueHighWaterMark: 0,
          retainedEvents: 0,
          retentionEvictions: 0,
          slowSubscribers: 0,
        },
      ],
    });
  return new Proxy({ close, eventMetricsGet, eventSubscribe: subscribe } as CodeAgentEngine, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (value !== undefined) return value;
      return () => Promise.reject(new Error(`Unexpected engine call: ${String(property)}`));
    },
  });
}

function frame(sequence: number, message = "performance"): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      payload: { code: "runtime_warning", level: "info", message },
      provider: "codex",
      sequence,
      sessionId: "session-performance",
      taskId: "task-performance",
      timestamp: "2026-08-14T00:00:00.000Z",
      type: "task.notice",
      version: 2,
    }),
    "utf8",
  );
}

function measureBest(run: () => number): { checksum: number; durationMs: number } {
  let checksum = 0;
  let durationMs = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = performance.now();
    checksum = run();
    durationMs = Math.min(durationMs, performance.now() - startedAt);
  }
  return { checksum, durationMs };
}

describe("Server event route performance", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("compares binary delivery with the previous text re-encoding path", () => {
    const decoder = new TextDecoder();
    const iterations = performanceBudgets.delta.serverEvents;
    const sample = frame(1, "实时事件".repeat(64));

    const text = measureBest(() => {
      let checksum = 0;
      for (let index = 0; index < iterations; index += 1) {
        const nodeText = Buffer.from(sample).toString("utf8");
        const websocketBytes = Buffer.from(nodeText, "utf8");
        checksum += decoder.decode(websocketBytes).length;
      }
      return checksum;
    });
    const binary = measureBest(() => {
      let checksum = 0;
      for (let index = 0; index < iterations; index += 1) {
        checksum += decoder.decode(sample).length;
      }
      return checksum;
    });

    console.info("WebSocket delivery encoding comparison", { binary, text });
    expect(binary.checksum).toBe(text.checksum);
    expect(binary.durationMs).toBeLessThan(text.durationMs);
  });

  it("publishes through a real WebSocket within latency and resource budgets", async () => {
    let publish: ((frame: Uint8Array) => void) | undefined;
    let runtimeSample = 0;
    const trace = new PerformanceTrace();
    const app = await createCodeAgentServer({
      engine: createEngine(
        (_requestId, _projectId, _sessionId, _afterSequence, callback) => {
          publish = callback;
          return { id: "performance", unsubscribe: () => true };
        },
        () => Promise.resolve(),
      ),
      installAppUpdate: () => Promise.reject(new Error("unused")),
      loggerEnabled: false,
      onPerformanceSample: ({ at, point }) => {
        if (runtimeSample < performanceBudgets.realtimePipeline.samples) {
          trace.record(runtimeSample, point, at);
        }
        runtimeSample += 1;
      },
      readAppInfo: () => Promise.reject(new Error("unused")),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    cleanups.push(() => app.close());
    const address = app.server.address() as AddressInfo;
    const socket = new WebSocket(
      `ws://localhost:${String(address.port)}/v1/projects/project-performance/events?afterSequence=0`,
      { origin: `http://localhost:${String(address.port)}` },
    );
    cleanups.push(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
      return Promise.resolve();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const expected = performanceBudgets.delta.serverEvents;
    let allFramesBinary = true;
    let received = 0;
    let resolveInitialDispatch: (() => void) | undefined;
    const initialDispatch = new Promise<void>((resolve) => {
      resolveInitialDispatch = resolve;
    });
    const allReceived = new Promise<void>((resolve, reject) => {
      socket.on("message", (_data, isBinary) => {
        allFramesBinary &&= isBinary;
        const sampleId = received;
        if (sampleId < performanceBudgets.realtimePipeline.samples) {
          trace.record(sampleId, "transport_received");
        }
        received += 1;
        if (received === performanceBudgets.slowWebSocket.messages) resolveInitialDispatch?.();
        if (received === expected) resolve();
      });
      socket.once("close", (code, reason) => {
        if (received !== expected) {
          reject(new Error(`WebSocket closed: ${String(code)} ${reason.toString()}`));
        }
      });
      socket.once("error", reject);
    });
    const monitor = new NodeResourceMonitor(1);
    monitor.start();
    const startedAt = performance.now();
    const initialDispatchDuration = initialDispatch.then(() => performance.now() - startedAt);
    for (let offset = 0; offset < expected; offset += 250) {
      const end = Math.min(offset + 250, expected);
      for (let sequence = offset; sequence < end; sequence += 1) {
        if (sequence < performanceBudgets.realtimePipeline.samples) {
          trace.record(sequence, "provider_received");
        }
        publish?.(frame(sequence + 1));
      }
      await yieldEventLoop();
    }
    await allReceived;
    const durationMs = performance.now() - startedAt;
    const dispatchDurationMs = await initialDispatchDuration;
    const resources = monitor.stop();

    const slowSocket = new WebSocket(
      `ws://localhost:${String(address.port)}/v1/projects/project-performance/events?afterSequence=0`,
      { origin: `http://localhost:${String(address.port)}` },
    ) as WebSocket & { _socket: { pause: () => void; resume: () => void } };
    cleanups.push(() => {
      slowSocket._socket.resume();
      if (slowSocket.readyState === WebSocket.OPEN) slowSocket.close();
      return Promise.resolve();
    });
    await new Promise<void>((resolve, reject) => {
      slowSocket.once("open", resolve);
      slowSocket.once("error", reject);
    });
    const slowClosed = new Promise<number>((resolve, reject) => {
      slowSocket.once("close", resolve);
      slowSocket.once("error", reject);
    });
    slowSocket._socket.pause();
    const slowStartedAt = performance.now();
    const largeFrame = frame(1, "x".repeat(64 * 1_024));
    for (let index = 0; index < performanceBudgets.slowWebSocket.messages; index += 1) {
      publish?.(largeFrame);
    }
    const slowDispatchDurationMs = performance.now() - slowStartedAt;
    const metricsResponse = await app.inject({
      headers: { host: "localhost" },
      url: "/v1/metrics/events",
    });
    expect(metricsResponse.statusCode).toBe(200);
    const metrics = metricsResponse.json<EventStreamMetricsResponse>().projects[0];
    expect(metrics).toBeDefined();
    slowSocket._socket.resume();
    const slowCloseCode = await slowClosed;
    const latency = trace.summarize("provider_received", "transport_received");
    const publishLatency = trace.summarize("runtime_published", "transport_received");
    console.info("WebSocket performance", {
      dispatchDurationMs,
      durationMs,
      latency,
      maxBufferedAmount: metrics?.maxBufferedAmount,
      publishLatency,
      resources,
      slowCloseCode,
      slowDispatchDurationMs,
    });

    expect(received).toBe(expected);
    expect(allFramesBinary).toBe(true);
    expect(metrics?.backpressureSignals).toBeGreaterThan(0);
    expect(metrics?.maxBufferedAmount).toBeGreaterThan(
      performanceBudgets.slowWebSocket.hardBackpressureBytes,
    );
    expect(metrics?.maxBufferedAmount).toBeLessThanOrEqual(
      performanceBudgets.slowWebSocket.maxObservedBufferedAmountBytes,
    );
    expect(metrics?.slowClientDisconnects).toBe(1);
    expect(slowCloseCode).toBe(1013);
    expect(slowDispatchDurationMs).toBeLessThan(performanceBudgets.slowWebSocket.maxDispatchMs);
    expect(dispatchDurationMs).toBeLessThan(performanceBudgets.slowWebSocket.maxDispatchMs);
    expect(publishLatency.count).toBe(performanceBudgets.realtimePipeline.samples);
    expect(durationMs).toBeLessThan(performanceBudgets.delta.maxServerPublishMs);
    expect(latency.p99).toBeLessThan(performanceBudgets.realtimePipeline.maxEndToEndP99Ms);
    expect(resources.eventLoopDelayP99Ms).toBeLessThan(
      performanceBudgets.nodeResources.maxEventLoopDelayP99Ms,
    );
    expect(resources.cpuSystemMicros + resources.cpuUserMicros).toBeLessThan(
      performanceBudgets.nodeResources.maxCpuMicros,
    );
    expect(resources.gcDurationMs).toBeLessThan(performanceBudgets.nodeResources.maxGcDurationMs);
    expect(resources.rssDeltaBytes).toBeLessThan(
      performanceBudgets.nodeResources.maxWebSocketRssGrowthBytes,
    );
  }, 30_000);
});
