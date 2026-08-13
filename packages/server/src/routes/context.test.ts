import { NodeEngineError } from "@code-agent/engine-node";
import { describe, expect, it } from "vitest";

import { callEngine, MutationHttpError } from "./context.js";

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
