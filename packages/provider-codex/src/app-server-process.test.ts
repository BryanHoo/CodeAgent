import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodexAppServerExitedError,
  CodexAppServerProcess,
  startCodexAppServer,
} from "./app-server-process.js";
import { RpcConnectionClosedError, RpcProtocolError, RpcTimeoutError } from "./jsonl-rpc-client.js";

const fakeAppServerPath = fileURLToPath(
  new URL("../test/fixtures/fake-app-server.mjs", import.meta.url),
);
const runtimes: CodexAppServerProcess[] = [];

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error;
  }
}

async function startFake(scenario = "normal"): Promise<CodexAppServerProcess> {
  const runtime = await startCodexAppServer({
    appVersion: "1.2.3",
    binaryPath: fakeAppServerPath,
    env: { ...process.env, FAKE_APP_SERVER_SCENARIO: scenario },
    rpcTimeoutMs: 100,
    shutdownTimeoutMs: 100,
  });
  runtimes.push(runtime);
  return runtime;
}

function createUnresponsiveChild(): {
  child: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
} {
  const kill = vi.fn(() => false);
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    kill,
    pid: 4321,
    signalCode: null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams;
  return { child, kill };
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.close()));
});

describe("CodexAppServerProcess", () => {
  it("starts with fixed arguments, completes the handshake, and responds", async () => {
    const runtime = await startFake();

    await expect(runtime.client.request("echo", { ok: true })).resolves.toEqual({ ok: true });
    await expect(runtime.client.request("inspect")).resolves.toEqual({
      args: ["app-server", "--listen", "stdio://"],
      initializeParams: {
        clientInfo: { name: "code_agent", title: "CodeAgent", version: "1.2.3" },
      },
      initialized: true,
    });
    expect(runtime.version.version).toBe("0.145.0");
    expect(runtime.closed).toBe(false);
  });

  it("surfaces RPC timeouts from the long-lived process", async () => {
    const runtime = await startFake();

    await expect(runtime.client.request("slow", {}, 20)).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  it("rejects startup when the server emits invalid JSONL during initialize", async () => {
    await expect(startFake("invalid-jsonl")).rejects.toBeInstanceOf(RpcProtocolError);
  });

  it("rejects startup when the process exits during initialize", async () => {
    const error = await captureRejection(startFake("exit-during-initialize"));

    expect(error).toBeInstanceOf(CodexAppServerExitedError);
    if (!(error instanceof CodexAppServerExitedError)) {
      throw error;
    }
    expect(error.exitCode).toBe(17);
    expect(error.stderr).toContain("fake initialization failure");
  });

  it("rejects pending RPC when the process exits unexpectedly", async () => {
    const runtime = await startFake();
    const pending = runtime.client.request("crash");
    const error = await captureRejection(pending);

    expect(error).toBeInstanceOf(CodexAppServerExitedError);
    if (!(error instanceof CodexAppServerExitedError)) {
      throw error;
    }
    expect(error.exitCode).toBe(23);
    expect(error.stderr).toContain("fake app server crashed");
    await expect(runtime.waitForExit()).resolves.toMatchObject({ code: 23, signal: null });
    expect(runtime.closed).toBe(true);
  });

  it("rejects pending RPC and closes idempotently", async () => {
    const runtime = await startFake();
    const pending = runtime.client.request("slow");
    const pendingRejection = expect(pending).rejects.toBeInstanceOf(RpcConnectionClosedError);

    await Promise.all([runtime.close(), runtime.close()]);

    await pendingRejection;
    await expect(runtime.waitForExit()).resolves.toMatchObject({ code: 0, signal: null });
    expect(runtime.closed).toBe(true);
  });

  it("rejects shutdown when the process does not exit after SIGKILL", async () => {
    const { child, kill } = createUnresponsiveChild();
    const runtime = new CodexAppServerProcess(
      child,
      { path: "/fake/codex", source: "explicit" },
      { raw: "codex-cli 0.145.0", version: "0.145.0" },
      { rpcTimeoutMs: 100, shutdownTimeoutMs: 5 },
    );

    const outcome = await Promise.race([
      runtime.close().catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("shutdown remained pending");
        }, 50);
      }),
    ]);

    expect(outcome).toMatchObject({
      message: "Codex App Server did not exit within 5ms after SIGKILL",
      name: "CodexAppServerShutdownError",
    });
    expect(kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
