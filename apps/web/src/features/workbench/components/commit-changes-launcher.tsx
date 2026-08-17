import type { ProjectGitStatus } from "@code-agent/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import {
  projectGitDetailedStatusQueryOptions,
  type CodeAgentWorkbenchClient,
} from "../../projects/project-queries.js";
import { loadProjectGitFileDiff } from "../project-git-file-diff.js";
import { CommitChangesController } from "./commit-changes-controller.js";

export type CommitChangesLauncherHandle = Readonly<{
  open: () => void;
}>;

type CommitChangesLauncherProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  gitStatus: ProjectGitStatus;
  onOpenFileDiff: (change: AgentFileChange) => void;
  projectId: string;
}>;

export const CommitChangesLauncher = forwardRef<
  CommitChangesLauncherHandle,
  CommitChangesLauncherProps
>(function CommitChangesLauncher(props, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const detailsQuery = useQuery(
    projectGitDetailedStatusQueryOptions(
      props.projectId,
      null,
      props.gitStatus.snapshot,
      isOpen && props.gitStatus.repositoryMode === "root",
      props.client,
    ),
  );
  const shouldRestoreFocusRef = useRef(false);
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setIsOpen(false);
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    if (!isOpen && shouldRestoreFocusRef.current) {
      // 等按需模块完整卸载后恢复焦点，关闭状态不保留提交逻辑或动画帧任务。
      shouldRestoreFocusRef.current = false;
      document.querySelector<HTMLButtonElement>("#workbench-commit-changes")?.focus();
    }
  }, [isOpen]);

  const gitStatus =
    props.gitStatus.repositoryMode === "root"
      ? (detailsQuery.data ?? props.gitStatus)
      : props.gitStatus;
  return isOpen ? (
    <CommitChangesController
      {...props}
      detailsError={detailsQuery.error}
      detailsPending={detailsQuery.isFetching}
      gitStatus={gitStatus}
      onClose={close}
      onOpenFileDiff={(change) => {
        void loadProjectGitFileDiff(queryClient, props.client, props.projectId, gitStatus, change)
          .then(props.onOpenFileDiff)
          .catch(notifyActionError);
      }}
    />
  ) : null;
});
