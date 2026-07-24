import type { ProjectGitStatus } from "@code-agent/protocol";
import { Braces, FileCode2, GitBranch, HardDrive, Plus } from "lucide-react";
import { useState } from "react";

import { countFileChangeLines, getFileName, type AgentFileChange } from "../../diff/file-change.js";

type WorkbenchInspectorProps = Readonly<{
  onOpenFileDiff: (change: AgentFileChange) => void;
  gitStatus?: ProjectGitStatus;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  projectName: string;
}>;

export function WorkbenchInspector({
  gitStatus,
  gitStatusError = null,
  gitStatusPending = false,
  onOpenFileDiff,
  projectName,
}: WorkbenchInspectorProps) {
  const [tab, setTab] = useState<"changes" | "context">("changes");
  const stagedChanges = gitStatus?.staged ?? [];
  const unstagedChanges = gitStatus?.unstaged ?? [];
  const allChanges = [...unstagedChanges, ...stagedChanges];
  let additions = 0;
  let removals = 0;
  for (const change of allChanges) {
    const fileStats = countFileChangeLines(change);
    additions += fileStats.additions;
    removals += fileStats.removals;
  }

  return (
    <aside
      aria-label="Context Inspector"
      className="workbench-inspector z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-panel shadow-divider-reverse"
    >
      <div className="flex h-workbench-header items-center px-3">
        <h2 className="text-body-small font-semibold text-foreground">环境信息</h2>
      </div>

      <div className="px-2.5 pb-1.5">
        <div className="grid grid-cols-2 rounded-control bg-control p-0.5" role="tablist">
          {(["changes", "context"] as const).map((value) => (
            <button
              aria-selected={tab === value}
              className={`h-7 rounded-control text-label font-medium transition-colors ${
                tab === value
                  ? "bg-raised text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={value}
              onClick={() => {
                setTab(value);
              }}
              role="tab"
              type="button"
            >
              {value === "changes" ? "变更" : "上下文"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden" role="tabpanel">
        {tab === "changes" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex items-center justify-between px-2.5 pb-3 pt-2.5">
              <div>
                <p className="text-xs font-medium text-foreground">未提交变更</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {allChanges.length} 个变更
                </p>
              </div>
              <span className="text-meta font-medium">
                <span className="text-diff-added">+{additions}</span>{" "}
                <span className="text-diff-removed">-{removals}</span>
              </span>
            </div>
            <div aria-label="Git 变更文件" className="min-h-0 overflow-y-auto px-2.5 pb-2.5">
              {gitStatusError !== null ? (
                <p className="px-2 py-5 text-center text-label text-diff-removed">
                  无法读取当前项目的 Git 变更
                </p>
              ) : gitStatusPending && gitStatus === undefined ? (
                <p className="px-2 py-5 text-center text-label text-muted-foreground">
                  正在读取 Git 变更...
                </p>
              ) : allChanges.length === 0 ? (
                <p className="px-2 py-5 text-center text-label text-muted-foreground">
                  当前项目暂无未提交变更
                </p>
              ) : (
                <div className="space-y-4">
                  {unstagedChanges.length > 0 ? (
                    <GitChangeSection
                      changes={unstagedChanges}
                      label="未暂存"
                      onOpenFileDiff={onOpenFileDiff}
                    />
                  ) : null}
                  {stagedChanges.length > 0 ? (
                    <GitChangeSection
                      changes={stagedChanges}
                      label="已暂存"
                      onOpenFileDiff={onOpenFileDiff}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full space-y-5 overflow-y-auto p-2.5">
            <InspectorSection icon={<HardDrive className="size-3.5" />} title="环境">
              <InspectorRow label="运行位置" value="This Mac" />
              <InspectorRow label="Project" value={projectName} />
              <InspectorRow icon={<GitBranch className="size-3" />} label="分支" value="main" />
            </InspectorSection>
            <InspectorSection icon={<Braces className="size-3.5" />} title="来源">
              <InspectorRow label="设计系统" value="AI Elements" />
              <InspectorRow label="规范" value="Web Design" />
              <button
                className="mt-1 flex h-7 items-center gap-1.5 text-meta text-muted-foreground hover:text-foreground"
                type="button"
              >
                <Plus className="size-3" aria-hidden="true" /> 添加来源
              </button>
            </InspectorSection>
          </div>
        )}
      </div>
    </aside>
  );
}

function GitChangeSection({
  changes,
  label,
  onOpenFileDiff,
}: Readonly<{
  changes: readonly AgentFileChange[];
  label: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
}>) {
  return (
    <section aria-label={label}>
      <div className="mb-1 flex items-center justify-between px-2 text-meta font-medium text-muted-foreground">
        <span>{label}</span>
        <span>{changes.length}</span>
      </div>
      <div className="space-y-0.5">
        {changes.map((change) => {
          const fileName = getFileName(change.path);
          const { additions, removals } = countFileChangeLines(change);
          return (
            <button
              aria-haspopup="dialog"
              aria-label={`打开 ${label}文件 ${fileName} 的 Diff`}
              className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left transition-colors hover:bg-control-hover"
              key={change.path}
              onClick={() => {
                onOpenFileDiff(change);
              }}
              type="button"
            >
              <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={change.path}>
                {fileName}
              </span>
              <span className="text-caption text-diff-added">+{additions}</span>
              <span className="text-caption text-diff-removed">-{removals}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type InspectorSectionProps = Readonly<{
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}>;

function InspectorSection({ children, icon, title }: InspectorSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

type InspectorRowProps = Readonly<{
  icon?: React.ReactNode;
  label: string;
  value: string;
}>;

function InspectorRow({ icon, label, value }: InspectorRowProps) {
  return (
    <div className="flex min-h-7 items-center gap-2 rounded-control px-2 text-meta">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto max-w-32 truncate font-medium text-foreground">{value}</span>
    </div>
  );
}
