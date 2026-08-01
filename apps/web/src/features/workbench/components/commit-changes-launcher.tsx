import type { ProjectGitStatus } from "@code-agent/protocol";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import { SuccessToast } from "../../../shared/ui/success-toast.js";

const SUCCESS_TOAST_DURATION_MS = 4_000;

const LazyCommitChangesController = lazy(() =>
  import("./commit-changes-controller.js").then((module) => ({
    default: module.CommitChangesController,
  })),
);

export type CommitChangesLauncherHandle = Readonly<{
  open: () => void;
}>;

type CommitChangesLauncherProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  gitStatus: ProjectGitStatus;
  projectId: string;
}>;

export const CommitChangesLauncher = forwardRef<
  CommitChangesLauncherHandle,
  CommitChangesLauncherProps
>(function CommitChangesLauncher(props, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<Readonly<{
    id: number;
    message: string;
  }> | null>(null);
  const nextToastIdRef = useRef(0);
  const shouldRestoreFocusRef = useRef(false);
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setIsOpen(false);
  }, []);
  const showSuccessToast = useCallback((message: string) => {
    nextToastIdRef.current += 1;
    setSuccessToast({ id: nextToastIdRef.current, message });
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    if (!isOpen && shouldRestoreFocusRef.current) {
      // 等按需模块完整卸载后恢复焦点，关闭状态不保留提交逻辑或动画帧任务。
      shouldRestoreFocusRef.current = false;
      document.querySelector<HTMLButtonElement>("#workbench-commit-changes")?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (successToast === null) {
      return;
    }
    // 每次成功都重置可见时长，连续提交不会沿用上一次的剩余计时。
    const timeoutId = window.setTimeout(() => {
      setSuccessToast(null);
    }, SUCCESS_TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [successToast]);

  return (
    <>
      {isOpen ? (
        <Suspense fallback={null}>
          <LazyCommitChangesController {...props} onClose={close} onSuccess={showSuccessToast} />
        </Suspense>
      ) : null}
      {successToast === null ? null : (
        <SuccessToast
          key={successToast.id}
          message={successToast.message}
          onDismiss={() => {
            setSuccessToast(null);
          }}
        />
      )}
    </>
  );
});
