const browserSessionWebSocketEvents = new EventTarget();
const WEB_SOCKET_DISCONNECTED_EVENT = "websocket-disconnected";

export function notifyBrowserSessionWebSocketDisconnected(): void {
  browserSessionWebSocketEvents.dispatchEvent(new Event(WEB_SOCKET_DISCONNECTED_EVENT));
}

export function subscribeBrowserSessionWebSocketDisconnected(listener: () => void): () => void {
  browserSessionWebSocketEvents.addEventListener(WEB_SOCKET_DISCONNECTED_EVENT, listener);
  return () => {
    browserSessionWebSocketEvents.removeEventListener(WEB_SOCKET_DISCONNECTED_EVENT, listener);
  };
}
