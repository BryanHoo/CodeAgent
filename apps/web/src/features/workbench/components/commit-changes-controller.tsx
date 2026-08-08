import type {
  CommitProjectChangesResponse,
  ProjectGitCommit,
  ProjectGitStatus,
} from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
  projectGitRepositoryStatusQueryOptions,
} from "../../projects/project-queries.js";
import { CommitChangesDialog, collectCommitRepositories } from "./commit-changes-dialog.js";
import { useTranslation } from "../../../i18n/i18n.js";

const LazyGitCommitReview = lazy(() =>
  import("./git-commit-review.js").then((module) => ({ default: module.GitCommitReview })),
);

type SelectedGitCommit = Readonly<{
  commit: ProjectGitCommit;
  repository?: string;
}>;

type CommitChangesControllerProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  gitStatus: ProjectGitStatus;
  onClose: () => void;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onSuccess: (message: string) => void;
  projectId: string;
}>;

function getCommitSuccessMessageKey(result: CommitProjectChangesResponse): string | null {
  if (result.pushStatus === "pushed") {
    return "commit.commitAndPushSucceeded";
  }
  return result.pushStatus === "not_requested" ? "commit.commitSucceeded" : null;
}

export function CommitChangesController({
  client,
  gitStatus,
  onClose,
  onOpenFileDiff,
  onSuccess,
  projectId,
}: CommitChangesControllerProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const messageMutation = useMutation(projectCommitMessageMutationOptions(projectId, client));
  const commitMutation = useMutation(projectCommitChangesMutationOptions(projectId, client));
  const repositories = useMemo(() => collectCommitRepositories(gitStatus), [gitStatus]);
  const [result, setResult] = useState<CommitProjectChangesResponse | null>(null);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<SelectedGitCommit>();
  const effectiveRepository =
    selectedRepository !== null && repositories.includes(selectedRepository)
      ? selectedRepository
      : (repositories[0] ?? null);
  const repositoryStatusQuery = useQuery(
    projectGitRepositoryStatusQueryOptions(
      projectId,
      effectiveRepository,
      gitStatus.repositoryMode === "children",
      client,
    ),
  );
  const activeGitStatus =
    gitStatus.repositoryMode === "root" ? gitStatus : (repositoryStatusQuery.data ?? gitStatus);

  const close = useCallback(() => {
    setResult(null);
    messageMutation.reset();
    commitMutation.reset();
    onClose();
  }, [commitMutation, messageMutation, onClose]);

  return (
    <>
      <CommitChangesDialog
        client={client}
        commitReviewOpen={selectedCommit !== undefined}
        error={repositoryStatusQuery.error ?? commitMutation.error ?? messageMutation.error}
        gitStatus={activeGitStatus}
        isCommitting={commitMutation.isPending}
        isGenerating={messageMutation.isPending}
        isRepositoryLoading={repositoryStatusQuery.isFetching}
        onClose={close}
        onCommit={async (request) => {
          const response = await commitMutation.mutateAsync(request);
          void queryClient.invalidateQueries({
            queryKey: ["projects", projectId, "git-status"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["projects", projectId, "git-history"],
          });
          const successMessageKey = getCommitSuccessMessageKey(response);
          if (successMessageKey !== null) {
            // 完整成功立即结束提交流程；toast 由常驻 Launcher 持有，关闭弹窗后仍可见。
            onSuccess(t(successMessageKey));
            close();
            return;
          }
          setResult(response);
        }}
        onGenerateMessage={async (request) => {
          const response = await messageMutation.mutateAsync(request);
          return response.message;
        }}
        onOpenFileDiff={onOpenFileDiff}
        onSelectCommit={(commit) => {
          // 审核弹窗与提交 Sheet 同级挂载，避免嵌套 Radix 弹层关闭父级提交表单。
          setSelectedCommit({
            commit,
            ...(effectiveRepository === null ? {} : { repository: effectiveRepository }),
          });
        }}
        onSelectRepository={(repository) => {
          setResult(null);
          messageMutation.reset();
          commitMutation.reset();
          setSelectedRepository(repository);
        }}
        projectId={projectId}
        repositories={repositories}
        result={result}
        selectedRepository={effectiveRepository}
      />
      {selectedCommit === undefined ? null : (
        <Suspense fallback={null}>
          <LazyGitCommitReview
            client={client}
            commit={selectedCommit.commit}
            onClose={() => {
              setSelectedCommit(undefined);
            }}
            projectId={projectId}
            {...(selectedCommit.repository === undefined
              ? {}
              : { repository: selectedCommit.repository })}
          />
        </Suspense>
      )}
    </>
  );
}
