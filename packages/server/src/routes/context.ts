import type { CodeAgentEngine } from "@code-agent/engine-node";
import type {
  AgentMutationError,
  AppInfoResponse,
  InstallAppUpdateResponse,
} from "@code-agent/protocol";

import type { AccessSessionService } from "../access-control.js";

export class MutationHttpError extends Error {
  public constructor(
    public readonly code: AgentMutationError["code"],
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "MutationHttpError";
  }
}

export interface EventDeliveryMetrics {
  readonly projects: Map<
    string,
    {
      activeClients: number;
      backpressureSignals: number;
      slowClientDisconnects: number;
    }
  >;
}

export interface ServerRouteContext {
  readonly accessService?: AccessSessionService;
  readonly engine: CodeAgentEngine;
  readonly eventMetrics: EventDeliveryMetrics;
  readonly installAppUpdate: (version: string) => Promise<InstallAppUpdateResponse>;
  readonly readAppInfo: () => Promise<AppInfoResponse>;
}

export function readRequestId(headers: { readonly "idempotency-key": string }): string {
  return headers["idempotency-key"];
}

export function createReadRequestId(): string {
  return crypto.randomUUID();
}

export async function callEngine<T>(
  action: () => Promise<unknown>,
  notFoundCode: AgentMutationError["code"] = "PROJECT_NOT_FOUND",
): Promise<T> {
  try {
    return (await action()) as T;
  } catch (error) {
    if (error instanceof MutationHttpError) throw error;
    const rawMessage = error instanceof Error ? error.message : String(error);
    const match =
      /(?:^|:\s)(cancelled|capacity_exceeded|conflict|internal|invalid_input|not_found|provider_failure|shutting_down|timeout):\s(.+)$/u.exec(
        rawMessage,
      );
    if (match === null) throw error;
    const [, code, message] = match;
    switch (code) {
      case "invalid_input":
        throw new MutationHttpError("INVALID_REQUEST", message ?? "Request is invalid", 400);
      case "not_found":
        throw new MutationHttpError(notFoundCode, message ?? "Resource was not found", 404);
      case "conflict":
        throw new MutationHttpError("IDEMPOTENCY_CONFLICT", message ?? "Request conflicts", 409);
      case "provider_failure":
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          message ?? "Provider request failed",
          502,
          true,
        );
      case "capacity_exceeded":
        throw new MutationHttpError(
          "IDEMPOTENCY_CAPACITY_EXCEEDED",
          message ?? "Runtime capacity is exhausted",
          503,
          true,
        );
      default:
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          message ?? "Runtime is unavailable",
          503,
          true,
        );
    }
  }
}
