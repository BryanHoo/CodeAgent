export type CodeAgentErrorShape = Readonly<{
  code: string;
  correlationId?: string;
  details?: unknown;
  message: string;
  retryable?: boolean;
  status?: number;
}>;

export class CodeAgentError extends Error {
  public readonly code: string;
  public readonly correlationId: string | undefined;
  public readonly details: unknown;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(error: CodeAgentErrorShape, options?: ErrorOptions) {
    super(error.message, options);
    this.name = "CodeAgentError";
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.details = error.details;
    this.retryable = error.retryable ?? false;
    this.status = error.status;
  }
}

export class CodeAgentResponseError extends CodeAgentError {
  public constructor(message: string, options?: ErrorOptions) {
    super({ code: "invalid_response", message }, options);
    this.name = "CodeAgentResponseError";
  }
}

export function normalizeCodeAgentError(error: unknown): CodeAgentError {
  if (error instanceof CodeAgentError) return error;
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<CodeAgentErrorShape>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return new CodeAgentError({
        code: candidate.code,
        ...(typeof candidate.correlationId === "string"
          ? { correlationId: candidate.correlationId }
          : {}),
        ...(candidate.details === undefined ? {} : { details: candidate.details }),
        message: candidate.message,
        ...(candidate.retryable === undefined ? {} : { retryable: candidate.retryable }),
        ...(Number.isInteger(candidate.status) ? { status: candidate.status } : {}),
      });
    }
  }
  return new CodeAgentError(
    { code: "transport_failure", message: error instanceof Error ? error.message : String(error) },
    { cause: error },
  );
}
