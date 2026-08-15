import { describe, expect, it } from "vitest";

import { openNodeEngine } from "./engine.js";
import { NodeEngineError, normalizeNodeEngineError } from "./errors.js";

describe("normalizeNodeEngineError", () => {
  it("restores the structured native error contract", () => {
    const native = new Error(
      JSON.stringify({
        code: "conflict",
        correlationId: "request-1",
        message: "Git status changed",
        mutationCode: "GIT_STATUS_CHANGED",
      }),
    );

    expect(normalizeNodeEngineError(native)).toEqual(
      new NodeEngineError({
        code: "conflict",
        correlationId: "request-1",
        message: "Git status changed",
        mutationCode: "GIT_STATUS_CHANGED",
      }),
    );
  });

  it("does not infer error semantics from human-readable text", () => {
    const native = new Error("GenericFailure: not_found: task missing");

    expect(normalizeNodeEngineError(native)).toBe(native);
  });

  it("normalizes every rejected native engine operation", async () => {
    const nativeError = new Error(
      JSON.stringify({
        code: "not_found",
        message: "Task not found",
        mutationCode: "TASK_NOT_FOUND",
      }),
    );
    const engine = await openNodeEngine({} as never, {
      binding: {
        addonVersion: () => "test",
        NodeEngine: {
          open: () =>
            Promise.resolve({
              taskRead: () => Promise.reject(nativeError),
            }),
        },
      },
    });

    await expect(engine.taskRead("request-1", "project-1", "task-1")).rejects.toMatchObject({
      code: "not_found",
      message: "Task not found",
      mutationCode: "TASK_NOT_FOUND",
      name: "NodeEngineError",
    });
  });

  it("normalizes native engine initialization failures", async () => {
    const nativeError = new Error(
      JSON.stringify({
        code: "invalid_input",
        message: "Database path is invalid",
        mutationCode: "INVALID_REQUEST",
      }),
    );

    await expect(
      openNodeEngine({} as never, {
        binding: {
          addonVersion: () => "test",
          NodeEngine: { open: () => Promise.reject(nativeError) },
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Database path is invalid",
      mutationCode: "INVALID_REQUEST",
      name: "NodeEngineError",
    });
  });
});
