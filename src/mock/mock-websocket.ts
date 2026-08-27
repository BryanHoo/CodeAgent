export class MockWebSocket extends EventTarget implements WebSocket {
  public readonly CONNECTING = WebSocket.CONNECTING;
  public readonly OPEN = WebSocket.OPEN;
  public readonly CLOSING = WebSocket.CLOSING;
  public readonly CLOSED = WebSocket.CLOSED;
  public binaryType: BinaryType = "blob";
  public readonly bufferedAmount = 0;
  public readonly extensions = "";
  public onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  public onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  public onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  public onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  public readonly protocol = "";
  public readyState: WebSocket["readyState"] = WebSocket.CONNECTING;
  public readonly url: string;

  public constructor(url: string) {
    super();
    this.url = url;
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      const event = new Event("open");
      this.dispatchEvent(event);
      this.onopen?.call(this, event);

      const afterSequence = Number(new URL(this.url).searchParams.get("afterSequence") ?? "0");
      const readyEvent = new MessageEvent("message", {
        data: JSON.stringify({
          latestSequence: afterSequence,
          sessionId: "e2e-session",
          type: "connection.ready",
          version: 3,
        }),
      });
      this.dispatchEvent(readyEvent);
      this.onmessage?.call(this, readyEvent);
    });
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    const event = new CloseEvent("close", { code: 1000, reason: "Mock connection closed" });
    this.dispatchEvent(event);
    this.onclose?.call(this, event);
  }

  public send(): void {
    // Mock 仅维持前端连接状态，Agent 事件由本地请求结果直接投影。
  }
}

export function createMockWebSocket(url: string): WebSocket {
  return new MockWebSocket(url);
}
