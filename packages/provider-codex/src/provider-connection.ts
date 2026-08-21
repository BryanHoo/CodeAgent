import { Buffer } from "node:buffer";

import type {
  AgentProviderAccount,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  StartOfficialProviderLoginResponse,
} from "@code-agent/protocol";

import type { CodexRpcClient } from "./agent-provider-base.js";
import {
  CodexProviderConnectionError,
  mapCustomModels,
  normalizeManualModels,
  readDiscoveredModels,
  type CustomModelDefinition,
} from "./custom-model-catalog.js";

export { CodexProviderConnectionError } from "./custom-model-catalog.js";

const CUSTOM_PROVIDER_ID = "code_agent_custom";
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL_RESPONSE_MAX_BYTES = 1 * 1_024 * 1_024;
const DEFAULT_MODEL_COUNT_LIMIT = 1_000;

type PendingLogin = Readonly<{
  error: string | null;
  loginId: string;
  state: "failed" | "pending";
}>;

export interface CodexProviderConnectionServiceOptions {
  fetch?: typeof globalThis.fetch;
  modelCountLimit?: number;
  modelRequestTimeoutMs?: number;
  modelResponseMaxBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodexProviderConnectionError(`Codex returned an invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CodexProviderConnectionError("Custom API base URL is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CodexProviderConnectionError(
      "Custom API base URL must use HTTP or HTTPS without credentials, query, or fragment",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    throw new CodexProviderConnectionError("Custom model response exceeded the size limit");
  }
  if (response.body === null) return Buffer.alloc(0);

  const stream = response.body as unknown as AsyncIterable<unknown>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const value of stream) {
    if (!(value instanceof Uint8Array)) {
      throw new CodexProviderConnectionError("Custom model response returned invalid bytes");
    }
    total += value.byteLength;
    if (total > maximumBytes) {
      throw new CodexProviderConnectionError("Custom model response exceeded the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function mapAccount(value: unknown): AgentProviderAccount | null {
  if (!isRecord(value)) return null;
  if (value["type"] === "apiKey") return { type: "apiKey" };
  if (value["type"] === "chatgpt") {
    return {
      email: optionalString(value["email"], 320),
      planType: optionalString(value["planType"], 64),
      type: "chatgpt",
    };
  }
  return null;
}

function readConfig(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response["config"])) {
    throw new CodexProviderConnectionError("Codex returned an invalid config response");
  }
  return response["config"];
}

function readActiveProvider(config: Record<string, unknown>): {
  customBaseUrl: string | null;
  mode: "custom" | "official";
} {
  const providerId =
    typeof config["model_provider"] === "string" ? config["model_provider"] : "openai";
  const openaiBaseUrl = optionalString(config["openai_base_url"], 2_048);
  if (providerId === "openai") {
    return openaiBaseUrl === null || openaiBaseUrl.length === 0
      ? { customBaseUrl: null, mode: "official" }
      : { customBaseUrl: openaiBaseUrl, mode: "custom" };
  }

  const providers = isRecord(config["model_providers"]) ? config["model_providers"] : null;
  const provider = providers && isRecord(providers[providerId]) ? providers[providerId] : null;
  const baseUrl = optionalString(provider?.["base_url"], 2_048);
  // 非内置 openai Provider 由 Codex CLI 配置驱动，即使它不是 CodeAgent 创建的固定 Provider。
  return {
    customBaseUrl: baseUrl === null || baseUrl.length === 0 ? null : baseUrl,
    mode: "custom",
  };
}

function readAccountResponse(response: unknown): {
  account: AgentProviderAccount | null;
  requiresOpenaiAuth: boolean;
} {
  if (!isRecord(response) || typeof response["requiresOpenaiAuth"] !== "boolean") {
    throw new CodexProviderConnectionError("Codex returned an invalid account response");
  }
  return {
    account: mapAccount(response["account"]),
    requiresOpenaiAuth: response["requiresOpenaiAuth"],
  };
}

function readProviderCapabilities(response: unknown): void {
  if (
    !isRecord(response) ||
    typeof response["namespaceTools"] !== "boolean" ||
    typeof response["imageGeneration"] !== "boolean" ||
    typeof response["webSearch"] !== "boolean"
  ) {
    throw new CodexProviderConnectionError("Codex returned invalid model provider capabilities");
  }
}

export class CodexProviderConnectionService {
  readonly #client: CodexRpcClient;
  readonly #fetch: typeof globalThis.fetch;
  readonly #modelCountLimit: number;
  readonly #modelRequestTimeoutMs: number;
  readonly #modelResponseMaxBytes: number;
  #pendingLogin: PendingLogin | null = null;

  public constructor(client: CodexRpcClient, options: CodexProviderConnectionServiceOptions = {}) {
    this.#client = client;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#modelCountLimit = options.modelCountLimit ?? DEFAULT_MODEL_COUNT_LIMIT;
    this.#modelRequestTimeoutMs = options.modelRequestTimeoutMs ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
    this.#modelResponseMaxBytes = options.modelResponseMaxBytes ?? DEFAULT_MODEL_RESPONSE_MAX_BYTES;
  }

  public receiveNotification(method: string, params: unknown): void {
    if (method === "account/updated" && isRecord(params) && params["authMode"] === "chatgpt") {
      this.#pendingLogin = null;
      return;
    }
    if (method !== "account/login/completed" || !isRecord(params)) return;
    const loginId = params["loginId"];
    if (typeof loginId !== "string" || this.#pendingLogin?.loginId !== loginId) return;
    if (params["success"] === true) {
      this.#pendingLogin = null;
      return;
    }
    this.#pendingLogin = {
      error: optionalString(params["error"], 1_000) ?? "Login failed",
      loginId,
      state: "failed",
    };
  }

  public async readStatus(): Promise<AgentProviderConnectionStatus> {
    const [configResponse, accountResponse] = await Promise.all([
      this.#client.request("config/read", { includeLayers: false }),
      this.#client.request("account/read", { refreshToken: false }),
    ]);
    const config = readConfig(configResponse);
    const accountState = readAccountResponse(accountResponse);
    const { customBaseUrl, mode } = readActiveProvider(config);
    const pendingLogin = this.#pendingLogin;
    const connected =
      mode === "custom"
        ? !accountState.requiresOpenaiAuth || accountState.account !== null
        : accountState.account !== null;
    const state = pendingLogin?.state ?? (connected ? "connected" : "disconnected");
    return {
      account: accountState.account,
      customBaseUrl,
      mode,
      pendingLogin,
      state,
    };
  }

  public async startOfficialLogin(): Promise<StartOfficialProviderLoginResponse> {
    await this.#client.request("config/batchWrite", {
      edits: [{ keyPath: "model_provider", mergeStrategy: "upsert", value: "openai" }],
    });
    const response = await this.#client.request("account/login/start", {
      appBrand: "chatgpt",
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
    });
    if (!isRecord(response) || response["type"] !== "chatgpt") {
      throw new CodexProviderConnectionError("Codex returned an invalid login response");
    }
    const loginId = requiredString(response["loginId"], "login id");
    const authUrl = requiredString(response["authUrl"], "login URL");
    this.#pendingLogin = { error: null, loginId, state: "pending" };
    return { authUrl, loginId, status: await this.readStatus() };
  }

  public async cancelLogin(loginId: string): Promise<AgentProviderConnectionMutationResponse> {
    await this.#client.request("account/login/cancel", { loginId });
    if (this.#pendingLogin?.loginId === loginId) this.#pendingLogin = null;
    return { status: await this.readStatus() };
  }

  public async logout(): Promise<AgentProviderConnectionMutationResponse> {
    await this.#client.request("account/logout");
    this.#pendingLogin = null;
    return { status: await this.readStatus() };
  }

  public async configureCustom(
    input: ConfigureCustomProviderRequest,
  ): Promise<ConfigureCustomProviderResponse> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = input.apiKey;
    if (apiKey?.trim().length === 0) {
      throw new CodexProviderConnectionError("Custom API key cannot be blank");
    }
    const manualModels = normalizeManualModels(input.models ?? [], this.#modelCountLimit);
    let discoveredModels: CustomModelDefinition[];
    try {
      discoveredModels = await this.#discoverModels(baseUrl, apiKey);
    } catch (error) {
      if (manualModels.length === 0) throw error;
      // 部分兼容 API 不提供模型目录；显式模型仍可用于 Responses API Turn。
      discoveredModels = [];
    }
    // 手动条目位于后侧，同 ID 时覆盖远端缺省名称。
    const models = mapCustomModels([...discoveredModels, ...manualModels], this.#modelCountLimit);
    if (apiKey !== undefined) {
      await this.#client.request("account/login/start", { apiKey, type: "apiKey" });
    }
    await this.#client.request("config/batchWrite", {
      edits: [
        {
          keyPath: `model_providers.${CUSTOM_PROVIDER_ID}`,
          mergeStrategy: "upsert",
          value: {
            base_url: baseUrl,
            name: "CodeAgent Custom API",
            requires_openai_auth: apiKey !== undefined,
            wire_api: "responses",
          },
        },
        { keyPath: "model_provider", mergeStrategy: "upsert", value: CUSTOM_PROVIDER_ID },
      ],
    });
    // 0.149.0 会从最新 config 解析当前 Provider；在返回成功前确认其运行时能力可被读取。
    readProviderCapabilities(await this.#client.request("modelProvider/capabilities/read", {}));
    this.#pendingLogin = null;
    return { models, status: await this.readStatus() };
  }

  async #discoverModels(
    baseUrl: string,
    apiKey: string | undefined,
  ): Promise<CustomModelDefinition[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#modelRequestTimeoutMs);
    timeout.unref();
    try {
      const response = await this.#fetch(`${baseUrl}/models`, {
        headers: apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new CodexProviderConnectionError("Custom model endpoint redirect is not allowed");
      }
      if (!response.ok) {
        throw new CodexProviderConnectionError(
          `Custom model endpoint returned HTTP ${String(response.status)}`,
        );
      }
      // 定时器持续覆盖响应正文读取，避免远端仅返回响应头后永久挂起。
      const body = await readBoundedBody(response, this.#modelResponseMaxBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        throw new CodexProviderConnectionError("Custom model endpoint returned invalid JSON");
      }
      return readDiscoveredModels(parsed, this.#modelCountLimit);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CodexProviderConnectionError("Custom model request timed out");
      }
      if (error instanceof CodexProviderConnectionError) throw error;
      throw new CodexProviderConnectionError("Custom model request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
