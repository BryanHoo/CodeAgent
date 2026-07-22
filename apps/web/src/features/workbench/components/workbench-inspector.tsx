import {
  Braces,
  CheckCircle2,
  FileCode2,
  GitBranch,
  HardDrive,
  PanelRightClose,
  Plus,
} from "lucide-react";
import { useState } from "react";

import { IconButton } from "../../../shared/ui/icon-button.js";

const changedFiles = [
  { name: "workbench-shell.tsx", additions: 84, deletions: 18 },
  { name: "thread-timeline.tsx", additions: 126, deletions: 0 },
  { name: "globals.css", additions: 42, deletions: 9 },
];

type WorkbenchInspectorProps = Readonly<{
  onClose: () => void;
  workspaceId: string;
}>;

export function WorkbenchInspector({ onClose, workspaceId }: WorkbenchInspectorProps) {
  const [tab, setTab] = useState<"changes" | "context">("changes");

  return (
    <aside
      aria-label="Context Inspector"
      className="workbench-inspector z-30 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-panel shadow-divider-reverse backdrop-blur-panel"
    >
      <div className="flex h-toolbar items-center justify-between px-3 shadow-toolbar">
        <span className="text-body-small font-semibold text-foreground">工作区</span>
        <IconButton label="关闭上下文面板" onClick={onClose} size="small">
          <PanelRightClose className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="px-3 py-2">
        <div className="grid grid-cols-2 rounded-control bg-control p-0.5" role="tablist">
          {(["changes", "context"] as const).map((value) => (
            <button
              aria-selected={tab === value}
              className={`h-7 rounded-control text-label font-medium transition-colors ${
                tab === value
                  ? "bg-raised text-foreground shadow-sm"
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

      <div className="min-h-0 overflow-y-auto p-3" role="tabpanel">
        {tab === "changes" ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-foreground">未提交变更</p>
                <p className="mt-0.5 text-caption text-muted-foreground">3 个文件</p>
              </div>
              <span className="text-meta font-medium">
                <span className="text-accent-strong">+252</span>{" "}
                <span className="text-danger">-27</span>
              </span>
            </div>
            <div className="space-y-0.5">
              {changedFiles.map((file) => (
                <button
                  className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left transition-colors hover:bg-control-hover"
                  key={file.name}
                  type="button"
                >
                  <FileCode2
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {file.name}
                  </span>
                  <span className="text-caption text-accent-strong">+{file.additions}</span>
                  <span className="text-caption text-danger">-{file.deletions}</span>
                </button>
              ))}
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
              <InspectorRow label="Workspace" value={workspaceId} />
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
