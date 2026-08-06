import type { CommitProjectChangesResponse, ProjectGitStatus } from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
  projectGitRepositoryStatusQueryOptions,
} from "../../projects/project-queries.js";
import { CommitChangesDialog, collectCommitRepositories } from "./commit-changes-dialog.js";
import { useTranslation } from "../../../i18n/i18n.js";

type CommitChangesControllerProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  gitStatus: ProjectGitStatus;
  onClose: () => void;
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
  onSuccess,
  projectId,
}: CommitChangesControllerProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const messageMutation = useMutation(projectCommitMessageMutationOptions(projectId, client));
  const commitMutation = useMutation(projectCommitChangesMutationOptions(projectId, client));
  const [result, setResult] = useState<CommitProjectChangesResponse | null>(null);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const repositories = useMemo(() => collectCommitRepositories(gitStatus), [gitStatus]);
  const effectiveRepository =
    selectedRepository !== null && repositories.includes(selectedRepository)
      ? selectedRepository
      : null;
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
    <CommitChangesDialog
      error={repositoryStatusQuery.error ?? commitMutation.error ?? messageMutation.error}
      gitStatus={activeGitStatus}
      isCommitting={commitMutation.isPending}
      isGenerating={messageMutation.isPending}
      isRepositoryLoading={repositoryStatusQuery.isFetching}
      key={`${projectId}:${effectiveRepository ?? "root"}:${activeGitStatus.snapshot}`}
      onClose={close}
      onCommit={async (request) => {
        const response = await commitMutation.mutateAsync(request);
        void queryClient.invalidateQueries({
          queryKey: ["projects", projectId, "git-status"],
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
      onSelectRepository={(repository) => {
        setResult(null);
        messageMutation.reset();
        commitMutation.reset();
        setSelectedRepository(repository);
      }}
      repositories={repositories}
      result={result}
      selectedRepository={effectiveRepository}
    />
  );
}
