import {
  AddProjectRequestSchema,
  AddProjectResponseSchema,
  AgentMutationErrorSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentSkillPageSchema,
  HostFileListingSchema,
  HostFileQuerySchema,
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  ProjectDirectoryListingSchema,
  ProjectDirectoryQuerySchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectPageSchema,
  RemoveProjectRequestSchema,
  RemoveProjectResponseSchema,
  RenameProjectRequestSchema,
  RenameProjectResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  type AddProjectRequest,
  type AgentProjectDefaults,
  type HostFileQuery,
  type OpenProjectRequest,
  type ProjectDirectoryQuery,
  type RemoveProjectRequest,
  type RenameProjectRequest,
  type ReorderProjectsRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import { registerProjectFileRoutes } from "./project-file-routes.js";
import { registerProjectGitRoutes } from "./project-git-routes.js";
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

export const registerProjectRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { engine } = context;
  app.get("/v1/projects", { schema: { response: { 200: ProjectPageSchema } } }, () =>
    callEngine(() => engine.projectList(createReadRequestId())),
  );
  app.get<{ Querystring: HostFileQuery }>(
    "/v1/host-files",
    {
      schema: {
        querystring: HostFileQuerySchema,
        response: { 200: HostFileListingSchema, 400: AgentMutationErrorSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.hostFilesList(
          createReadRequestId(),
          request.query.kind,
          request.query.path,
          request.query.showHidden ?? false,
        ),
      ),
  );
  app.get<{ Querystring: ProjectDirectoryQuery }>(
    "/v1/project-directories",
    {
      schema: {
        querystring: ProjectDirectoryQuerySchema,
        response: { 200: ProjectDirectoryListingSchema, 400: AgentMutationErrorSchema },
      },
    },
    (request) =>
      callEngine(() =>
        engine.projectDirectoriesList(
          createReadRequestId(),
          request.query.path,
          request.query.showHidden ?? false,
        ),
      ),
  );
  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/open-capabilities",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: ProjectOpenCapabilitiesResponseSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(async () => {
        await engine.projectRead(createReadRequestId(), request.params.projectId);
        return engine.projectOpenCapabilities(createReadRequestId());
      }),
  );
  app.post<{
    Body: OpenProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/open",
    {
      schema: {
        body: OpenProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: OpenProjectResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.projectOpen(
          readRequestId(request.headers),
          request.params.projectId,
          request.body.appId,
          request.body.path,
        ),
      ),
  );
  app.put<{ Body: ReorderProjectsRequest; Headers: { "idempotency-key": string } }>(
    "/v1/projects/order",
    {
      schema: {
        body: ReorderProjectsRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: ReorderProjectsResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.projectReorder(readRequestId(request.headers), request.body.projectIds),
      ),
  );
  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/skills",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentSkillPageSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() => engine.skillsList(createReadRequestId(), request.params.projectId)),
  );
  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        params: ProjectParamsSchema,
        response: { 200: AgentProjectDefaultsResponseSchema, 404: ErrorResponseSchema },
      },
    },
    (request) =>
      callEngine(() => engine.projectDefaultsGet(createReadRequestId(), request.params.projectId)),
  );
  app.put<{
    Body: AgentProjectDefaults;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/defaults",
    {
      schema: {
        body: AgentProjectDefaultsSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: AgentProjectDefaultsResponseSchema, ...mutationErrors },
      },
    },
    (request) =>
      callEngine(() =>
        engine.projectDefaultsUpdate(
          readRequestId(request.headers),
          request.params.projectId,
          request.body,
        ),
      ),
  );
  app.post<{ Body: AddProjectRequest; Headers: { "idempotency-key": string } }>(
    "/v1/projects",
    {
      schema: {
        body: AddProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: { 200: AddProjectResponseSchema, ...mutationErrors },
      },
    },
    async (request) => ({
      project: await callEngine(() =>
        engine.projectAdd(readRequestId(request.headers), request.body.rootPath),
      ),
    }),
  );
  app.post<{
    Body: RenameProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/rename",
    {
      schema: {
        body: RenameProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: RenameProjectResponseSchema, ...mutationErrors },
      },
    },
    async (request) => ({
      project: await callEngine(() =>
        engine.projectRename(
          readRequestId(request.headers),
          request.params.projectId,
          request.body.name.trim(),
        ),
      ),
    }),
  );
  app.post<{
    Body: RemoveProjectRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/remove",
    {
      schema: {
        body: RemoveProjectRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: { 200: RemoveProjectResponseSchema, ...mutationErrors },
      },
    },
    async (request) => {
      await callEngine(() =>
        engine.projectRemove(readRequestId(request.headers), request.params.projectId),
      );
      return { projectId: request.params.projectId, status: "removed" as const };
    },
  );
  registerProjectGitRoutes(app, context);
  registerProjectFileRoutes(app, context);
  done();
};
