import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  RUST_RUNTIME_SCHEMA_ID,
  RustRuntimeProtocolSchema,
  createRustRuntimeSchemaDocument,
} from "./rust-runtime-schema.js";

describe("Rust Runtime 协议 Schema", () => {
  it("导出稳定且严格的公开根契约", () => {
    const document = createRustRuntimeSchemaDocument();

    expect(document.$id).toBe(RUST_RUNTIME_SCHEMA_ID);
    expect(Object.keys(document.$defs)).toEqual([
      "AgentCapabilities",
      "AgentProviderEvent",
      "AgentTaskSettings",
      "CodeAgentError",
      "ProjectId",
      "TaskId",
    ]);
    expect(document.$defs["AgentProviderEvent"]).toHaveProperty("oneOf");
    expect(document.$defs["AgentProviderEvent"]).not.toHaveProperty("anyOf");
  });

  it("拒绝非法设置和 Provider 传输字段", () => {
    expect(
      Value.Check(RustRuntimeProtocolSchema, {
        agentTaskSettings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        capabilities: {
          feedback: { upload: false },
          provider: "fake",
          skills: { list: true, use: true },
          tasks: { fork: true, list: true, read: true, start: true },
          turns: {
            compact: true,
            interrupt: true,
            review: true,
            start: true,
            steer: true,
          },
        },
        error: { code: "provider_failure", message: "Provider failed" },
        projectId: "project-1",
        providerEvent: {
          payload: { delta: "hello" },
          taskId: "task-1",
          turnId: "turn-1",
          itemId: "item-1",
          type: "message.delta",
        },
        taskId: "task-1",
      }),
    ).toBe(true);

    expect(
      Value.Check(RustRuntimeProtocolSchema, {
        agentTaskSettings: {
          approvalPolicy: "never",
          approvalsReviewer: "auto_review",
          model: "gpt-5",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        capabilities: {},
        error: { code: "provider_failure", message: "Provider failed" },
        projectId: "project-1",
        providerEvent: {
          payload: { delta: "hello" },
          sequence: 1,
          sessionId: "forbidden",
          taskId: "task-1",
          turnId: "turn-1",
          itemId: "item-1",
          type: "message.delta",
        },
        taskId: "task-1",
      }),
    ).toBe(false);
  });

  it("与受版本控制的 JSON Schema 保持同步", async () => {
    const outputPath = resolve("schemas/code-agent-runtime.schema.json");
    const expected = `${JSON.stringify(createRustRuntimeSchemaDocument(), null, 2)}\n`;

    if (process.env["CODE_AGENT_UPDATE_RUST_PROTOCOL"] === "1") {
      await writeFile(outputPath, expected, "utf8");
    }

    await expect(readFile(outputPath, "utf8")).resolves.toBe(expected);
  });
});
