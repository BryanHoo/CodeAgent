import {
  AgentMutationErrorSchema,
  CreateProjectWorktreeRequestSchema,
  ProjectGitWorktreePageSchema,
  ProjectWorktreeMutationResponseSchema,
  SwitchProjectWorktreeRequestSchema,
  type CreateProjectWorktreeRequest,
  type SwitchProjectWorktreeRequest,
} from "@code-agent/protocol";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";

import { originalErrorMessage } from "../error-message.js";
import { GitWorktreeError } from "../git-worktree.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

function toGitWorktreeHttpError(error: GitWorktreeError): MutationHttpError {
  switch (error.code) {
    case "SNAPSHOT_MISMATCH":
      return new MutationHttpError("GIT_STATUS_CHANGED", "Git working tree changed", 409, true);
    case "ALREADY_ACTIVE":
      return new MutationHttpError("GIT_WORKTREE_ALREADY_ACTIVE", error.message, 409, true);
    case "WORKTREE_NOT_FOUND":
      return new MutationHttpError("GIT_WORKTREE_NOT_FOUND", error.message, 409, true);
    case "INVALID_BRANCH_NAME":
      return new MutationHttpError("GIT_BRANCH_INVALID", error.message, 400, false);
    case "REPOSITORY_READ_ONLY":
      return new MutationHttpError("GIT_REPOSITORY_READ_ONLY", error.message, 409, true);
    case "CREATE_FAILED":
      return new MutationHttpError("GIT_WORKTREE_CREATE_FAILED", error.message, 502, true);
  }
}

export function registerProjectGitWorktreeRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
): void {
  const {
    activeGitMutations,
    createProjectWorktree,
    getProjectContext,
    projectRepository,
    readProjectWorktrees,
    resolveProjectWorktree,
    runIdempotent,
  } = context;
  const assertGitMutationAvailable = (projectId: string) => {
    if (activeGitMutations.has(projectId)) {
      throw new MutationHttpError(
        "GIT_MUTATION_IN_PROGRESS",
        "Another Git mutation is already in progress",
        409,
        true,
      );
    }
  };

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/git/worktrees",
    {
      schema: {
        params: ProjectParamsSchema,
        response: {
          200: ProjectGitWorktreePageSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readProjectWorktrees(projectContext.project.rootPath);
      } catch (error) {
        return reply.code(500).send({
          code: "GIT_WORKTREE_LIST_FAILED",
          message: originalErrorMessage(error, "Git worktree list failed"),
        });
      }
    },
  );

  app.post<{
    Body: CreateProjectWorktreeRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/worktrees",
    {
      schema: {
        body: CreateProjectWorktreeRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: ProjectWorktreeMutationResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      return runIdempotent(
        ["create-project-worktree", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          assertGitMutationAvailable(request.params.projectId);
          activeGitMutations.add(request.params.projectId);
          try {
            const worktree = await createProjectWorktree(
              projectContext.project.rootPath,
              request.body,
            );
            // 每个 worktree 形成独立 Project，避免当前 Task Runtime 被静默换目录。
            const project = await projectRepository.register({
              idempotencyKey: request.headers["idempotency-key"],
              name: basename(worktree.path),
              rootPath: worktree.path,
            });
            return { project, worktree };
          } catch (error) {
            if (error instanceof GitWorktreeError) throw toGitWorktreeHttpError(error);
            throw new MutationHttpError(
              "GIT_WORKTREE_CREATE_FAILED",
              originalErrorMessage(error, "Git worktree creation failed"),
              502,
              true,
            );
          } finally {
            activeGitMutations.delete(request.params.projectId);
          }
        },
      );
    },
  );

  app.post<{
    Body: SwitchProjectWorktreeRequest;
    Headers: { "idempotency-key": string };
    Params: { projectId: string };
  }>(
    "/v1/projects/:projectId/git/worktree",
    {
      schema: {
        body: SwitchProjectWorktreeRequestSchema,
        headers: IdempotencyHeadersSchema,
        params: ProjectParamsSchema,
        response: {
          200: ProjectWorktreeMutationResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const projectContext = await getProjectContext(request.params.projectId);
      if (projectContext === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      return runIdempotent(
        ["switch-project-worktree", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            const worktree = await resolveProjectWorktree(
              projectContext.project.rootPath,
              request.body.path,
            );
            const project = await projectRepository.register({
              idempotencyKey: request.headers["idempotency-key"],
              name: basename(worktree.path),
              rootPath: worktree.path,
            });
            return { project, worktree };
          } catch (error) {
            if (error instanceof GitWorktreeError) throw toGitWorktreeHttpError(error);
            throw new MutationHttpError(
              "PROVIDER_ERROR",
              originalErrorMessage(error, "Git worktree switch failed"),
              502,
              true,
            );
          }
        },
      );
    },
  );
}
