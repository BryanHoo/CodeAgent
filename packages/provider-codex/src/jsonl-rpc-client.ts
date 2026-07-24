import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export interface JsonlRpcClientOptions {
  input: Readable;
  output: Writable;
  defaultTimeoutMs?: number;
  closeOnInputEnd?: boolean;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface RpcNotification {
  method: string;
  params: unknown;
}

export type RpcRequestId = string | number;

export interface RpcServerRequest {
  id: RpcRequestId;
  method: string;
  params: unknown;
}

export interface RpcErrorPayload {
  code: number;
  data: unknown;
  message: string;
}

type NotificationListener = (notification: RpcNotification) => void;
type ErrorListener = (error: Error) => void;
type ServerRequestListener = (request: RpcServerRequest) => void;

export class RpcConnectionClosedError extends Error {
  public constructor(message = "RPC connection is closed") {
    super(message);
    this.name = "RpcConnectionClosedError";
  }
}

export class RpcProtocolError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RpcProtocolError";
  }
}

export class RpcResponseError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  public constructor(error: RpcErrorPayload) {
    super(error.message);
    this.name = "RpcResponseError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class RpcTimeoutError extends Error {
  public readonly method: string;
  public readonly requestId: number;
  public readonly timeoutMs: number;

  public constructor(requestId: number, method: string, timeoutMs: number) {
    super(`RPC request ${method} (${String(requestId)}) timed out after ${String(timeoutMs)}ms`);
    this.name = "RpcTimeoutError";
    this.method = method;
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RpcRequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function parseRpcError(value: unknown): RpcErrorPayload | null {
  if (
    !isRecord(value) ||
    typeof value["code"] !== "number" ||
    typeof value["message"] !== "string"
  ) {
    return null;
  }
  return { code: value["code"], data: value["data"], message: value["message"] };
}

export class JsonlRpcClient {
  readonly #defaultTimeoutMs: number;
  readonly #closeOnInputEnd: boolean;
  readonly #decoder = new StringDecoder("utf8");
  readonly #errorListeners = new Set<ErrorListener>();
  readonly #input: Readable;
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #output: Writable;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  #buffer = "";
  #closed = false;
  #nextRequestId = 1;

  public constructor(options: JsonlRpcClientOptions) {
    this.#input = options.input;
    this.#output = options.output;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.#closeOnInputEnd = options.closeOnInputEnd ?? true;

    this.#input.on("data", this.#handleData);
    this.#input.on("end", this.#handleInputEnd);
    this.#input.on("error", this.#handleStreamError);
    this.#output.on("error", this.#handleStreamError);
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public request(
    method: string,
    params?: unknown,
    timeoutMs = this.#defaultTimeoutMs,
  ): Promise<unknown> {
    this.#assertOpen();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("RPC timeout must be a positive finite number");
    }

    const id = this.#nextRequestId++;
    const request = params === undefined ? { id, method } : { id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) {
          reject(new RpcTimeoutError(id, method, timeoutMs));
        }
      }, timeoutMs);
      timer.unref();
      this.#pending.set(id, { reject, resolve, timer });

      try {
        void this.#sendMessage(request).catch(() => undefined);
      } catch {
        // #sendMessage 已关闭连接并拒绝当前 Pending RPC。
      }
    });
  }

  public notify(method: string, params?: unknown): void {
    const notification = params === undefined ? { method } : { method, params };
    void this.#sendMessage(notification).catch(() => undefined);
  }

  public onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  public onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  public onServerRequest(listener: ServerRequestListener): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  public respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> {
    if (!isRequestId(id)) {
      throw new TypeError("RPC request id must be a string or finite number");
    }
    return this.#sendMessage({ id, result });
  }

  public rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void> {
    if (!isRequestId(id)) {
      throw new TypeError("RPC request id must be a string or finite number");
    }
    return this.#sendMessage({ error, id });
  }

  #sendMessage(message: unknown): Promise<void> {
    this.#assertOpen();
    let pendingWrite: Promise<void>;
    try {
      pendingWrite = this.#writeMessage(message);
    } catch (error) {
      const connectionError = this.#toConnectionError(error);
      this.#fail(connectionError);
      throw connectionError;
    }
    return pendingWrite.catch((error: unknown) => {
      const connectionError = this.#toConnectionError(error);
      this.#fail(connectionError);
      throw connectionError;
    });
  }

  public close(reason: Error = new RpcConnectionClosedError()): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    this.#input.off("data", this.#handleData);
    this.#input.off("end", this.#handleInputEnd);
    this.#input.off("error", this.#handleStreamError);
    this.#output.off("error", this.#handleStreamError);

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#notificationListeners.clear();
    this.#serverRequestListeners.clear();
    this.#errorListeners.clear();
  }

  readonly #handleData = (chunk: Buffer | string): void => {
    // 保留跨 Buffer 边界的 UTF-8 字节，避免静默损坏多字节字符。
    this.#buffer += this.#decoder.write(
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
    );

    // 保留最后一个不完整帧，直到后续 chunk 补齐换行符。
    let newlineIndex = this.#buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        try {
          this.#handleLine(line);
        } catch (error) {
          const protocolError =
            error instanceof RpcProtocolError
              ? error
              : new RpcProtocolError(`Invalid JSONL frame: ${line}`, { cause: error });
          this.#fail(protocolError);
          return;
        }
      }
      newlineIndex = this.#buffer.indexOf("\n");
    }
  };

  readonly #handleInputEnd = (): void => {
    this.#buffer += this.#decoder.end();
    if (this.#buffer.trim()) {
      this.#fail(new RpcProtocolError("RPC input ended with an incomplete JSONL frame"));
      return;
    }
    if (this.#closeOnInputEnd) {
      this.close(new RpcConnectionClosedError("RPC input stream ended"));
    }
  };

  readonly #handleStreamError = (error: Error): void => {
    this.#fail(new RpcConnectionClosedError(`RPC stream failed: ${error.message}`));
  };

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch (error) {
      throw new RpcProtocolError(`Invalid JSONL frame: ${line}`, { cause: error });
    }
    if (!isRecord(message)) {
      throw new RpcProtocolError("RPC frame must be a JSON object");
    }

    const id = message["id"];
    if (typeof id === "number" && ("result" in message || "error" in message)) {
      this.#handleResponse(id, message);
      return;
    }
    const method = message["method"];
    if (
      isRequestId(id) &&
      typeof method === "string" &&
      !("result" in message) &&
      !("error" in message)
    ) {
      const request = { id, method, params: message["params"] };
      for (const listener of this.#serverRequestListeners) {
        listener(request);
      }
      return;
    }
    if (!("id" in message) && typeof method === "string") {
      const notification = { method, params: message["params"] };
      for (const listener of this.#notificationListeners) {
        listener(notification);
      }
      return;
    }

    throw new RpcProtocolError("RPC frame is neither a response, server request, nor notification");
  }

  #handleResponse(id: number, message: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }

    if ("error" in message) {
      const error = parseRpcError(message["error"]);
      if (!error) {
        throw new RpcProtocolError("RPC error response has an invalid error payload");
      }
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new RpcResponseError(error));
      return;
    }
    if (!("result" in message)) {
      throw new RpcProtocolError("RPC response is missing result or error");
    }
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(message["result"]);
  }

  #writeMessage(message: unknown): Promise<void> {
    const frame = `${JSON.stringify(message)}\n`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new RpcConnectionClosedError(
            `RPC write timed out after ${String(this.#defaultTimeoutMs)}ms`,
          ),
        );
      }, this.#defaultTimeoutMs);
      timer.unref();
      this.#output.write(frame, "utf8", (error) => {
        clearTimeout(timer);
        if (error) {
          reject(new RpcConnectionClosedError(`RPC write failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new RpcConnectionClosedError();
    }
  }

  #fail(error: Error): void {
    if (this.#closed) {
      return;
    }
    for (const listener of this.#errorListeners) {
      listener(error);
    }
    this.close(error);
  }

  #toConnectionError(error: unknown): RpcConnectionClosedError {
    if (error instanceof RpcConnectionClosedError) {
      return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new RpcConnectionClosedError(`RPC write failed: ${reason}`);
  }
}
