import { HealthResponseSchema } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import { TransportCodeAgentClient } from "./client.js";
import type {
  CodeAgentOperation,
  CodeAgentRequestContext,
  CodeAgentTransport,
} from "./contracts.js";
import { CodeAgentResponseError } from "./errors.js";

function createTransport(
  request: CodeAgentTransport["request"],
  cancel = vi.fn<CodeAgentTransport["cancel"]>().mockResolvedValue(undefined),
): CodeAgentTransport {
  return {
    cancel,
    request,
    resolveAssetUrl: (reference) => reference.path,
    subscribeEvents: () => () => undefined,
  };
}

describe("CodeAgentClient", () => {
  it("preserves a transport correlation ID on normalized errors", async () => {
    const client = new TransportCodeAgentClient(
      createTransport(() =>
        Promise.reject(
          Object.assign(new Error("请求参数无效"), {
            code: "invalid_input",
            correlationId: "trace-123",
          }),
        ),
      ),
    );

    await expect(
      client.request({ name: "app.health", output: HealthResponseSchema }),
    ).rejects.toMatchObject({ correlationId: "trace-123" });
  });

  it("generates a request id and validates a transport response", async () => {
    const calls: { context: CodeAgentRequestContext; operation: CodeAgentOperation }[] = [];
    const transport = createTransport((operation, context) => {
      calls.push({ context, operation });
      return Promise.resolve({ status: "ok", version: 1 });
    });
    const client = new TransportCodeAgentClient(transport);

    await expect(
      client.request({ name: "app.health", output: HealthResponseSchema }),
    ).resolves.toEqual({ status: "ok", version: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.operation.name).toBe("app.health");
    expect(calls[0]?.context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("rejects responses outside the operation schema", async () => {
    const client = new TransportCodeAgentClient(
      createTransport(() => Promise.resolve({ status: "broken", version: 1 })),
    );

    await expect(
      client.request({ name: "app.health", output: HealthResponseSchema }),
    ).rejects.toBeInstanceOf(CodeAgentResponseError);
  });

  it("preserves an HTTP status exposed by the host transport", async () => {
    const transportError = Object.assign(new Error("Provider request failed"), {
      code: "PROVIDER_ERROR",
      retryable: true,
      status: 502,
    });
    const client = new TransportCodeAgentClient(
      createTransport(() => Promise.reject(transportError)),
    );

    await expect(
      client.request({ name: "app.health", output: HealthResponseSchema }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it("cancels the host operation when the caller aborts", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const cancel = vi.fn<CodeAgentTransport["cancel"]>().mockResolvedValue(undefined);
    const client = new TransportCodeAgentClient(
      createTransport(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
        cancel,
      ),
    );
    const controller = new AbortController();
    const request = client.request(
      { name: "app.health", output: HealthResponseSchema },
      { signal: controller.signal },
    );

    controller.abort();
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledOnce();
    });
    resolveRequest?.({ status: "ok", version: 1 });
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
