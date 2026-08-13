import { NodeEngineError, type CodeAgentEngine } from "@code-agent/engine-node";
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

export async function callEngine<T>(action: () => Promise<unknown>): Promise<T> {
  try {
    return (await action()) as T;
  } catch (error) {
    if (error instanceof MutationHttpError) throw error;
    if (!(error instanceof NodeEngineError)) throw error;
    throw toMutationHttpError(error);
  }
}

export async function callCancelableRead<T>(
  engine: Pick<CodeAgentEngine, "cancelOperation">,
  signal: AbortSignal,
  createRequestId: () => string,
  action: (requestId: string) => Promise<unknown>,
): Promise<T> {
  const requestId = createRequestId();
  let cancellationRequested = false;
  let operationStarted = false;
  let nativeCancelSent = false;
  const cancelNative = (): void => {
    if (!operationStarted || nativeCancelSent) return;
    nativeCancelSent = true;
    void engine.cancelOperation(requestId).catch(() => undefined);
  };
  const cancel = (): void => {
    cancellationRequested = true;
    cancelNative();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await callEngine(() => {
      const operation = action(requestId);
      operationStarted = true;
      if (cancellationRequested || signal.aborted) cancelNative();
      return operation;
    });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function toMutationHttpError(error: NodeEngineError): MutationHttpError {
  const code = error.mutationCode ?? fallbackMutationCode(error.code);
  const policy = mutationPolicies[code];
  return new MutationHttpError(code, error.message, policy.statusCode, policy.retryable);
}

const mutationPolicies: Readonly<
  Record<AgentMutationError["code"], Readonly<{ retryable: boolean; statusCode: number }>>
> = {
  ACCESS_DENIED: { retryable: false, statusCode: 403 },
  ATTACHMENT_NOT_FOUND: { retryable: false, statusCode: 404 },
  COMMIT_MESSAGE_GENERATION_FAILED: { retryable: true, statusCode: 502 },
  GIT_BRANCH_ALREADY_ACTIVE: { retryable: true, statusCode: 409 },
  GIT_BRANCH_ALREADY_EXISTS: { retryable: true, statusCode: 409 },
  GIT_BRANCH_CREATE_FAILED: { retryable: true, statusCode: 502 },
  GIT_BRANCH_INVALID: { retryable: false, statusCode: 400 },
  GIT_BRANCH_NOT_FOUND: { retryable: true, statusCode: 409 },
  GIT_BRANCH_SWITCH_FAILED: { retryable: true, statusCode: 502 },
  GIT_COMMIT_FAILED: { retryable: true, statusCode: 502 },
  GIT_MUTATION_IN_PROGRESS: { retryable: true, statusCode: 409 },
  GIT_PATH_UNAVAILABLE: { retryable: true, statusCode: 409 },
  GIT_REPOSITORY_READ_ONLY: { retryable: true, statusCode: 409 },
  GIT_REPOSITORY_UNAVAILABLE: { retryable: true, statusCode: 409 },
  GIT_STATUS_CHANGED: { retryable: true, statusCode: 409 },
  IDEMPOTENCY_CAPACITY_EXCEEDED: { retryable: true, statusCode: 503 },
  IDEMPOTENCY_CONFLICT: { retryable: false, statusCode: 409 },
  IDEMPOTENCY_KEY_REQUIRED: { retryable: false, statusCode: 400 },
  INVALID_REQUEST: { retryable: false, statusCode: 400 },
  PAIRING_FAILED: { retryable: false, statusCode: 403 },
  PAIRING_RATE_LIMITED: { retryable: true, statusCode: 429 },
  PENDING_REQUEST_ALREADY_RESOLVED: { retryable: false, statusCode: 409 },
  PENDING_REQUEST_EXPIRED: { retryable: false, statusCode: 409 },
  PENDING_REQUEST_MISMATCH: { retryable: false, statusCode: 409 },
  PENDING_REQUEST_NOT_FOUND: { retryable: false, statusCode: 404 },
  PROJECT_NOT_FOUND: { retryable: false, statusCode: 404 },
  PROVIDER_ERROR: { retryable: true, statusCode: 502 },
  TASK_NOT_FOUND: { retryable: false, statusCode: 404 },
  TURN_NOT_FOUND: { retryable: false, statusCode: 404 },
  TURN_NOT_RUNNING: { retryable: false, statusCode: 409 },
  UPDATE_CHECK_FAILED: { retryable: true, statusCode: 502 },
  UPDATE_INSTALL_FAILED: { retryable: true, statusCode: 502 },
  UPDATE_NOT_AVAILABLE: { retryable: false, statusCode: 409 },
};

function fallbackMutationCode(code: NodeEngineError["code"]): AgentMutationError["code"] {
  switch (code) {
    case "invalid_input":
      return "INVALID_REQUEST";
    case "conflict":
      return "IDEMPOTENCY_CONFLICT";
    case "capacity_exceeded":
      return "IDEMPOTENCY_CAPACITY_EXCEEDED";
    default:
      return "PROVIDER_ERROR";
  }
}
