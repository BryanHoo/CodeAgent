import { Buffer } from "node:buffer";

import {
  MAX_EVENT_BATCH_SIZE,
  type AgentEvent,
  type EventBatch,
  type EventStreamMessage,
} from "@code-agent/protocol";

const EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const EVENT_SOCKET_HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;
const serializedMessages = new WeakMap<object, SerializedEventStreamMessage>();

export type SerializedEventStreamMessage = Readonly<{
  byteLength: number;
  data: string;
}>;

export interface EventStreamSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  close: (code: number, reason: string) => void;
  send: (data: string) => void;
}

function serializeEventStreamValue(value: object): SerializedEventStreamMessage {
  const cached = serializedMessages.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const data = JSON.stringify(value);
  const serialized = { byteLength: Buffer.byteLength(data), data };
  // WeakMap 只随协议对象存活，复用序列化结果且不延长事件生命周期。
  serializedMessages.set(value, serialized);
  return serialized;
}

export function serializeEventStreamMessage(
  message: EventStreamMessage,
): SerializedEventStreamMessage {
  return serializeEventStreamValue(message);
}

export function getSerializedAgentEventByteLength(event: AgentEvent): number {
  return serializeEventStreamValue(event).byteLength;
}

export function sendEventStreamMessage(
  socket: EventStreamSocket,
  message: EventStreamMessage,
  onSoftBackpressure: () => void,
  onSlowClientDisconnect: () => void,
): boolean {
  if (socket.readyState !== 1) {
    return false;
  }
  if (socket.bufferedAmount > EVENT_SOCKET_HARD_BACKPRESSURE_BYTES) {
    // 硬上限必须在序列化和 send 前断开，避免慢客户端继续扩大进程内缓冲。
    onSlowClientDisconnect();
    socket.close(1013, "Client is too slow; refresh the snapshot");
    return false;
  }
  if (socket.bufferedAmount > EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES) {
    onSoftBackpressure();
  }
  socket.send(serializeEventStreamMessage(message).data);
  return true;
}

export function sendEventStreamEvents(
  socket: EventStreamSocket,
  events: readonly AgentEvent[],
  onSoftBackpressure: () => void,
  onSlowClientDisconnect: () => void,
): boolean {
  for (let offset = 0; offset < events.length; offset += MAX_EVENT_BATCH_SIZE) {
    const message: EventBatch = {
      events: events.slice(offset, offset + MAX_EVENT_BATCH_SIZE),
      type: "events.batch",
      version: 3,
    };
    if (!sendEventStreamMessage(socket, message, onSoftBackpressure, onSlowClientDisconnect)) {
      return false;
    }
  }
  return true;
}
