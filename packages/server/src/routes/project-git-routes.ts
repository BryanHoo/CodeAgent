import {
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  AgentMutationErrorSchema,
  ProjectGitStatusSchema,
  type AgentTaskSettings,
  type CommitProjectChangesRequest,
  type GenerateCommitMessageRequest,
} from "@code-agent/protocol";
import { GitCommitError } from "../git-commit.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

import type { FastifyInstance } from "fastify";

export function registerProjectGitRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const {
    activeGitMutations,
    assertCommitSelection,
    buildCommitMessagePrompt,
    commitProjectChanges,
    generateCommitMessageWithCodex,
    getProjectContext,
    readEffectiveGlobalSettings,
    readProjectGitStatus,
    runIdempotent,
    toGitCommitHttpError,
  } = context;

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/git/status",
    {
      schema: {
        params: ProjectParamsSchema,
        response: {
          200: ProjectGitStatusSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
      }
      try {
        return await readProjectGitStatus(context.project.rootPath);
      } catch {
        // Git 和文件系统错误在 HTTP 边界统一收敛，避免向页面泄露本机路径细节。
        return reply.code(500).send({
          code: "GIT_STATUS_UNAVAILABLE",
          message: "Git working tree status is unavailable",
        });
      }
    },
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
        response: {
          200: GenerateCommitMessageResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      return runIdempotent(
        ["generate-commit-message", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const status = await readProjectGitStatus(context.project.rootPath).catch(() => {
            throw new MutationHttpError(
              "GIT_REPOSITORY_UNAVAILABLE",
              "Git repository is unavailable",
              409,
            );
          });
          assertCommitSelection(status, request.body);
          const globalSettings = await readEffectiveGlobalSettings();
          const settings: AgentTaskSettings = {
            approvalPolicy: "never",
            approvalsReviewer: "user",
            model: globalSettings.commitMessageModel,
            reasoningEffort: globalSettings.commitMessageReasoningEffort,
            sandboxMode: "read-only",
          };
          const message = await generateCommitMessageWithCodex(
            context.provider,
            buildCommitMessagePrompt(status, request.body, globalSettings.commitMessagePrompt),
            settings,
          );
          return { message, snapshot: status.snapshot };
        },
      );
    },
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
        response: {
          201: CommitProjectChangesResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await getProjectContext(request.params.projectId);
      if (context === undefined) {
        throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      const result = await runIdempotent(
        ["commit-project-changes", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (activeGitMutations.has(request.params.projectId)) {
            throw new MutationHttpError(
              "GIT_MUTATION_IN_PROGRESS",
              "Another Git mutation is already in progress",
              409,
              true,
            );
          }
          activeGitMutations.add(request.params.projectId);
          try {
            return await commitProjectChanges(context.project.rootPath, request.body);
          } catch (error) {
            if (error instanceof GitCommitError) {
              throw toGitCommitHttpError(error);
            }
            throw new MutationHttpError("GIT_COMMIT_FAILED", "Git commit failed", 502);
          } finally {
            activeGitMutations.delete(request.params.projectId);
          }
        },
      );
      return reply.code(201).send(result);
    },
  );
}
