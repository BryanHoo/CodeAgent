import { type SubscribeAgentEventsOptions, normalizeCodeAgentError } from "@code-agent/client";
import type { EventStreamMessage, ResyncRequired } from "@code-agent/protocol";
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
  const reportError = (error: unknown) => {
    options.onError?.(normalizeCodeAgentError(error));
  };

  const stopForResync = (message: ResyncRequired) => {
    if (!active) return;
    active = false;
    options.onResyncRequired(message);
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };
  const fail = (error: unknown) => {
    if (!active) return;
    active = false;
    reportError(error);
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };

  // Rust Runtime 已在发布前完成协议校验，IPC Channel 直接消费可信类型，避免主线程重复深遍历。
  const channel = new Channel<EventStreamMessage>();
  channel.onmessage = (message) => {
    if (!active) return;
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
    options.onPerformanceSample?.({
      at: performance.now(),
      point: "transport_received",
      sequence: message.sequence,
    });
    options.onEvent(message, undefined);
  };

  options.onConnectionState?.("connecting");
  void invoke<{ subscriptionId: string }>("event_subscribe", {
    afterSequence: options.afterSequence,
    channel,
    leaseId: options.projectContextLeaseId ?? crypto.randomUUID(),
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
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };
}
