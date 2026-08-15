import {
  AccessStatusResponseSchema,
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentModelPageSchema,
  AgentProviderConnectionMutationResponseSchema,
  AgentProviderConnectionStatusSchema,
  AppInfoResponseSchema,
  ConfigureCustomProviderResponseSchema,
  HealthResponseSchema,
  HostNotificationResponseSchema,
  InstallAppUpdateResponseSchema,
  StartOfficialProviderLoginResponseSchema,
  type AgentGlobalSettings,
  type ConfigureCustomProviderRequest,
  type HostNotificationRequest,
} from "@code-agent/protocol";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { v4 as createUuid } from "uuid";

import type {
  AssetReference,
  CodeAgentOperation,
  CodeAgentTransport,
  MutationOptions,
  ReadOptions,
  SubscribeAgentEventsOptions,
} from "./contracts.js";
import { CodeAgentResponseError, normalizeCodeAgentError } from "./errors.js";

export type CodeAgentRequestOptions = Readonly<{
  idempotencyKey?: string;
  signal?: AbortSignal;
}>;

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class TransportCodeAgentClient {
  public constructor(private readonly transport: CodeAgentTransport) {}

  public async request<TInput, TOutputSchema extends TSchema>(
    operation: CodeAgentOperation<TInput, TOutputSchema>,
    options: CodeAgentRequestOptions = {},
  ): Promise<Static<TOutputSchema>> {
    const requestId = createUuid();
    const signal = options.signal;
    if (signal?.aborted === true) throw createAbortError();

    const cancellationState = { aborted: false };
    const onAbort = () => {
      cancellationState.aborted = true;
      // 取消必须到达宿主，不能只在 Renderer 丢弃 Promise。
      void this.transport.cancel(requestId).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.transport.request(operation, {
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        requestId,
        ...(signal === undefined ? {} : { signal }),
      });
      if (cancellationState.aborted) throw createAbortError();
      if (!Value.Check(operation.output, response)) {
        throw new CodeAgentResponseError(
          `CodeAgent response for ${operation.name} does not match the protocol schema`,
        );
      }
      return response;
    } catch (error) {
      if (cancellationState.aborted) throw createAbortError();
      throw normalizeCodeAgentError(error);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  public getHealth(options: ReadOptions = {}) {
    return this.read({ name: "app.health", output: HealthResponseSchema }, options);
  }

  public getAppInfo(options: ReadOptions = {}) {
    return this.read({ name: "app.info", output: AppInfoResponseSchema }, options);
  }

  public installAppUpdate(version: string, options: MutationOptions = {}) {
    return this.mutation(
      { input: { version }, name: "app.update_install", output: InstallAppUpdateResponseSchema },
      options,
    );
  }

  public getAccessStatus(options: ReadOptions = {}) {
    return this.read({ name: "access.status", output: AccessStatusResponseSchema }, options);
  }

  public showHostNotification(input: HostNotificationRequest, options: MutationOptions = {}) {
    return this.mutation(
      { input, name: "host.notification_show", output: HostNotificationResponseSchema },
      options,
    );
  }

  public pairAccess(code: string) {
    return this.mutation({
      input: { code },
      name: "access.pair",
      output: AccessStatusResponseSchema,
    });
  }

  public logoutAccess() {
    return this.mutation({ name: "access.logout", output: AccessStatusResponseSchema });
  }

  public getCapabilities(options: ReadOptions = {}) {
    return this.read({ name: "capabilities.get", output: AgentCapabilitiesSchema }, options);
  }

  public listModels(options: ReadOptions = {}) {
    return this.read({ name: "models.list", output: AgentModelPageSchema }, options);
  }

  public getProviderConnection(options: ReadOptions = {}) {
    return this.read(
      { name: "provider_connection.get", output: AgentProviderConnectionStatusSchema },
      options,
    );
  }

  public startOfficialProviderLogin(options: MutationOptions = {}) {
    return this.mutation(
      {
        name: "provider_connection.official_login_start",
        output: StartOfficialProviderLoginResponseSchema,
      },
      options,
    );
  }

  public cancelProviderLogin(loginId: string, options: MutationOptions = {}) {
    return this.mutation(
      {
        input: { loginId },
        name: "provider_connection.login_cancel",
        output: AgentProviderConnectionMutationResponseSchema,
      },
      options,
    );
  }

  public configureCustomProvider(
    input: ConfigureCustomProviderRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      {
        input: { input },
        name: "provider_connection.custom_configure",
        output: ConfigureCustomProviderResponseSchema,
      },
      options,
    );
  }

  public logoutProvider(options: MutationOptions = {}) {
    return this.mutation(
      { name: "provider_connection.logout", output: AgentProviderConnectionMutationResponseSchema },
      options,
    );
  }

  public getGlobalSettings(options: ReadOptions = {}) {
    return this.read(
      { name: "global_settings.get", output: AgentGlobalSettingsResponseSchema },
      options,
    );
  }

  public updateGlobalSettings(settings: AgentGlobalSettings, options: MutationOptions = {}) {
    return this.mutation(
      {
        input: { settings },
        name: "global_settings.update",
        output: AgentGlobalSettingsResponseSchema,
      },
      options,
    );
  }

  protected read<TInput, TOutputSchema extends TSchema>(
    operation: CodeAgentOperation<TInput, TOutputSchema>,
    options: ReadOptions = {},
  ): Promise<Static<TOutputSchema>> {
    return this.request(operation, options);
  }

  protected mutation<TInput, TOutputSchema extends TSchema>(
    operation: CodeAgentOperation<TInput, TOutputSchema>,
    options: MutationOptions = {},
  ): Promise<Static<TOutputSchema>> {
    return this.request(operation, options);
  }

  public resolveAssetUrl(reference: AssetReference): string {
    return this.transport.resolveAssetUrl(reference);
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return this.transport.subscribeEvents(options);
  }

  public subscribeUnauthorized(listener: () => void): () => void {
    return this.transport.subscribeUnauthorized?.(listener) ?? (() => undefined);
  }
}
