import type { EventStreamMessage } from "@code-agent/protocol";

const EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const EVENT_SOCKET_HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;

export interface EventStreamSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  close: (code: number, reason: string) => void;
  send: (data: string) => void;
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
  socket.send(JSON.stringify(message));
  return true;
}
