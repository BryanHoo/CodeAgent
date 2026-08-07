import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentProviderConnectionRecordSchema,
  AgentProviderConnectionStatusSchema,
  ConfigureCustomProviderRequestSchema,
  ConfigureCustomProviderResponseSchema,
  StartOfficialProviderLoginResponseSchema,
} from "./provider-connection.js";

const modelPage = {
  data: [
    {
      defaultReasoningEffort: "medium",
      description: "",
      displayName: "custom-model",
      id: "custom-model",
      isDefault: true,
      supportedReasoningEfforts: [{ description: "", id: "medium" }],
    },
  ],
  nextCursor: null,
} as const;

describe("Provider connection protocol", () => {
  it("accepts strict official and custom connection states", () => {
    expect(
      Value.Check(AgentProviderConnectionStatusSchema, {
        account: null,
        customBaseUrl: null,
        mode: "official",
        pendingLogin: null,
        state: "disconnected",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentProviderConnectionStatusSchema, {
        account: { email: "developer@example.com", planType: "plus", type: "chatgpt" },
        customBaseUrl: null,
        mode: "official",
        pendingLogin: null,
        state: "connected",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentProviderConnectionStatusSchema, {
        account: null,
        customBaseUrl: "http://127.0.0.1:11434/v1",
        mode: "custom",
        pendingLogin: null,
        state: "connected",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentProviderConnectionStatusSchema, {
        account: null,
        apiKey: "secret",
        customBaseUrl: null,
        mode: "official",
        pendingLogin: null,
        state: "disconnected",
      }),
    ).toBe(false);
  });

  it("keeps login and custom provider payloads bounded and secret-free", () => {
    expect(
      Value.Check(StartOfficialProviderLoginResponseSchema, {
        authUrl: "https://auth.openai.com/authorize",
        loginId: "login-1",
        status: {
          account: null,
          customBaseUrl: null,
          mode: "official",
          pendingLogin: { error: null, loginId: "login-1", state: "pending" },
          state: "pending",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(ConfigureCustomProviderRequestSchema, {
        apiKey: "custom-key",
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe(true);
    expect(
      Value.Check(ConfigureCustomProviderRequestSchema, {
        apiKey: "x".repeat(16_385),
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe(false);
    expect(
      Value.Check(ConfigureCustomProviderResponseSchema, {
        models: modelPage,
        status: {
          account: { type: "apiKey" },
          customBaseUrl: "https://api.example.com/v1",
          mode: "custom",
          pendingLogin: null,
          state: "connected",
        },
      }),
    ).toBe(true);
  });

  it("stores only non-sensitive custom provider metadata", () => {
    const record = {
      customBaseUrl: "https://api.example.com/v1",
      customModels: modelPage,
      mode: "custom",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };
    expect(Value.Check(AgentProviderConnectionRecordSchema, record)).toBe(true);
    expect(Value.Check(AgentProviderConnectionRecordSchema, { ...record, apiKey: "secret" })).toBe(
      false,
    );
  });
});
