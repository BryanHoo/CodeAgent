import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
  type IntervalHistogram,
} from "node:perf_hooks";

export type PipelinePoint =
  "painted" | "provider_received" | "runtime_published" | "store_committed" | "transport_received";

export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface LatencySummary extends Percentiles {
  readonly count: number;
}

export interface NodeResourceSample {
  readonly cpuSystemMicros: number;
  readonly cpuUserMicros: number;
  readonly eventLoopDelayP99Ms: number;
  readonly gcCount: number;
  readonly gcDurationMs: number;
  readonly rssDeltaBytes: number;
}

const NANOS_PER_MILLISECOND = 1_000_000;

function nearestRank(sortedValues: readonly number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1);
  return sortedValues[index] ?? 0;
}

export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) {
    throw new RangeError("At least one performance sample is required");
  }
  const sortedValues = values.toSorted((left, right) => left - right);
  return {
    p50: nearestRank(sortedValues, 0.5),
    p95: nearestRank(sortedValues, 0.95),
    p99: nearestRank(sortedValues, 0.99),
  };
}

export class PerformanceTrace {
  readonly #samples = new Map<number, Map<PipelinePoint, number>>();

  public record(sampleId: number, point: PipelinePoint, at = performance.now()): void {
    const sample = this.#samples.get(sampleId) ?? new Map<PipelinePoint, number>();
    if (sample.has(point)) {
      throw new Error(
        `Performance point ${point} was already recorded for sample ${String(sampleId)}`,
      );
    }
    sample.set(point, at);
    this.#samples.set(sampleId, sample);
  }

  public summarize(from: PipelinePoint, to: PipelinePoint): LatencySummary {
    const durations: number[] = [];
    for (const sample of this.#samples.values()) {
      const startedAt = sample.get(from);
      const completedAt = sample.get(to);
      if (startedAt === undefined || completedAt === undefined) continue;
      if (completedAt < startedAt) {
        throw new RangeError(`Performance point ${to} precedes ${from}`);
      }
      durations.push(completedAt - startedAt);
    }
    return { count: durations.length, ...percentiles(durations) };
  }
}

export class NodeResourceMonitor {
  readonly #eventLoop: IntervalHistogram;
  #cpuStart: NodeJS.CpuUsage | undefined;
  #gcCount = 0;
  #gcDurationMs = 0;
  #rssStart = 0;
  #started = false;
  readonly #gcObserver: PerformanceObserver;

  public constructor(resolutionMs = 10) {
    this.#eventLoop = monitorEventLoopDelay({ resolution: resolutionMs });
    this.#gcObserver = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        this.#gcCount += 1;
        this.#gcDurationMs += entry.duration;
      }
    });
  }

  public start(): void {
    if (this.#started) throw new Error("Node resource monitor is already running");
    this.#started = true;
    this.#cpuStart = process.cpuUsage();
    this.#rssStart = process.memoryUsage.rss();
    this.#gcObserver.observe({ entryTypes: ["gc"] });
    this.#eventLoop.enable();
  }

  public stop(): NodeResourceSample {
    if (!this.#started || this.#cpuStart === undefined) {
      throw new Error("Node resource monitor is not running");
    }
    const cpu = process.cpuUsage(this.#cpuStart);
    this.#eventLoop.disable();
    this.#gcObserver.disconnect();
    this.#started = false;
    return {
      cpuSystemMicros: cpu.system,
      cpuUserMicros: cpu.user,
      eventLoopDelayP99Ms: this.#eventLoop.percentile(99) / NANOS_PER_MILLISECOND,
      gcCount: this.#gcCount,
      gcDurationMs: this.#gcDurationMs,
      rssDeltaBytes: process.memoryUsage.rss() - this.#rssStart,
    };
  }
}
