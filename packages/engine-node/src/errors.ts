import {
  CodeAgentErrorSchema,
  type AgentMutationError,
  type CodeAgentError,
} from "@code-agent/protocol";
import { Value } from "@sinclair/typebox/value";

export class NodeEngineError extends Error {
  public readonly code: CodeAgentError["code"];
  public readonly correlationId: string | undefined;
  public readonly mutationCode: AgentMutationError["code"] | undefined;

  public constructor(error: CodeAgentError) {
    super(error.message);
    this.name = "NodeEngineError";
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.mutationCode = error.mutationCode;
  }
}

/** 仅解码 native addon 发送的严格 JSON，不从用户可读文本猜测错误语义。 */
export function normalizeNodeEngineError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  let value: unknown;
  try {
    value = JSON.parse(error.message) as unknown;
  } catch {
    return error;
  }
  return Value.Check(CodeAgentErrorSchema, value) ? new NodeEngineError(value) : error;
}
