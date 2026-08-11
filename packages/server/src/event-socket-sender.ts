import { Buffer } from "node:buffer";

import type { EventStreamMessage } from "@code-agent/protocol";

const EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const EVENT_SOCKET_HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;
const serializedMessages = new WeakMap<EventStreamMessage, SerializedEventStreamMessage>();

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

export function serializeEventStreamMessage(
  message: EventStreamMessage,
): SerializedEventStreamMessage {
  const cached = serializedMessages.get(message);
  if (cached !== undefined) {
    return cached;
  }
  const data = JSON.stringify(message);
  const serialized = { byteLength: Buffer.byteLength(data), data };
  // WeakMap 只随 Event 对象存活，复用广播帧且不延长历史事件生命周期。
  serializedMessages.set(message, serialized);
  return serialized;
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
