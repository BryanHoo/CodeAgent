import { describe, expect, it, vi } from "vitest";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProviderConnectionService } from "./provider-connection.js";

class FakeRpcClient implements CodexRpcClient {
  public readonly requests: { method: string; params: unknown }[] = [];
  readonly #notificationListeners = new Set<
    (notification: { method: string; params: unknown }) => void
  >();
  readonly #responses = new Map<string, unknown[]>();

  public enqueue(method: string, response: unknown): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  public emit(method: string, params: unknown): void {
    for (const listener of this.#notificationListeners) listener({ method, params });
  }

  public notify(): void {
    return;
  }

  public onNotification(
    listener: (notification: { method: string; params: unknown }) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  public onServerRequest(): () => void {
    return () => undefined;
  }

  public rejectServerRequest(): Promise<void> {
    return Promise.resolve();
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const response = this.#responses.get(method)?.shift();
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  }

  public respondToServerRequest(): void {
    return;
  }
}

function enqueueOfficialStatus(client: FakeRpcClient, account: unknown = null): void {
  client.enqueue("config/read", { config: { model_provider: "openai" } });
  client.enqueue("account/read", { account, requiresOpenaiAuth: true });
}

describe("CodexProviderConnectionService", () => {
  it("detects a custom provider selected in the Codex CLI config", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "OpenAI",
        model_providers: {
          OpenAI: {
            base_url: "http://api.example.test:8080/v1",
            requires_openai_auth: true,
            wire_api: "responses",
          },
        },
      },
    });
    client.enqueue("account/read", {
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({
      customBaseUrl: "http://api.example.test:8080/v1",
      mode: "custom",
      state: "connected",
    });
  });

  it("detects openai_base_url as a custom API configuration", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", {
      config: {
        model_provider: "openai",
        openai_base_url: "https://gateway.example.test/v1",
      },
    });
    client.enqueue("account/read", {
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    const service = new CodexProviderConnectionService(client);

    await expect(service.readStatus()).resolves.toMatchObject({
      customBaseUrl: "https://gateway.example.test/v1",
      mode: "custom",
      state: "connected",
    });
  });

  it("starts official login and tracks a failed completion notification", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/batchWrite", {});
    client.enqueue("account/login/start", {
      authUrl: "https://auth.openai.com/authorize",
      loginId: "login-1",
      type: "chatgpt",
    });
    enqueueOfficialStatus(client);
    const service = new CodexProviderConnectionService(client);

    await expect(service.startOfficialLogin()).resolves.toMatchObject({
      authUrl: "https://auth.openai.com/authorize",
      loginId: "login-1",
      status: { mode: "official", state: "pending" },
    });
    expect(client.requests[0]).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [{ keyPath: "model_provider", mergeStrategy: "upsert", value: "openai" }],
      },
    });

    service.receiveNotification("account/login/completed", {
      error: "browser login expired",
      loginId: "login-1",
      success: false,
    });
    enqueueOfficialStatus(client);
    await expect(service.readStatus()).resolves.toMatchObject({
      pendingLogin: {
        error: "browser login expired",
        loginId: "login-1",
        state: "failed",
      },
      state: "failed",
    });
  });

  it("discovers custom models and keeps the API key out of Codex config", async () => {
    const client = new FakeRpcClient();
    client.enqueue("account/login/start", { type: "apiKey" });
    client.enqueue("config/batchWrite", {});
    client.enqueue("config/read", {
      config: {
        model_provider: "code_agent_custom",
        model_providers: {
          code_agent_custom: { base_url: "https://api.example.com/v1" },
        },
      },
    });
    client.enqueue("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "zeta" }, { id: "alpha" }, { id: "alpha" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    await expect(
      service.configureCustom({ apiKey: "custom-secret", baseUrl: "https://api.example.com/v1/" }),
    ).resolves.toMatchObject({
      models: {
        data: [
          { id: "alpha", isDefault: true },
          { id: "zeta", isDefault: false },
        ],
      },
      status: { customBaseUrl: "https://api.example.com/v1", state: "connected" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: { authorization: "Bearer custom-secret" },
        redirect: "manual",
      }),
    );
    const configRequest = client.requests.find((request) => request.method === "config/batchWrite");
    expect(JSON.stringify(configRequest)).not.toContain("custom-secret");
    expect(configRequest).toEqual({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "model_providers.code_agent_custom",
            mergeStrategy: "upsert",
            value: {
              base_url: "https://api.example.com/v1",
              name: "CodeAgent Custom API",
              requires_openai_auth: true,
              wire_api: "responses",
            },
          },
          {
            keyPath: "model_provider",
            mergeStrategy: "upsert",
            value: "code_agent_custom",
          },
        ],
      },
    });
  });

  it("rejects redirects without exposing the API key", async () => {
    const client = new FakeRpcClient();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { headers: { location: "https://other.test" }, status: 302 }),
      );
    const service = new CodexProviderConnectionService(client, { fetch: fetchMock });

    const error = await service
      .configureCustom({ apiKey: "never-expose-this", baseUrl: "https://api.example.com/v1" })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("redirect");
    expect((error as Error).message).not.toContain("never-expose-this");
    expect(client.requests).toEqual([]);
  });
});
