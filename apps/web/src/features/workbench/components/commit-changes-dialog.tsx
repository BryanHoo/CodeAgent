import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  GenerateCommitMessageRequest,
  ProjectGitStatus,
} from "@code-agent/protocol";
import { ChevronDown, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type CommitFileEntry = Readonly<{
  path: string;
  staged: boolean;
  unstaged: boolean;
}>;

type CommitChangesDialogProps = Readonly<{
  error?: Error | null;
  gitStatus: ProjectGitStatus;
  isCommitting?: boolean;
  isGenerating?: boolean;
  onClose: () => void;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  result?: CommitProjectChangesResponse | null;
}>;

export function collectCommitFileEntries(status: ProjectGitStatus): readonly CommitFileEntry[] {
  const entries = new Map<string, { path: string; staged: boolean; unstaged: boolean }>();
  for (const change of status.staged) {
    entries.set(change.path, { path: change.path, staged: true, unstaged: false });
  }
  for (const change of status.unstaged) {
    const current = entries.get(change.path);
    entries.set(change.path, {
      path: change.path,
      staged: current?.staged ?? false,
      unstaged: true,
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function commitResultMessage(result: CommitProjectChangesResponse): string {
  if (result.pushStatus === "failed") {
    return "提交已完成，但推送失败";
  }
  if (result.pushStatus === "not_configured") {
    return "提交已完成，当前分支未配置上游";
  }
  return result.pushStatus === "pushed" ? "提交并推送已完成" : "提交已完成";
}

export function CommitChangesDialog({
  error = null,
  gitStatus,
  isCommitting = false,
  isGenerating = false,
  onClose,
  onCommit,
  onGenerateMessage,
  result = null,
}: CommitChangesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const entries = useMemo(() => collectCommitFileEntries(gitStatus), [gitStatus]);
  const [selectedPaths, setSelectedPaths] = useState(
    () => new Set(entries.map((entry) => entry.path)),
  );
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const isPending = isGenerating || isCommitting;
  const repositoryAvailable = gitStatus.repositoryMode === "root";
  const allSelected = entries.length > 0 && selectedPaths.size === entries.length;
  const canGenerate =
    repositoryAvailable && selectedPaths.size > 0 && !isPending && result === null;
  const canCommit = canGenerate && message.trim().length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const generateMessage = async () => {
    const generated = await onGenerateMessage({
      expectedSnapshot: gitStatus.snapshot,
      paths: [...selectedPaths],
    });
    setMessage(generated);
  };

  const commit = async (action: CommitProjectChangesRequest["action"]) => {
    await onCommit({
      action,
      expectedSnapshot: gitStatus.snapshot,
      message,
      paths: [...selectedPaths],
    });
  };

  return (
    <dialog
      aria-labelledby="commit-changes-title"
      className="m-auto max-h-[min(88vh,46rem)] w-[min(94vw,42rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="grid max-h-[min(88vh,46rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex h-12 items-center justify-between border-b border-separator px-4">
          <div className="min-w-0">
            <h2 className="text-body-small font-semibold" id="commit-changes-title">
              提交变更
            </h2>
            <p className="truncate text-caption text-muted-foreground">
              {gitStatus.branch ?? "detached HEAD"}
            </p>
          </div>
          <button
            aria-label="关闭提交弹窗"
            className="grid size-7 place-items-center rounded-control text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
            disabled={isPending}
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 px-4 py-3">
          {repositoryAvailable ? null : (
            <p
              className="mb-3 rounded-control bg-control px-3 py-2 text-label text-danger"
              role="alert"
            >
              当前项目包含多个子仓库，暂不支持跨仓库提交
            </p>
          )}

          <button
            aria-controls="commit-file-list"
            aria-expanded={filesExpanded}
            aria-label={`选择文件，已选择 ${String(selectedPaths.size)}/${String(entries.length)} 个文件`}
            className={`flex h-9 w-full items-center gap-2 border border-separator bg-panel px-3 text-left text-label hover:bg-control-hover ${filesExpanded ? "rounded-t-control" : "rounded-control"}`}
            onClick={() => {
              setFilesExpanded((current) => !current);
            }}
            type="button"
          >
            <span className="font-medium">选择文件</span>
            <span className="ml-auto whitespace-nowrap text-muted-foreground">
              已选择 {selectedPaths.size} 个文件
            </span>
            <span className="whitespace-nowrap text-caption text-muted-foreground">
              共 {entries.length} 个
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 transition-transform ${filesExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {filesExpanded ? (
            <div
              className="max-h-[min(24dvh,14rem)] divide-y divide-separator overflow-y-auto overscroll-contain rounded-b-control border-x border-b border-separator"
              data-commit-file-list=""
              id="commit-file-list"
            >
              {/* 全选控制跟随文件列表滚动，避免占用 message 区域。 */}
              <label className="flex min-h-9 items-center gap-2 bg-control px-3 py-2 text-label font-medium">
                <input
                  aria-label="全选文件"
                  checked={allSelected}
                  disabled={!repositoryAvailable || isPending || result !== null}
                  onChange={(event) => {
                    setSelectedPaths(
                      event.currentTarget.checked
                        ? new Set(entries.map((entry) => entry.path))
                        : new Set(),
                    );
                  }}
                  type="checkbox"
                />
                <span>全选</span>
              </label>
              {entries.map((entry) => (
                <label
                  className="flex min-h-9 items-center gap-2 px-3 py-2 text-label"
                  key={entry.path}
                >
                  <input
                    checked={selectedPaths.has(entry.path)}
                    disabled={!repositoryAvailable || isPending || result !== null}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedPaths((current) => {
                        const next = new Set(current);
                        if (checked) {
                          next.add(entry.path);
                        } else {
                          next.delete(entry.path);
                        }
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 break-all">{entry.path}</span>
                  <span className="flex shrink-0 gap-1 text-meta text-muted-foreground">
                    {entry.staged ? <span>已暂存</span> : null}
                    {entry.unstaged ? <span>未暂存</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label className="text-label font-medium" htmlFor="commit-message">
                提交信息
              </label>
              <button
                className="inline-flex h-7 items-center gap-1.5 rounded-control bg-control px-2.5 text-label font-medium hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canGenerate}
                onClick={() => {
                  void generateMessage().catch(() => undefined);
                }}
                type="button"
              >
                {isGenerating ? (
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles aria-hidden="true" className="size-3.5" />
                )}
                生成 message
              </button>
            </div>
            <textarea
              className="mt-2 h-24 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small outline-none focus:border-accent focus:shadow-focus disabled:opacity-60"
              disabled={!repositoryAvailable || isPending || result !== null}
              id="commit-message"
              onChange={(event) => {
                setMessage(event.currentTarget.value);
              }}
              value={message}
            />
          </div>

          {error === null ? null : (
            <p className="mt-3 text-label text-danger" role="alert">
              {error.message}
            </p>
          )}
          {result === null ? null : (
            <div className="mt-3" role="status">
              <p className="text-label font-medium">{commitResultMessage(result)}</p>
              <p className="mt-1 font-mono text-caption text-muted-foreground">
                {result.commitSha.slice(0, 7)}
              </p>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-separator px-4 py-3">
          <button
            className="h-8 rounded-control px-3 text-label text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            {result === null ? "取消" : "关闭"}
          </button>
          {result === null ? (
            <>
              <button
                className="h-8 rounded-control bg-control px-3 text-label font-medium hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canCommit}
                onClick={() => {
                  void commit("commit").catch(() => undefined);
                }}
                type="button"
              >
                提交
              </button>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-label font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canCommit}
                onClick={() => {
                  void commit("commit_and_push").catch(() => undefined);
                }}
                type="button"
              >
                {isCommitting ? (
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Upload aria-hidden="true" className="size-3.5" />
                )}
                提交并推送
              </button>
            </>
          ) : null}
        </footer>
      </div>
    </dialog>
  );
}
