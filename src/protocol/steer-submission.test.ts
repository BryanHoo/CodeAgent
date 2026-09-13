import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { SteerAgentTurnRequestSchema } from "./agent-actions.js";

const request = { projectId: "project", taskId: "task", turnId: "turn", idempotencyKey: "key", input: { type: "prompt", text: "hello", attachments: [], skills: [] } };

test("steer requires an explicit bounded key and full target identity", () => {
  expect(Value.Check(SteerAgentTurnRequestSchema, request)).toBe(true);
  for (const field of ["projectId", "taskId", "turnId", "idempotencyKey"] as const) {
    const { [field]: _omitted, ...missing } = request;
    expect(Value.Check(SteerAgentTurnRequestSchema, missing)).toBe(false);
    expect(Value.Check(SteerAgentTurnRequestSchema, { ...request, [field]: "" })).toBe(false);
  }
  for (const idempotencyKey of [" ", "x".repeat(129)]) {
    expect(Value.Check(SteerAgentTurnRequestSchema, { ...request, idempotencyKey })).toBe(false);
  }
});
