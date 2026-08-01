import type { CommitProjectChangesResponse, ProjectGitStatus } from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import {
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
} from "../../projects/project-queries.js";
import { CommitChangesDialog } from "./commit-changes-dialog.js";

type CommitChangesControllerProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  gitStatus: ProjectGitStatus;
  onClose: () => void;
  projectId: string;
}>;

export function CommitChangesController({
  client,
  gitStatus,
  onClose,
  projectId,
}: CommitChangesControllerProps) {
  const queryClient = useQueryClient();
  const messageMutation = useMutation(projectCommitMessageMutationOptions(projectId, client));
  const commitMutation = useMutation(projectCommitChangesMutationOptions(projectId, client));
  const [result, setResult] = useState<CommitProjectChangesResponse | null>(null);

  const close = useCallback(() => {
    setResult(null);
    messageMutation.reset();
    commitMutation.reset();
    onClose();
  }, [commitMutation, messageMutation, onClose]);

  return (
    <CommitChangesDialog
      error={commitMutation.error ?? messageMutation.error}
      gitStatus={gitStatus}
      isCommitting={commitMutation.isPending}
      isGenerating={messageMutation.isPending}
      key={`${projectId}:${gitStatus.snapshot}`}
      onClose={close}
      onCommit={async (request) => {
        const response = await commitMutation.mutateAsync(request);
        setResult(response);
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: ["projects", projectId, "git-status"],
        });
      }}
      onGenerateMessage={async (request) => {
        const response = await messageMutation.mutateAsync(request);
        return response.message;
      }}
      result={result}
    />
  );
}
