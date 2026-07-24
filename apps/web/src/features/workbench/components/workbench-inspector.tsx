import { Braces, CheckCircle2, FileCode2, GitBranch, HardDrive, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import {
  collectSnapshotFileChanges,
  countFileChangeLines,
  getFileName,
  type AgentFileChange,
} from "../../diff/file-change.js";

type WorkbenchInspectorProps = Readonly<{
  onOpenFileDiff: (change: AgentFileChange) => void;
  projectName: string;
  snapshot?: RuntimeTaskSnapshot;
}>;

export function WorkbenchInspector({
  onOpenFileDiff,
  projectName,
  snapshot,
}: WorkbenchInspectorProps) {
  const [tab, setTab] = useState<"changes" | "context">("changes");
  const changeSummary = useMemo(() => {
    const files = collectSnapshotFileChanges(snapshot);
    let additions = 0;
    let removals = 0;
    for (const file of files) {
      const fileStats = countFileChangeLines(file);
      additions += fileStats.additions;
      removals += fileStats.removals;
    }
    return { additions, files, removals };
  }, [snapshot]);

  return (
    <aside
      aria-label="Context Inspector"
      className="workbench-inspector z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-panel shadow-divider-reverse"
    >
      <div className="flex h-toolbar items-center px-3">
        <h2 className="text-body-small font-semibold text-foreground">环境信息</h2>
      </div>

      <div className="px-2.5 py-1.5">
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

      <div className="min-h-0 overflow-y-auto p-2.5" role="tabpanel">
        {tab === "changes" ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-foreground">未提交变更</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {changeSummary.files.length} 个文件
                </p>
              </div>
              <span className="text-meta font-medium">
                <span className="text-diff-added">+{changeSummary.additions}</span>{" "}
                <span className="text-diff-removed">-{changeSummary.removals}</span>
              </span>
            </div>
            <div className="space-y-0.5">
              {changeSummary.files.length === 0 ? (
                <p className="px-2 py-5 text-center text-label text-muted-foreground">
                  当前任务暂无文件变更
                </p>
              ) : (
                changeSummary.files.map((file) => {
                  const fileName = getFileName(file.path);
                  const { additions, removals } = countFileChangeLines(file);
                  return (
                    <button
                      aria-haspopup="dialog"
                      aria-label={`打开 ${fileName} 的 Diff`}
                      className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left transition-colors hover:bg-control-hover"
                      key={file.path}
                      onClick={() => {
                        onOpenFileDiff(file);
                      }}
                      type="button"
                    >
                      <FileCode2
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-foreground"
                        title={file.path}
                      >
                        {fileName}
                      </span>
                      <span className="text-caption text-diff-added">+{additions}</span>
                      <span className="text-caption text-diff-removed">-{removals}</span>
                    </button>
                  );
                })
              )}
            </div>
            <button
              className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-control text-label font-medium text-foreground shadow-sm transition-colors hover:bg-control-hover disabled:opacity-50"
              disabled
              type="button"
            >
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              提交变更
            </button>
          </>
        ) : (
          <div className="space-y-5">
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
