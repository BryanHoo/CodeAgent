import type {
  AssetReference,
  CodeAgentOperation,
  CodeAgentRequestContext,
  CodeAgentTransport,
  SubscribeAgentEventsOptions,
} from "@code-agent/client";

import { CodeAgentClient as HttpRouteClient } from "./http-client.js";
import {
  buildProjectAttachmentUrl,
  buildProjectImageFileUrl,
  buildTaskAttachmentUrl,
  type CodeAgentClientOptions,
} from "./http-client-transport.js";
import { executeHttpOperation } from "./http-operation-map.js";

export class HttpCodeAgentTransport implements CodeAgentTransport {
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly baseUrl: string;
  private readonly routeClient: HttpRouteClient;

  public constructor(options: CodeAgentClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
    this.routeClient = new HttpRouteClient(options);
  }

  public cancel(requestId: string): Promise<void> {
    this.activeRequests.get(requestId)?.abort();
    return Promise.resolve();
  }

  public async request(
    operation: CodeAgentOperation,
    context: CodeAgentRequestContext,
  ): Promise<unknown> {
    const controller = new AbortController();
    this.activeRequests.set(context.requestId, controller);
    const signal =
      context.signal === undefined
        ? controller.signal
        : AbortSignal.any([context.signal, controller.signal]);
    try {
      return await executeHttpOperation(
        this.routeClient,
        operation,
        { signal },
        { idempotencyKey: context.idempotencyKey ?? context.requestId, signal },
      );
    } finally {
      this.activeRequests.delete(context.requestId);
    }
  }

  public resolveAssetUrl(reference: AssetReference): string {
    if (reference.kind === "project-image") {
      return buildProjectImageFileUrl(this.baseUrl, reference.projectId, reference.path);
    }
    if (reference.kind === "project-attachment") {
      return buildProjectAttachmentUrl(
        this.baseUrl,
        reference.projectId,
        reference.attachmentId ?? reference.path,
      );
    }
    return buildTaskAttachmentUrl(
      this.baseUrl,
      reference.projectId,
      reference.taskId ?? "",
      reference.attachmentId ?? reference.path,
    );
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return this.routeClient.subscribeEvents(options);
  }

  public subscribeUnauthorized(listener: () => void): () => void {
    return this.routeClient.subscribeUnauthorized(listener);
  }
}
