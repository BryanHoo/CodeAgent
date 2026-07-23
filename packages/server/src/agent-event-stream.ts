import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentEvent, EventCheckpoint } from "@code-agent/protocol";

type AgentEventListener = (event: AgentEvent) => void;

export type AgentEventReplay =
  | Readonly<{ events: readonly AgentEvent[]; type: "events" }>
  | Readonly<{
      latestSequence: number;
      reason: "event_retention_exceeded" | "session_changed";
      type: "resync";
    }>;

export interface AgentEventStreamOptions {
  capacity?: number;
  now?: () => Date;
  provider: string;
  sessionId: string;
}

export class AgentEventStream {
  readonly #capacity: number;
  readonly #events: AgentEvent[] = [];
  readonly #listeners = new Set<AgentEventListener>();
  readonly #now: () => Date;
  readonly #provider: string;
  readonly #sessionId: string;
  #sequence = 0;

  public constructor(options: AgentEventStreamOptions) {
    const capacity = options.capacity ?? 1_000;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Agent Event capacity must be a positive integer");
    }
    this.#capacity = capacity;
    this.#now = options.now ?? (() => new Date());
    this.#provider = options.provider;
    this.#sessionId = options.sessionId;
  }

  public get checkpoint(): EventCheckpoint {
    return { sequence: this.#sequence, sessionId: this.#sessionId };
  }

  public publish(event: AgentProviderEvent): AgentEvent {
    this.#sequence += 1;
    const published = {
      ...event,
      provider: this.#provider,
      sequence: this.#sequence,
      sessionId: this.#sessionId,
      timestamp: this.#now().toISOString(),
      version: 1 as const,
    } as AgentEvent;
    this.#events.push(published);
    if (this.#events.length > this.#capacity) {
      this.#events.shift();
    }
    for (const listener of this.#listeners) {
      listener(published);
    }
    return published;
  }

  public replayAfter(sequence: number): AgentEventReplay {
    if (sequence > this.#sequence) {
      return { latestSequence: this.#sequence, reason: "session_changed", type: "resync" };
    }
    const oldestSequence = this.#events[0]?.sequence;
    if (oldestSequence !== undefined && sequence < oldestSequence - 1) {
      return {
        latestSequence: this.#sequence,
        reason: "event_retention_exceeded",
        type: "resync",
      };
    }
    return { events: this.#events.filter((event) => event.sequence > sequence), type: "events" };
  }

  public subscribe(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
