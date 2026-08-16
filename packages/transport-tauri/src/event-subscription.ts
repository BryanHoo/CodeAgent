import { type SubscribeAgentEventsOptions, normalizeCodeAgentError } from "@code-agent/client";
import type { EventStreamMessage, ResyncRequired } from "@code-agent/protocol";
import { Channel, invoke } from "@tauri-apps/api/core";

const PULL_BATCH_MAGIC = 0x4341_4550;
const PULL_MAX_BYTES = 256 * 1024;
const PULL_MAX_EVENTS = 64;
const textDecoder = new TextDecoder();

type EventAvailable = Readonly<{ type: "event.available" }>;

function resync(
  sessionId: string,
  latestSequence: number,
  reason: ResyncRequired["reason"],
): ResyncRequired {
  return { latestSequence, reason, sessionId, type: "resync.required", version: 2 };
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  throw new Error("Tauri event pull returned a non-binary payload");
}

function decodePullBatch(payload: unknown): Readonly<{ frameBytes: number[]; frames: unknown[] }> {
  const bytes = asBytes(payload);
  if (bytes.byteLength < 8) throw new Error("Tauri event pull batch is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== PULL_BATCH_MAGIC) {
    throw new Error("Tauri event pull batch magic is invalid");
  }
  const count = view.getUint32(4, true);
  const frames: unknown[] = [];
  const frameBytes: number[] = [];
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > bytes.byteLength) throw new Error("Tauri event pull batch is truncated");
    const frameLen = view.getUint32(offset, true);
    offset += 4;
    if (offset + frameLen > bytes.byteLength)
      throw new Error("Tauri event pull batch is truncated");
    frames.push(JSON.parse(textDecoder.decode(bytes.subarray(offset, offset + frameLen))));
    frameBytes.push(frameLen);
    offset += frameLen;
  }
  return { frameBytes, frames };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function startTauriEventSubscription(options: SubscribeAgentEventsOptions): () => void {
  let active = true;
  let connectionReady = false;
  let lastSequence = options.afterSequence;
  let pendingNotify = false;
  let pulling = false;
  let pullToken = 0;
  let subscriptionId: string | undefined;
  const isOpen = () => active;
  const reportError = (error: unknown) => {
    options.onError?.(normalizeCodeAgentError(error));
  };

  const stopForResync = (message: ResyncRequired) => {
    if (!active) return;
    active = false;
    pullToken += 1;
    options.onResyncRequired(message);
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };
  const fail = (error: unknown) => {
    if (!active) return;
    active = false;
    pullToken += 1;
    reportError(error);
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };

  const applyFrame = (frame: unknown, wireBytes: number) => {
    if (!active) return;
    if (!isRecord(frame) || typeof frame["type"] !== "string") {
      fail(new Error("Tauri event pull returned an invalid frame"));
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
    options.onPerformanceSample?.({
      at: performance.now(),
      point: "transport_received",
      sequence: message.sequence,
    });
    options.onEvent(message, wireBytes);
  };

  const drainPulls = async () => {
    if (!isOpen() || pulling || subscriptionId === undefined) return;
    pulling = true;
    try {
      while (isOpen() && pendingNotify) {
        pendingNotify = false;
        const token = (pullToken += 1);
        const raw = await invoke("event_pull", {
          maxBytes: PULL_MAX_BYTES,
          maxEvents: PULL_MAX_EVENTS,
          subscriptionId,
        });
        if (!isOpen() || token !== pullToken) return;
        const batch = decodePullBatch(raw);
        let totalBytes = 0;
        for (let index = 0; index < batch.frames.length; index += 1) {
          const frameLen = batch.frameBytes[index] ?? 0;
          totalBytes += frameLen;
          applyFrame(batch.frames[index], frameLen);
          if (!isOpen()) return;
        }
        if (
          batch.frames.length > 0 &&
          (batch.frames.length >= PULL_MAX_EVENTS || totalBytes >= PULL_MAX_BYTES)
        ) {
          pendingNotify = true;
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      pulling = false;
    }
    if (isOpen() && pendingNotify) void drainPulls();
  };

  const channel = new Channel<EventAvailable>();
  channel.onmessage = () => {
    if (!active) return;
    pendingNotify = true;
    void drainPulls();
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
      void drainPulls();
      return undefined;
    })
    .catch(fail);

  return () => {
    if (!active) return;
    active = false;
    pullToken += 1;
    options.onConnectionState?.("closed");
    if (subscriptionId !== undefined) {
      void invoke("event_unsubscribe", { subscriptionId }).catch(reportError);
    }
  };
}
