import { Buffer } from "node:buffer";

import {
  AgentMutationErrorSchema,
  OpenAgentTaskAttachmentRequestSchema,
  OpenAgentTaskAttachmentResponseSchema,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

import {
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectTaskAttachmentParamsSchema,
} from "./schemas.js";

interface TaskAttachmentParams {
  attachmentId: string;
  projectId: string;
  taskId: string;
}

function mediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

export function registerTaskAttachmentRoutes(
  app: FastifyInstance,
  { engine }: ServerRouteContext,
): void {
  app.get<{ Params: TaskAttachmentParams }>(
    "/v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId",
    {
      schema: { params: ProjectTaskAttachmentParamsSchema, response: { 404: ErrorResponseSchema } },
    },
    async (request, reply) => {
      const bytes = await callEngine<Uint8Array>(
        () =>
          engine.attachmentTaskRead(
            createReadRequestId(),
            request.params.projectId,
            request.params.taskId,
            request.params.attachmentId,
          ),
        "ATTACHMENT_NOT_FOUND",
      );
      return reply
        .header("cache-control", "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .type(mediaType(bytes))
        .send(Buffer.from(bytes));
    },
  );
  app.post<{
    Body: Record<string, never>;
    Headers: { "idempotency-key": string };
    Params: TaskAttachmentParams;
  }>(
    "/v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId/open",
    {
      schema: {
        body: OpenAgentTaskAttachmentRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectTaskAttachmentParamsSchema,
        response: {
          200: OpenAgentTaskAttachmentResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      await callEngine(() =>
        engine.attachmentOpen(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.taskId,
          request.params.attachmentId,
        ),
      );
      return { attachmentId: request.params.attachmentId, status: "opened" as const };
    },
  );
}
