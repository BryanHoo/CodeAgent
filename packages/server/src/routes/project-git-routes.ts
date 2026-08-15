import {
  AgentMutationErrorSchema,
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  CreateProjectBranchRequestSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  ProjectGitCommitFileDiffQuerySchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitCommitFilesQuerySchema,
  ProjectGitHistoryPageSchema,
  ProjectGitHistoryQuerySchema,
  ProjectGitStatusQuerySchema,
  ProjectGitStatusSchema,
  SwitchProjectBranchRequestSchema,
  type CommitProjectChangesRequest,
  type CreateProjectBranchRequest,
  type GenerateCommitMessageRequest,
  type ProjectGitCommitFileDiffQuery,
  type ProjectGitCommitFilesQuery,
  type ProjectGitHistoryQuery,
  type ProjectGitStatusQuery,
  type SwitchProjectBranchRequest,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";

import {
  callEngine,
  createReadRequestId,
  readRequestId,
  type ServerRouteContext,
} from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

const mutationErrors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
} as const;

export function registerProjectGitRoutes(
  app: FastifyInstance,
  { engine }: ServerRouteContext,
): void {
  app.get<{ Params: { projectId: string }; Querystring: ProjectGitStatusQuery }>(
    "/v1/projects/:projectId/git/status",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitStatusQuerySchema,
        response: {
          200: ProjectGitStatusSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitStatus(createReadRequestId(), request.params.projectId, request.query.repository),
      ),
  );
  app.get<{ Params: { projectId: string }; Querystring: ProjectGitHistoryQuery }>(
    "/v1/projects/:projectId/git/history",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitHistoryQuerySchema,
        response: {
          200: ProjectGitHistoryPageSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitHistory(createReadRequestId(), request.params.projectId, request.query),
      ),
  );
  app.get<{ Params: { projectId: string }; Querystring: ProjectGitCommitFilesQuery }>(
    "/v1/projects/:projectId/git/commit-files",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitCommitFilesQuerySchema,
        response: {
          200: ProjectGitCommitFilesPageSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitCommitFiles(createReadRequestId(), request.params.projectId, request.query),
      ),
  );
  app.get<{ Params: { projectId: string }; Querystring: ProjectGitCommitFileDiffQuery }>(
    "/v1/projects/:projectId/git/commit-diff",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitCommitFileDiffQuerySchema,
        response: {
          200: ProjectGitCommitFileDiffSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitCommitDiff(createReadRequestId(), request.params.projectId, request.query),
      ),
  );
  app.post<{
    Body: SwitchProjectBranchRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/branch",
    {
      schema: {
        body: SwitchProjectBranchRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: ProjectGitStatusSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitBranchSwitch(
          readRequestId(request.headers),
          request.params.projectId,
          request.body.branch,
          request.body.expectedSnapshot,
        ),
      ),
  );
  app.post<{
    Body: CreateProjectBranchRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/branches",
    {
      schema: {
        body: CreateProjectBranchRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: ProjectGitStatusSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitBranchCreate(
          readRequestId(request.headers),
          request.params.projectId,
          request.body.branch,
          request.body.expectedSnapshot,
        ),
      ),
  );
  app.post<{
    Body: GenerateCommitMessageRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/commit-message",
    {
      schema: {
        body: GenerateCommitMessageRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: GenerateCommitMessageResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.gitCommitMessageGenerate(
          readRequestId(request.headers),
          request.params.projectId,
          request.body,
        ),
      ),
  );
  app.post<{
    Body: CommitProjectChangesRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/commits",
    {
      schema: {
        body: CommitProjectChangesRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 201: CommitProjectChangesResponseSchema, ...mutationErrors },
      },
    },
    async (request, reply) => {
      const result = await callEngine(() =>
        engine.gitCommit(readRequestId(request.headers), request.params.projectId, request.body),
      );
      return reply.code(201).send(result);
    },
  );
}
