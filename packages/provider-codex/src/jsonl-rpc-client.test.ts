import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  JsonlRpcClient,
  RpcConnectionClosedError,
  RpcProtocolError,
  RpcTimeoutError,
} from "./jsonl-rpc-client.js";
import { readStagedImage } from "./jsonl-frame-processor.js";
import type { RpcResponseError } from "./jsonl-rpc-client.js";

function createHarness(
  defaultTimeoutMs = 1_000,
  options: Readonly<{
    maxBufferBytes?: number;
    maxFrameBytes?: number;
    largeFrameThresholdBytes?: number;
    overloadRetry?: {
      baseDelayMs?: number;
      maxDelayMs?: number;
      maxElapsedMs?: number;
      maxRetries?: number;
      random?: () => number;
    };
  }> = {},
) {
  const serverOutput = new PassThrough();
  const serverInput = new PassThrough();
  const sentMessages: unknown[] = [];
  let sentBuffer = "";

  serverInput.on("data", (chunk: Buffer) => {
    sentBuffer += chunk.toString("utf8");
    const lines = sentBuffer.split("\n");
    sentBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line) {
        sentMessages.push(JSON.parse(line) as unknown);
      }
    }
  });

  const clientOptions = {
    defaultTimeoutMs,
    input: serverOutput,
    ...options,
    output: serverInput,
  };
  const client = new JsonlRpcClient(clientOptions);

  return { client, sentMessages, serverInput, serverOutput };
}

