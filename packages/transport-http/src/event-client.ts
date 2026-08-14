import type { AgentEventConnectionState, SubscribeAgentEventsOptions } from "@code-agent/client";
import {
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SCOPE_ID,
  checkEventStreamMessage,
  type ResyncRequired,
} from "@code-agent/protocol";

export type { AgentEventConnectionState, SubscribeAgentEventsOptions } from "@code-agent/client";

export type WebSocketFactory = (url: string) => WebSocket;

const textDecoder = new TextDecoder();

interface StartAgentEventSubscriptionOptions extends SubscribeAgentEventsOptions {
  baseUrl: string;
  webSocketFactory: WebSocketFactory;
}

export class CodeAgentEventError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodeAgentEventError";
  }
}

function createEventUrl(baseUrl: string, projectId: string, afterSequence: number): string {
  const path =
    projectId === TEMPORARY_TASK_SCOPE_ID
      ? `${TEMPORARY_TASK_API_PATH}/events`
      : `/v1/projects/${encodeURIComponent(projectId)}/events`;
  const browserLocation = (globalThis as typeof globalThis & { location: { href: string } })
    .location;
  const httpUrl = baseUrl ? new URL(`${baseUrl}${path}`) : new URL(path, browserLocation.href);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  httpUrl.searchParams.set("afterSequence", String(afterSequence));
  return httpUrl.toString();
}

function createResyncRequired(
  sessionId: string,
  latestSequence: number,
  reason: ResyncRequired["reason"],
): ResyncRequired {
  return {
    latestSequence,
    reason,
    sessionId,
    type: "resync.required",
    version: 2,
  };
}

export function startAgentEventSubscription(
  options: StartAgentEventSubscriptionOptions,
): () => void {
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;
  let active = true;
  let allowReconnect = true;
  let lastSequence = options.afterSequence;
  let reconnectAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let detachSocketListeners: (() => void) | undefined;

  const setState = (state: AgentEventConnectionState) => {
    options.onConnectionState?.(state);
  };

  const closeSocket = (code: number, reason: string) => {
    const currentSocket = socket;
    if (currentSocket === undefined) {
      return;
    }
    detachSocketListeners?.();
    detachSocketListeners = undefined;
    socket = undefined;
    currentSocket.close(code, reason);
  };

  const stopForResync = (message: ResyncRequired) => {
    allowReconnect = false;
    options.onResyncRequired(message);
    closeSocket(1000, "Snapshot resync required");
    setState("closed");
  };

  const failProtocol = (message: string, cause?: unknown) => {
    allowReconnect = false;
    options.onError?.(
      new CodeAgentEventError(message, cause === undefined ? undefined : { cause }),
    );
    closeSocket(1002, "Invalid Agent Event frame");
    setState("closed");
  };

  const connect = () => {
    if (!active) {
      return;
    }
    retryTimer = undefined;
    let connectionReady = false;
    const currentSocket = options.webSocketFactory(
      createEventUrl(options.baseUrl, options.projectId, lastSequence),
    );
    currentSocket.binaryType = "arraybuffer";
    socket = currentSocket;

    const onMessage = (event: MessageEvent) => {
      if (!active || socket !== currentSocket) {
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) {
        failProtocol("CodeAgent event frame must be binary");
        return;
      }
      let frame: unknown;
      // WebSocket 只交付 ArrayBuffer；浏览器在协议校验前仅执行一次 UTF-8 解码。
      const wireFrame = textDecoder.decode(event.data);
      try {
        frame = JSON.parse(wireFrame) as unknown;
      } catch (error) {
        failProtocol("CodeAgent event frame is not valid JSON", error);
        return;
      }
      if (!checkEventStreamMessage(frame)) {
        failProtocol("CodeAgent event frame does not match the protocol schema");
        return;
      }
      // Agent Event Schema 不含 Transform，Check 成功后直接使用已验证数据，避免二次深遍历。
      const message = frame;

      if (message.type === "resync.required") {
        stopForResync(message);
        return;
      }
      if (message.type === "connection.ready") {
        if (message.sessionId !== options.sessionId || message.latestSequence < lastSequence) {
          stopForResync(
            createResyncRequired(message.sessionId, message.latestSequence, "session_changed"),
          );
          return;
        }
        connectionReady = true;
        reconnectAttempt = 0;
        setState("connected");
        return;
      }
      if (!connectionReady) {
        failProtocol("CodeAgent event arrived before connection.ready");
        return;
      }
      if (message.sessionId !== options.sessionId) {
        stopForResync(createResyncRequired(message.sessionId, message.sequence, "session_changed"));
        return;
      }
      if (message.sequence <= lastSequence) {
        return;
      }
      if (message.sequence !== lastSequence + 1) {
        stopForResync(createResyncRequired(message.sessionId, message.sequence, "sequence_gap"));
        return;
      }
      lastSequence = message.sequence;
      options.onPerformanceSample?.({
        at: performance.now(),
        point: "transport_received",
        sequence: message.sequence,
      });
      options.onEvent(message, event.data.byteLength);
    };

    const onError = () => {
      if (!active || socket !== currentSocket) {
        return;
      }
      options.onError?.(new CodeAgentEventError("CodeAgent event connection failed"));
    };

    const onClose = () => {
      if (socket !== currentSocket) {
        return;
      }
      detachSocketListeners?.();
      detachSocketListeners = undefined;
      socket = undefined;
      if (!active) {
        return;
      }
      if (!allowReconnect) {
        setState("closed");
        return;
      }
      setState("reconnecting");
      const delay = Math.min(reconnectDelayMs * 2 ** reconnectAttempt, 5_000);
      reconnectAttempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    // 保存处理器引用，确保取消或替换连接后不会交付迟到事件。
    detachSocketListeners = () => {
      currentSocket.removeEventListener("message", onMessage);
      currentSocket.removeEventListener("error", onError);
      currentSocket.removeEventListener("close", onClose);
    };
    currentSocket.addEventListener("message", onMessage);
    currentSocket.addEventListener("error", onError);
    currentSocket.addEventListener("close", onClose);
  };

  setState("connecting");
  connect();

  return () => {
    if (!active) {
      return;
    }
    active = false;
    allowReconnect = false;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
    }
    closeSocket(1000, "Subscription cancelled");
    setState("closed");
  };
}
