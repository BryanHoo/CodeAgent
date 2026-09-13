import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { StartAgentQueuedSubmissionRequestSchema } from "./agent-actions.js";

test("queue start requires a key and scope while preserving next-item selection", () => {
  const request = { projectId:"project", taskId:"task", idempotencyKey:"key" };
  expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, request)).toBe(true);
  for (const queuedSubmissionId of [null, "queue-a"]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, queuedSubmissionId })).toBe(true);
  }
  for (const queuedSubmissionId of ["", "x".repeat(1025)]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, queuedSubmissionId })).toBe(false);
  }
  for (const idempotencyKey of [undefined, " ", "x".repeat(129)]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, idempotencyKey })).toBe(false);
  }
});
