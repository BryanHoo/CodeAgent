import {
  EventStreamMessageSchema,
  type AgentEvent,
  type EventStreamMessage,
  type ResyncRequired,
} from "@code-agent/protocol";
import { Value } from "@sinclair/typebox/value";

export interface NativeEventSubscription {
  readonly id: string;
  unsubscribe: () => boolean;
}

export interface NativeEventEngine {
  eventSubscribe(
    requestId: string,
    projectId: string,
    sessionId: string,
    afterSequence: number,
    callback: (frame: Uint8Array) => void,
  ): NativeEventSubscription;
}

export interface NodeEventCallbacks {
  afterSequence: number;
  onConnectionState?: (state: "closed" | "connected" | "connecting") => void;
  onError?: (error: Error) => void;
  onEvent: (event: AgentEvent) => void;
  onResyncRequired: (message: ResyncRequired) => void;
  projectId: string;
  requestId: string;
  sessionId: string;
}

function resync(
  sessionId: string,
  latestSequence: number,
  reason: ResyncRequired["reason"],
): ResyncRequired {
  return { latestSequence, reason, sessionId, type: "resync.required", version: 2 };
}

export function startNodeEventSubscription(
  engine: NativeEventEngine,
  options: NodeEventCallbacks,
): () => void {
  let active = true;
  let connectionReady = false;
  let lastSequence = options.afterSequence;
  let subscription: NativeEventSubscription | undefined;

  const close = (): void => {
    subscription?.unsubscribe();
    subscription = undefined;
    options.onConnectionState?.("closed");
  };
  const stopForResync = (message: ResyncRequired): void => {
    if (!active) return;
    active = false;
    options.onResyncRequired(message);
    close();
  };
  const fail = (message: string, cause?: unknown): void => {
    if (!active) return;
    active = false;
    options.onError?.(new Error(message, cause === undefined ? undefined : { cause }));
    close();
  };
  const receive = (bytes: Uint8Array): void => {
    if (!active) return;
    let frame: unknown;
    try {
      frame = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    } catch (error) {
      fail("Native event frame is not valid JSON", error);
      return;
    }
    if (!Value.Check(EventStreamMessageSchema, frame)) {
      fail("Native event frame does not match the protocol schema");
      return;
    }
    const message = frame as EventStreamMessage;
    if (message.type === "resync.required") {
      stopForResync(message);
      return;
    }
    if (message.type === "connection.ready") {
      if (message.sessionId !== options.sessionId || message.latestSequence < lastSequence) {
        stopForResync(resync(message.sessionId, message.latestSequence, "session_changed"));
        return;
      }
      connectionReady = true;
      options.onConnectionState?.("connected");
      return;
    }
    if (!connectionReady) {
      fail("Native event arrived before connection.ready");
      return;
    }
    if (message.sessionId !== options.sessionId) {
      stopForResync(resync(message.sessionId, message.sequence, "session_changed"));
      return;
    }
    if (message.sequence <= lastSequence) return;
    if (message.sequence !== lastSequence + 1) {
      stopForResync(resync(message.sessionId, message.sequence, "sequence_gap"));
      return;
    }
    lastSequence = message.sequence;
    options.onEvent(message);
  };

  options.onConnectionState?.("connecting");
  try {
    subscription = engine.eventSubscribe(
      options.requestId,
      options.projectId,
      options.sessionId,
      options.afterSequence,
      receive,
    );
  } catch (error) {
    fail("Native event subscription failed", error);
  }

  return () => {
    if (!active) return;
    active = false;
    close();
  };
}
