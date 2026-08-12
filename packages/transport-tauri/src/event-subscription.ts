import { type SubscribeAgentEventsOptions, normalizeCodeAgentError } from "@code-agent/client";
import {
  EventStreamMessageSchema,
  type EventStreamMessage,
  type ResyncRequired,
} from "@code-agent/protocol";
import { Value } from "@sinclair/typebox/value";
import { Channel, invoke } from "@tauri-apps/api/core";

function resync(
  sessionId: string,
  latestSequence: number,
  reason: ResyncRequired["reason"],
): ResyncRequired {
  return { latestSequence, reason, sessionId, type: "resync.required", version: 2 };
}

export function startTauriEventSubscription(options: SubscribeAgentEventsOptions): () => void {
  let active = true;
  let connectionReady = false;
  let lastSequence = options.afterSequence;
  let subscriptionId: string | undefined;

  const stopForResync = (message: ResyncRequired) => {
    if (!active) return;
    active = false;
    options.onResyncRequired(message);
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(() => undefined);
    }
  };
  const fail = (error: unknown) => {
    if (!active) return;
    active = false;
    options.onError?.(normalizeCodeAgentError(error));
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(() => undefined);
    }
  };

  const channel = new Channel<unknown>();
  channel.onmessage = (frame) => {
    if (!active) return;
    if (!Value.Check(EventStreamMessageSchema, frame)) {
      fail(new Error("Tauri event frame does not match the protocol schema"));
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
      fail(new Error("Tauri event arrived before connection.ready"));
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
  void invoke<{ subscriptionId: string }>("event_subscribe", {
    afterSequence: options.afterSequence,
    channel,
    projectId: options.projectId,
    requestId: crypto.randomUUID(),
    sessionId: options.sessionId,
  })
    .then((response) => {
      if (!active) {
        return invoke("event_unsubscribe", { subscriptionId: response.subscriptionId });
      }
      subscriptionId = response.subscriptionId;
      return undefined;
    })
    .catch(fail);

  return () => {
    if (!active) return;
    active = false;
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(() => undefined);
    }
  };
}
