import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentEvent, EventCheckpoint } from "@code-agent/protocol";

type AgentEventListener = (event: AgentEvent) => void;
type DeltaEventType = "command.output_delta" | "message.delta" | "reasoning.delta";
type DeltaProviderEvent = Extract<AgentProviderEvent, Readonly<{ type: DeltaEventType }>>;

export type AgentEventReplay =
  | Readonly<{ events: readonly AgentEvent[]; type: "events" }>
  | Readonly<{
      latestSequence: number;
      reason: "event_retention_exceeded" | "session_changed";
      type: "resync";
    }>;

export interface AgentEventStreamMetrics {
  backpressureSignals: number;
  coalescedEvents: number;
  pendingDeltas: number;
  providerEventsReceived: number;
  publishedEvents: number;
  retainedEvents: number;
  retentionEvictions: number;
}

export interface AgentEventStreamOptions {
  capacity?: number;
  coalescingWindowMs?: number;
  now?: () => Date;
  pressureCoalescingWindowMs?: number;
  provider: string;
  sessionId: string;
}

const DEFAULT_COALESCING_WINDOW_MS = 16;
const DEFAULT_PRESSURE_COALESCING_WINDOW_MS = 32;

function isDeltaEvent(event: AgentProviderEvent): event is DeltaProviderEvent {
  return (
    event.type === "command.output_delta" ||
    event.type === "message.delta" ||
    event.type === "reasoning.delta"
  );
}

function deltaKey(event: DeltaProviderEvent): string {
  const field = event.type === "reasoning.delta" ? event.payload.field : "delta";
  return JSON.stringify([event.taskId, event.turnId, event.itemId, event.type, field]);
}

function mergeDelta(left: DeltaProviderEvent, right: DeltaProviderEvent): DeltaProviderEvent {
  return {
    ...left,
    payload: { ...left.payload, delta: left.payload.delta + right.payload.delta },
  } as DeltaProviderEvent;
}

export class AgentEventStream {
  readonly #capacity: number;
  readonly #coalescingWindowMs: number;
  readonly #events: (AgentEvent | undefined)[];
  readonly #listeners = new Set<AgentEventListener>();
  readonly #now: () => Date;
  readonly #pendingDeltas = new Map<string, DeltaProviderEvent>();
  readonly #pressureCoalescingWindowMs: number;
  readonly #provider: string;
  readonly #sessionId: string;
  #backpressureSignals = 0;
  #closed = false;
  #coalescedEvents = 0;
  #eventCount = 0;
  #eventStart = 0;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #providerEventsReceived = 0;
  #publishedEvents = 0;
  #retentionEvictions = 0;
  #sequence = 0;
  #usePressureWindow = false;

