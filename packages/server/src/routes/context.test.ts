import { NodeEngineError } from "@code-agent/engine-node";
import { describe, expect, it, vi } from "vitest";

import { callCancelableRead, callEngine, MutationHttpError } from "./context.js";

describe("callEngine", () => {
  it.each([
    ["PROJECT_NOT_FOUND", 404, false],
    ["TASK_NOT_FOUND", 404, false],
    ["GIT_STATUS_CHANGED", 409, true],
    ["GIT_BRANCH_NOT_FOUND", 409, true],
    ["ATTACHMENT_NOT_FOUND", 404, false],
    ["PENDING_REQUEST_EXPIRED", 409, false],
  ] as const)("maps structured %s errors", async (mutationCode, statusCode, retryable) => {
    const error = new NodeEngineError({
      code: mutationCode.endsWith("NOT_FOUND") ? "not_found" : "conflict",
      message: mutationCode,
      mutationCode,
    });

    await expect(callEngine(() => Promise.reject(error))).rejects.toEqual(
      new MutationHttpError(mutationCode, mutationCode, statusCode, retryable),
    );
  });

  it("does not parse legacy error messages", async () => {
    const error = new Error("GenericFailure: not_found: task missing");

    await expect(callEngine(() => Promise.reject(error))).rejects.toBe(error);
  });
});

describe("callCancelableRead", () => {
  it("cancels the native operation with the same request id", async () => {
    const controller = new AbortController();
    const cancelOperation = vi.fn(() => Promise.resolve(true));
    let resolveOperation: ((value: unknown) => void) | undefined;
    const operation = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    const result = callCancelableRead(
      { cancelOperation },
      controller.signal,
      () => "request-1",
      (requestId) => {
        expect(requestId).toBe("request-1");
        return operation;
      },
    );
    controller.abort();
    resolveOperation?.({ data: [] });

    await expect(result).resolves.toEqual({ data: [] });
    expect(cancelOperation).toHaveBeenCalledOnce();
    expect(cancelOperation).toHaveBeenCalledWith("request-1");
  });

  it("starts the native operation before forwarding a pre-aborted signal", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const cancelOperation = vi.fn(() => {
      calls.push("cancel");
      return Promise.resolve(true);
    });
    controller.abort();

    await expect(
      callCancelableRead(
        { cancelOperation },
        controller.signal,
        () => "request-2",
        () => {
          calls.push("start");
          return Promise.resolve({ entries: [], path: null });
        },
      ),
    ).resolves.toEqual({ entries: [], path: null });

    expect(calls).toEqual(["start", "cancel"]);
    expect(cancelOperation).toHaveBeenCalledOnce();
  });
});
