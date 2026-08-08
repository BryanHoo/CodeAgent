import type { ProjectGitStatus } from "@code-agent/protocol";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
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
  const shouldRestoreFocusRef = useRef(false);
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setIsOpen(false);
  }, []);
  const showSuccessToast = useCallback((message: string) => {
    // 全局通知宿主独立于按需弹窗，关闭提交流程后仍能完整展示成功反馈。
    toast.success(message);
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    if (!isOpen && shouldRestoreFocusRef.current) {
      // 等按需模块完整卸载后恢复焦点，关闭状态不保留提交逻辑或动画帧任务。
      shouldRestoreFocusRef.current = false;
      document.querySelector<HTMLButtonElement>("#workbench-commit-changes")?.focus();
    }
  }, [isOpen]);

  return isOpen ? (
    <CommitChangesController {...props} onClose={close} onSuccess={showSuccessToast} />
  ) : null;
});