  public constructor(options: AgentEventStreamOptions) {
    const capacity = options.capacity ?? 1_000;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Agent Event capacity must be a positive integer");
    }
    const coalescingWindowMs = options.coalescingWindowMs ?? DEFAULT_COALESCING_WINDOW_MS;
    const pressureCoalescingWindowMs =
      options.pressureCoalescingWindowMs ?? DEFAULT_PRESSURE_COALESCING_WINDOW_MS;
    if (!Number.isFinite(coalescingWindowMs) || coalescingWindowMs <= 0) {
      throw new RangeError("Agent Event coalescing window must be a positive number");
    }
    if (
      !Number.isFinite(pressureCoalescingWindowMs) ||
      pressureCoalescingWindowMs < coalescingWindowMs
    ) {
      throw new RangeError(
        "Agent Event pressure coalescing window must not be shorter than the normal window",
      );
    }
    this.#capacity = capacity;
    this.#coalescingWindowMs = coalescingWindowMs;
    this.#events = new Array<AgentEvent | undefined>(capacity);
    this.#now = options.now ?? (() => new Date());
    this.#pressureCoalescingWindowMs = pressureCoalescingWindowMs;
    this.#provider = options.provider;
    this.#sessionId = options.sessionId;
  }

  public get checkpoint(): EventCheckpoint {
    // Snapshot checkpoint 必须覆盖此前已收到但尚未分配 Sequence 的 Delta。
    this.#flush();
    return { sequence: this.#sequence, sessionId: this.#sessionId };
  }

  public get metrics(): Readonly<AgentEventStreamMetrics> {
    return {
      backpressureSignals: this.#backpressureSignals,
      coalescedEvents: this.#coalescedEvents,
      pendingDeltas: this.#pendingDeltas.size,
      providerEventsReceived: this.#providerEventsReceived,
      publishedEvents: this.#publishedEvents,
      retainedEvents: this.#eventCount,
      retentionEvictions: this.#retentionEvictions,
    };
  }

  public publish(event: AgentProviderEvent): void {
    if (this.#closed) {
      return;
    }
    this.#providerEventsReceived += 1;
    if (!isDeltaEvent(event)) {
      // 关键状态必须排在所有更早 Delta 之后，不能等待定时窗口。
      this.#flush();
      this.#publishNow(event);
      return;
    }

    const key = deltaKey(event);
    const existing = this.#pendingDeltas.get(key);
    if (existing === undefined) {
      this.#pendingDeltas.set(key, event);
    } else {
      this.#pendingDeltas.set(key, mergeDelta(existing, event));
      this.#coalescedEvents += 1;
    }
    this.#scheduleFlush();
  }

  public noteBackpressure(): void {
    if (this.#closed) {
      return;
    }
    this.#backpressureSignals += 1;
    this.#usePressureWindow = true;
  }

  public replayAfter(sequence: number): AgentEventReplay {
    this.#flush();
    if (sequence > this.#sequence) {
      return { latestSequence: this.#sequence, reason: "session_changed", type: "resync" };
    }
    const retained = this.#retainedEvents();
    const oldestSequence = retained[0]?.sequence;
    if (oldestSequence !== undefined && sequence < oldestSequence - 1) {
      return {
        latestSequence: this.#sequence,
        reason: "event_retention_exceeded",
        type: "resync",
      };
    }
    return { events: retained.filter((event) => event.sequence > sequence), type: "events" };
  }

  public subscribe(listener: AgentEventListener): () => void {
    if (this.#closed) {
      return () => undefined;
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#flush();
    this.#closed = true;
    this.#listeners.clear();
  }

  #flush(): void {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    if (this.#pendingDeltas.size === 0) {
      return;
    }
    const pending = [...this.#pendingDeltas.values()];
    this.#pendingDeltas.clear();
    for (const event of pending) {
      this.#publishNow(event);
    }
  }

  #publishNow(event: AgentProviderEvent): void {
    this.#sequence += 1;
    const published = {
      ...event,
      provider: this.#provider,
      sequence: this.#sequence,
      sessionId: this.#sessionId,
      timestamp: this.#now().toISOString(),
      version: 2 as const,
    } as AgentEvent;
    if (this.#eventCount < this.#capacity) {
      const insertionIndex = (this.#eventStart + this.#eventCount) % this.#capacity;
      this.#events[insertionIndex] = published;
      this.#eventCount += 1;
    } else {
      this.#events[this.#eventStart] = published;
      this.#eventStart = (this.#eventStart + 1) % this.#capacity;
      this.#retentionEvictions += 1;
    }
    this.#publishedEvents += 1;
    for (const listener of this.#listeners) {
      listener(published);
    }
  }

  #retainedEvents(): AgentEvent[] {
    const retained: AgentEvent[] = [];
    for (let offset = 0; offset < this.#eventCount; offset += 1) {
      const event = this.#events[(this.#eventStart + offset) % this.#capacity];
      if (event !== undefined) {
        retained.push(event);
      }
    }
    return retained;
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined) {
      return;
    }
    const delay = this.#usePressureWindow
      ? this.#pressureCoalescingWindowMs
      : this.#coalescingWindowMs;
    this.#usePressureWindow = false;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.#flush();
    }, delay);
  }
}
