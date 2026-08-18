import {
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  CreateProjectBranchRequestSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  AgentMutationErrorSchema,
  ProjectGitHistoryPageSchema,
  ProjectGitHistoryQuerySchema,
  ProjectGitCommitFileDiffQuerySchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitCommitFilesQuerySchema,
  ProjectGitStatusSchema,
  ProjectGitStatusQuerySchema,
  SwitchProjectBranchRequestSchema,
  type AgentTaskSettings,
  type CommitProjectChangesRequest,
  type CreateProjectBranchRequest,
  type GenerateCommitMessageRequest,
  type ProjectGitHistoryQuery,
  type ProjectGitCommitFileDiffQuery,
  type ProjectGitCommitFilesQuery,
  type ProjectGitStatusQuery,
  type SwitchProjectBranchRequest,
} from "@code-agent/protocol";
import { GitBranchError } from "../git-branch.js";
import { GitCommitError } from "../git-commit.js";
import { GitHistoryError } from "../git-history.js";
import { GitCommitReviewError } from "../git-commit-review.js";
import { GitRepositorySelectionError } from "../git-working-tree.js";
import { originalErrorMessage } from "../error-message.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";
import { registerProjectGitWorktreeRoutes } from "./project-git-worktree-routes.js";

import type { FastifyInstance, FastifyReply } from "fastify";

function toGitBranchHttpError(error: GitBranchError): MutationHttpError {
  switch (error.code) {
    case "SNAPSHOT_MISMATCH":
      return new MutationHttpError("GIT_STATUS_CHANGED", "Git working tree changed", 409, true);
    case "ALREADY_ACTIVE":
      return new MutationHttpError("GIT_BRANCH_ALREADY_ACTIVE", error.message, 409, true);
    case "BRANCH_ALREADY_EXISTS":
      return new MutationHttpError("GIT_BRANCH_ALREADY_EXISTS", error.message, 409, true);
    case "BRANCH_NOT_FOUND":
      return new MutationHttpError("GIT_BRANCH_NOT_FOUND", error.message, 409, true);
    case "INVALID_BRANCH_NAME":
      return new MutationHttpError("GIT_BRANCH_INVALID", error.message, 400, false);
    case "REPOSITORY_READ_ONLY":
      return new MutationHttpError("GIT_REPOSITORY_READ_ONLY", error.message, 409, true);
    case "SWITCH_FAILED":
      return new MutationHttpError("GIT_BRANCH_SWITCH_FAILED", error.message, 502, true);
    case "CREATE_FAILED":
      return new MutationHttpError("GIT_BRANCH_CREATE_FAILED", error.message, 502, true);
  }
}