describe("JsonlRpcClient", () => {
  it("frames split JSONL chunks and correlates out-of-order responses", async () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const first = client.request("first", { value: 1 });
    const second = client.request("second", { value: 2 });

    expect(sentMessages).toEqual([
      { id: 1, method: "first", params: { value: 1 } },
      { id: 2, method: "second", params: { value: 2 } },
    ]);

    serverOutput.write('{"id":2,"result":{"order":"sec');
    serverOutput.write('ond"}}\n{"id":1,"result":{"order":"first"}}\n');

    await expect(second).resolves.toEqual({ order: "second" });
    await expect(first).resolves.toEqual({ order: "first" });
    client.close();
  });

  it("preserves UTF-8 characters split across input chunks", () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    client.onNotification(onNotification);
    const frame = Buffer.from(
      `${JSON.stringify({ method: "message/delta", params: { text: "你好" } })}\n`,
    );
    const characterStart = frame.indexOf(Buffer.from("你"));

    // 在多字节字符中间切分，模拟 stdout 的任意 Buffer 边界。
    serverOutput.write(frame.subarray(0, characterStart + 1));
    serverOutput.write(frame.subarray(characterStart + 1));

    expect(onNotification).toHaveBeenCalledWith({
      method: "message/delta",
      params: { text: "你好" },
    });
    client.close();
  });

  it("accepts bounded image generation notifications larger than 16 MiB", async () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    const received = new Promise<void>((resolve) => {
      client.onNotification((notification) => {
        onNotification(notification);
        resolve();
      });
    });
    const result = "A".repeat(17 * 1_024 * 1_024);

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: {
          item: { id: "image-1", result, status: "completed", type: "imageGeneration" },
          threadId: "task-1",
          turnId: "turn-1",
        },
      })}\n`,
    );

    await received;
    expect(onNotification).toHaveBeenCalledOnce();
    expect(client.closed).toBe(false);
    client.close();
  });

  it("keeps large-frame order and stages generated image Base64 in the worker", async () => {
    const { client, serverOutput } = createHarness(1_000, { largeFrameThresholdBytes: 1 });
    const notifications: unknown[] = [];
    const received = new Promise<void>((resolve) => {
      client.onNotification((notification) => {
        notifications.push(notification);
        if (notifications.length === 2) resolve();
      });
    });
    const encoded = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: { item: { result: encoded, type: "imageGeneration" } },
      })}\n${JSON.stringify({ method: "turn/completed", params: { id: "turn-1" } })}\n`,
    );

    await received;
    const first = notifications[0] as { params: { item: Record<string, unknown> } };
    const staged = readStagedImage(first.params.item);
    expect(staged).toMatchObject({ mediaType: "image/png", size: 8 });
    expect(existsSync(staged?.path ?? "")).toBe(true);
    expect(first.params.item).not.toHaveProperty("result");
    expect(notifications[1]).toMatchObject({ method: "turn/completed" });
    client.close();
  });

  it("prefers a valid savedPath without returning redundant Base64 to the main thread", async () => {
    const directory = mkdtempSync(join(tmpdir(), "code-agent-jsonl-saved-path-"));
    const savedPath = join(directory, "generated.png");
    writeFileSync(savedPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const { client, serverOutput } = createHarness(1_000, { largeFrameThresholdBytes: 1 });
    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.onNotification((notification) => {
        resolve((notification.params as { item: Record<string, unknown> }).item);
      });
    });

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: { item: { result: "redundant", savedPath, type: "imageGeneration" } },
      })}\n`,
    );

    const item = await received;
    expect(item).toMatchObject({ savedPath, type: "imageGeneration" });
    expect(item).not.toHaveProperty("result");
    expect(readStagedImage(item)).toBeUndefined();
    client.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it("closes when a complete JSONL frame exceeds the UTF-8 byte limit", () => {
    const frame = JSON.stringify({ method: "message/delta", params: { text: "你好" } });
    const frameBytes = Buffer.byteLength(frame, "utf8");
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: frameBytes * 2,
      maxFrameBytes: frameBytes - 1,
    });
    const onError = vi.fn();
    client.onError(onError);

    serverOutput.write(`${frame}\n`);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `RPC JSONL frame exceeds ${String(frameBytes - 1)} bytes (${String(frameBytes)} bytes)`,
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("closes when an unfinished JSONL buffer exceeds the UTF-8 byte limit", () => {
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: 5,
      maxFrameBytes: 100,
    });
    const onError = vi.fn();
    client.onError(onError);

    // 两个汉字占 6 个 UTF-8 字节，不能按 JavaScript 字符数误判为未超限。
    serverOutput.write("你好");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "RPC unfinished JSONL buffer exceeds 5 bytes (6 bytes)",
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("closes an unfinished frame as soon as it exceeds the frame limit", () => {
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: 100,
      maxFrameBytes: 5,
    });
    const onError = vi.fn();
    client.onError(onError);

    serverOutput.write("123456");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "RPC JSONL frame exceeds 5 bytes (6 bytes)",
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("does not copy complete frames from a JSONL burst", () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    client.onNotification(onNotification);
    const frameCount = 200;
    const burst = Array.from({ length: frameCount }, (_, index) =>
      JSON.stringify({ method: "message/delta", params: { index } }),
    ).join("\n");
    const concatSpy = vi.spyOn(Buffer, "concat");

    try {
      serverOutput.write(`${burst}\n`);

      expect(onNotification).toHaveBeenCalledTimes(frameCount);
      expect(onNotification.mock.calls.at(-1)?.[0]).toEqual({
        method: "message/delta",
        params: { index: frameCount - 1 },
      });
      expect(concatSpy).not.toHaveBeenCalled();
    } finally {
      concatSpy.mockRestore();
      client.close();
    }
  });

  it("rejects a request after its configured timeout", async () => {
    const { client } = createHarness(20);

    await expect(client.request("slow")).rejects.toBeInstanceOf(RpcTimeoutError);
    client.close();
  });

  it("retries an explicitly unqueued overload with bounded jitter", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 100,
        maxDelayMs: 250,
        maxElapsedMs: 1_000,
        maxRetries: 3,
        random: () => 1,
      },
    });
    const request = client.request("overloaded", { value: 1 });

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );

      await vi.advanceTimersByTimeAsync(119);
      expect(sentMessages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toEqual([
        { id: 1, method: "overloaded", params: { value: 1 } },
        { id: 1, method: "overloaded", params: { value: 1 } },
      ]);

      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(239);
      expect(sentMessages).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toHaveLength(3);

      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(249);
      expect(sentMessages).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toHaveLength(4);

      serverOutput.write(`${JSON.stringify({ id: 1, result: { accepted: true } })}\n`);
      await expect(request).resolves.toEqual({ accepted: true });
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("stops retrying an overload after the configured retry count", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 10,
        maxDelayMs: 100,
        maxElapsedMs: 1_000,
        maxRetries: 2,
        random: () => 0.5,
      },
    });
    const request = client.request("overloaded");
    const overloadFrame = `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`;

    try {
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(10);
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(20);
      serverOutput.write(overloadFrame);

      await expect(request).rejects.toMatchObject({ code: -32001, message: "busy" });
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(3);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("stops retrying before the configured total retry duration", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        maxElapsedMs: 250,
        maxRetries: 10,
        random: () => 0.5,
      },
    });
    const request = client.request("overloaded");
    const overloadFrame = `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`;

    try {
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(100);
      serverOutput.write(overloadFrame);

      await expect(request).rejects.toMatchObject({ code: -32001, message: "busy" });
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(2);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("cancels a scheduled overload retry when the connection closes", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: { baseDelayMs: 100, random: () => 0.5 },
    });
    const request = client.request("overloaded");

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      client.close();

      await expect(request).rejects.toBeInstanceOf(RpcConnectionClosedError);
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original request timeout while waiting to retry", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(50, {
      overloadRetry: { baseDelayMs: 100, random: () => 0.5 },
    });
    const request = client.request("overloaded");
    const outcome = request.catch((error: unknown) => error);

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(outcome).resolves.toBeInstanceOf(RpcTimeoutError);
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(1);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it.each([
    { code: -32002, data: { retry: true }, label: "non-overload code" },
    { code: -32001, data: { retry: false }, label: "overload without unqueued marker" },
  ])("does not retry $label", async ({ code, data }) => {
    const { client, serverOutput } = createHarness();
    const request = client.request("fails");

    serverOutput.write(`${JSON.stringify({ error: { code, data, message: "failed" }, id: 1 })}\n`);

    await expect(request).rejects.toMatchObject({
      code,
      data,
      message: "failed",
    } satisfies Partial<RpcResponseError>);
    client.close();
  });

  it("fails the connection and pending requests on invalid JSONL", async () => {
    const { client, serverOutput } = createHarness();
    const onError = vi.fn();
    client.onError(onError);
    const request = client.request("pending");

    serverOutput.write("not-json\n");

    await expect(request).rejects.toBeInstanceOf(RpcProtocolError);
    expect(onError).toHaveBeenCalledOnce();
    expect(client.closed).toBe(true);
  });

  it("does not expose malformed frame content in protocol errors", () => {
    const { client, serverOutput } = createHarness();
    const onError = vi.fn();
    const sensitiveValue = "PRIVATE_PROMPT_AND_FILE_CONTENT";
    const malformedFrame = `{"method":"message/delta","params":{"text":"${sensitiveValue}"},}`;
    client.onError(onError);

    serverOutput.write(`${malformedFrame}\n`);

    const error = onError.mock.calls[0]?.[0] as Error | undefined;
    expect(error).toBeInstanceOf(RpcProtocolError);
    expect(error?.message).toBe(
      `Invalid JSONL frame (${String(Buffer.byteLength(malformedFrame, "utf8"))} bytes; JSON parse failed)`,
    );
    expect(error?.message).not.toContain(sensitiveValue);
    expect(error).not.toHaveProperty("cause");
    expect(client.closed).toBe(true);
  });

  it("rejects the current request when an RPC error payload is malformed", async () => {
    const { client, serverOutput } = createHarness();
    const request = client.request("malformed-error");

    serverOutput.write(`${JSON.stringify({ error: { message: "missing code" }, id: 1 })}\n`);

    const outcome = await Promise.race([
      request.catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("request remained pending");
        }, 30);
      }),
    ]);
    expect(outcome).toBeInstanceOf(RpcProtocolError);
    expect(client.closed).toBe(true);
  });

  it("delivers notifications and writes notification frames", () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const onNotification = vi.fn();
    const unsubscribe = client.onNotification(onNotification);

    serverOutput.write(
      `${JSON.stringify({ method: "turn/started", params: { turn: { id: "turn_1" } } })}\n`,
    );
    client.notify("initialized", {});

    expect(onNotification).toHaveBeenCalledWith({
      method: "turn/started",
      params: { turn: { id: "turn_1" } },
    });
    expect(sentMessages).toContainEqual({ method: "initialized", params: {} });

    unsubscribe();
    client.close();
  });

  it("delivers server requests and writes responses with the original request id", async () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const onServerRequest = vi.fn();
    const unsubscribe = client.onServerRequest(onServerRequest);

    serverOutput.write(
      `${JSON.stringify({
        id: "approval_1",
        method: "item/commandExecution/requestApproval",
        params: { itemId: "item_1" },
      })}\n`,
    );
    await client.respondToServerRequest("approval_1", { decision: "accept" });
    await client.rejectServerRequest("unsupported_1", {
      code: -32601,
      data: { method: "future/request" },
      message: "Method not found",
    });

    expect(onServerRequest).toHaveBeenCalledWith({
      id: "approval_1",
      method: "item/commandExecution/requestApproval",
      params: { itemId: "item_1" },
    });
    expect(sentMessages).toContainEqual({
      id: "approval_1",
      result: { decision: "accept" },
    });
    expect(sentMessages).toContainEqual({
      error: {
        code: -32601,
        data: { method: "future/request" },
        message: "Method not found",
      },
      id: "unsupported_1",
    });
    expect(client.closed).toBe(false);

    unsubscribe();
    client.close();
  });

  it("rejects a server response when the asynchronous stream write fails", async () => {
    const serverOutput = new PassThrough();
    const failingOutput = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => {
          callback(new Error("pipe closed"));
        });
      },
    });
    const client = new JsonlRpcClient({ input: serverOutput, output: failingOutput });

    await expect(
      client.respondToServerRequest("approval_1", { decision: "accept" }),
    ).rejects.toThrow("RPC write failed: pipe closed");
    expect(client.closed).toBe(true);
  });

  it("rejects all pending requests and closes idempotently", async () => {
    const { client } = createHarness();
    const first = client.request("first");
    const second = client.request("second");

    client.close();
    client.close();

    await expect(first).rejects.toBeInstanceOf(RpcConnectionClosedError);
    await expect(second).rejects.toBeInstanceOf(RpcConnectionClosedError);
    expect(() => {
      client.notify("after-close");
    }).toThrow(RpcConnectionClosedError);
  });
});
