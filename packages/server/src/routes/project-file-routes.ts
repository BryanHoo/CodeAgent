import { Buffer } from "node:buffer";

import {
  AgentAttachmentUploadResponseSchema,
  AgentMutationErrorSchema,
  ImportHostAttachmentRequestSchema,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
  ProjectFileSearchPageSchema,
  ProjectFileSearchQuerySchema,
  ProjectFileTreeQuerySchema,
  ProjectFileTreeSchema,
  ProjectSourceFileQuerySchema,
  ProjectSourceFileSchema,
  type AgentAttachmentKind,
  type ImportHostAttachmentRequest,
  type ProjectFileSearchQuery,
  type ProjectFileTreeQuery,
  type ProjectSourceFileQuery,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

import {
  MutationHttpError,
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import {
  ErrorResponseSchema,
  IdempotencyHeadersSchema,
  ProjectAttachmentParamsSchema,
  ProjectHostAttachmentParamsSchema,
  ProjectParamsSchema,
  ProjectStoredAttachmentParamsSchema,
  SourceFileQuerySchema,
} from "./schemas.js";

const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

function maximumBytes(kind: AgentAttachmentKind): number {
  if (kind === "image") return MAX_AGENT_IMAGE_BYTES;
  if (kind === "text") return MAX_AGENT_TEXT_BYTES;
  return MAX_AGENT_FILE_BYTES;
}

function mediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

export function registerProjectFileRoutes(
  app: FastifyInstance,
  { engine }: ServerRouteContext,
): void {
  app.get<{ Params: { projectId: string }; Querystring: ProjectFileTreeQuery }>(
    "/v1/projects/:projectId/files/tree",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectFileTreeQuerySchema,
        response: {
          200: ProjectFileTreeSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.fileTree(createReadRequestId(), request.params.projectId, request.query.path),
      ),
  );
  app.get<{ Params: { projectId: string }; Querystring: ProjectFileSearchQuery }>(
    "/v1/projects/:projectId/files/search",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectFileSearchQuerySchema,
        response: {
          200: ProjectFileSearchPageSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.fileSearch(createReadRequestId(), request.params.projectId, request.query.query),
      ),
  );
  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/v1/projects/:projectId/files/image",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: SourceFileQuerySchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const bytes = await callEngine<Uint8Array>(() =>
        engine.projectImage(createReadRequestId(), request.params.projectId, request.query.path),
      );
      return reply
        .header("cache-control", "private, max-age=60")
        .header("x-content-type-options", "nosniff")
        .type(mediaType(bytes))
        .send(Buffer.from(bytes));
    },
  );
  app.get<{ Params: { projectId: string }; Querystring: ProjectSourceFileQuery }>(
    "/v1/projects/:projectId/files/source",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectSourceFileQuerySchema,
        response: { 200: ProjectSourceFileSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.fileSourceRead(
          createReadRequestId(),
          request.params.projectId,
          request.query.path,
          request.query.cursor,
        ),
      ),
  );
  app.post<{
    Body: ImportHostAttachmentRequest;
    Headers: { "idempotency-key": string };
    Params: { kind: "file" | "image"; projectId: string };
  }>(
    "/v1/projects/:projectId/attachments/:kind/host",
    {
      schema: {
        body: ImportHostAttachmentRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectHostAttachmentParamsSchema,
        response: { 201: AgentAttachmentUploadResponseSchema, 400: AgentMutationErrorSchema },
      },
    },
    async (request, reply) => {
      const attachment = await callEngine(() =>
        engine.attachmentImportHost(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.kind,
          request.body.path,
        ),
      );
      return reply.code(201).send({ attachment });
    },
  );
  app.post<{
    Headers: { "idempotency-key": string };
    Params: { kind: AgentAttachmentKind; projectId: string };
  }>(
    "/v1/projects/:projectId/attachments/:kind",
    {
      schema: {
        headers: IdempotencyHeadersSchema,
        params: ProjectAttachmentParamsSchema,
        response: {
          201: AgentAttachmentUploadResponseSchema,
          400: AgentMutationErrorSchema,
          413: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const limit = maximumBytes(request.params.kind);
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > limit + MULTIPART_ENVELOPE_BYTES) {
        throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
      }
      if (!request.isMultipart()) {
        throw new MutationHttpError(
          "INVALID_REQUEST",
          "Attachment must use multipart/form-data",
          400,
        );
      }
      const part = await request.file({
        limits: { fields: 0, files: 1, fileSize: limit, parts: 1 },
      });
      if (part?.fieldname !== "attachment") {
        throw new MutationHttpError("INVALID_REQUEST", "Attachment is invalid", 400);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      if (part.file.truncated) {
        throw new MutationHttpError("INVALID_REQUEST", "Attachment is too large", 413);
      }
      const attachment = await callEngine(() =>
        engine.attachmentUpload(
          readRequestId(request.headers),
          request.params.projectId,
          request.params.kind,
          part.mimetype,
          part.filename,
          Buffer.concat(chunks),
        ),
      );
      return reply.code(201).send({ attachment });
    },
  );
  app.get<{ Params: { attachmentId: string; projectId: string } }>(
    "/v1/projects/:projectId/attachments/:attachmentId",
    {
      schema: {
        params: ProjectStoredAttachmentParamsSchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const bytes = await callEngine<Uint8Array>(() =>
        engine.attachmentPendingRead(
          createReadRequestId(),
          request.params.projectId,
          request.params.attachmentId,
        ),
      );
      return reply
        .header("x-content-type-options", "nosniff")
        .type(mediaType(bytes))
        .send(Buffer.from(bytes));
    },
  );
}