export function registerProjectGitRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const {
    activeGitMutations,
    assertCommitSelection,
    buildCommitMessagePrompt,
    commitProjectChanges,
    createProjectBranch,
    generateCommitMessageWithCodex,
    getProjectContext,
    readEffectiveGlobalSettings,
    readProjectGitHistory,
    readProjectGitCommitFiles,
    readProjectGitCommitFileDiff,
    readProjectGitStatus,
    runIdempotent,
    switchProjectBranch,
    toGitCommitHttpError,
  } = context;
  registerProjectGitWorktreeRoutes(app, context);

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

  app.get<{ Params: { projectId: string }; Querystring: ProjectGitStatusQuery }>(
    "/v1/projects/:projectId/git/status",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitStatusQuerySchema,
        response: {
          200: ProjectGitStatusSchema,
          400: ErrorResponseSchema,
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
        return await readProjectGitStatus(context.project.rootPath, request.query);
      } catch (error) {
        if (error instanceof GitRepositorySelectionError) {
          return reply.code(404).send({
            code: "GIT_REPOSITORY_NOT_FOUND",
            message: error.message,
          });
        }
        return reply.code(500).send({
          code: "GIT_STATUS_UNAVAILABLE",
          message: originalErrorMessage(error, "Git working tree status is unavailable"),
        });
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectGitHistoryQuery }>(
    "/v1/projects/:projectId/git/history",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitHistoryQuerySchema,
        response: {
          200: ProjectGitHistoryPageSchema,
          400: ErrorResponseSchema,
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
        return await readProjectGitHistory(projectContext.project.rootPath, request.query);
      } catch (error) {
        if (error instanceof GitHistoryError && error.code === "INVALID_CURSOR") {
          return reply.code(400).send({ code: "INVALID_REQUEST", message: error.message });
        }
        if (error instanceof GitHistoryError && error.code === "REPOSITORY_NOT_FOUND") {
          return reply.code(404).send({ code: "GIT_REPOSITORY_NOT_FOUND", message: error.message });
        }
        return reply.code(500).send({
          code: "GIT_HISTORY_UNAVAILABLE",
          message: originalErrorMessage(error, "Git history is unavailable"),
        });
      }
    },
  );

  const sendCommitReviewError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof GitCommitReviewError && error.code === "INVALID_CURSOR") {
      return reply.code(400).send({ code: "INVALID_REQUEST", message: error.message });
    }
    if (error instanceof GitCommitReviewError && error.code === "REPOSITORY_NOT_FOUND") {
      return reply.code(404).send({ code: "GIT_REPOSITORY_NOT_FOUND", message: error.message });
    }
    return reply.code(500).send({
      code: "GIT_COMMIT_REVIEW_UNAVAILABLE",
      message: originalErrorMessage(error, "Git commit review is unavailable"),
    });
  };

  app.get<{ Params: { projectId: string }; Querystring: ProjectGitCommitFilesQuery }>(
    "/v1/projects/:projectId/git/commit-files",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitCommitFilesQuerySchema,
        response: {
          200: ProjectGitCommitFilesPageSchema,
          400: ErrorResponseSchema,
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
        return await readProjectGitCommitFiles(projectContext.project.rootPath, request.query);
      } catch (error) {
        return sendCommitReviewError(error, reply);
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: ProjectGitCommitFileDiffQuery }>(
    "/v1/projects/:projectId/git/commit-diff",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectGitCommitFileDiffQuerySchema,
        response: {
          200: ProjectGitCommitFileDiffSchema,
          400: ErrorResponseSchema,
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
        return await readProjectGitCommitFileDiff(projectContext.project.rootPath, request.query);
      } catch (error) {
        return sendCommitReviewError(error, reply);
      }
    },
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
        response: {
          200: ProjectGitStatusSchema,
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
        ["switch-project-branch", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          assertGitMutationAvailable(request.params.projectId);
          activeGitMutations.add(request.params.projectId);
          try {
            return await switchProjectBranch(projectContext.project.rootPath, request.body);
          } catch (error) {
            if (error instanceof GitBranchError) {
              throw toGitBranchHttpError(error);
            }
            throw new MutationHttpError(
              "GIT_BRANCH_SWITCH_FAILED",
              originalErrorMessage(error, "Git branch switch failed"),
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
        response: {
          200: ProjectGitStatusSchema,
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
        ["create-project-branch", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          assertGitMutationAvailable(request.params.projectId);
          activeGitMutations.add(request.params.projectId);
          try {
            return await createProjectBranch(projectContext.project.rootPath, request.body);
          } catch (error) {
            if (error instanceof GitBranchError) {
              throw toGitBranchHttpError(error);
            }
            throw new MutationHttpError(
              "GIT_BRANCH_CREATE_FAILED",
              originalErrorMessage(error, "Git branch creation failed"),
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
          503: AgentMutationErrorSchema,
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
          const status = await readProjectGitStatus(context.project.rootPath, {
            includeDiff: true,
            ...(request.body.repository === undefined
              ? {}
              : { repository: request.body.repository }),
          }).catch((error: unknown) => {
            throw new MutationHttpError(
              "GIT_REPOSITORY_UNAVAILABLE",
              originalErrorMessage(error, "Git repository is unavailable"),
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
          503: AgentMutationErrorSchema,
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
          assertGitMutationAvailable(request.params.projectId);
          activeGitMutations.add(request.params.projectId);
          try {
            return await commitProjectChanges(context.project.rootPath, request.body);
          } catch (error) {
            if (error instanceof GitCommitError) {
              throw toGitCommitHttpError(error);
            }
            throw new MutationHttpError(
              "GIT_COMMIT_FAILED",
              originalErrorMessage(error, "Git commit failed"),
              502,
            );
          } finally {
            activeGitMutations.delete(request.params.projectId);
          }
        },
      );
      return reply.code(201).send(result);
    },
  );
}
