import type {
  AgentBackgroundTerminal,
  AgentSkill,
  AgentTaskSettings,
  AgentTurn,
  ProjectGitStatus,
} from "@code-agent/protocol";
import {
  Bot,
  FileCode2,
  FolderRoot,
  HardDrive,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { countFileChangeLines, getFileName, type AgentFileChange } from "../../diff/file-change.js";
import { Task, TaskTrigger } from "../../../shared/ai-elements/task.js";
import { IconButton } from "../../../shared/ui/icon-button.js";
import {
  formatSubagentModel,
  toSubagentTaskStatus,
  type SubagentContextEntry,
  type SubagentSelection,
} from "./subagent.js";

type WorkbenchInspectorProps = Readonly<{
  backgroundTerminals?: readonly AgentBackgroundTerminal[];
  backgroundTerminalsError?: Error | null;
  backgroundTerminalsPending?: boolean;
  onOpenFileDiff: (change: AgentFileChange) => void;
  gitStatus?: ProjectGitStatus;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onRefreshGitStatus?: () => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  projectName: string;
  projectPath: string;
  settings: AgentTaskSettings;
  skills?: readonly AgentSkill[];
  subagents?: readonly SubagentContextEntry[];
  task?: Readonly<{ turns: readonly AgentTurn[] }>;
  terminalMutationError?: Error | null;
  terminatingTerminalId?: string | null;
}>;

type InspectorSource = Readonly<{
  detail: string;
  id: string;
  kind: "attachment" | "project" | "skill";
  name: string;
}>;

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  high: "高",
  low: "低",
  max: "最大",
  medium: "中",
  minimal: "最低",
  none: "无",
  xhigh: "较高",
};

const sandboxModeLabels: Readonly<Record<AgentTaskSettings["sandboxMode"], string>> = {
  "danger-full-access": "完全访问",
  "read-only": "只读",
  "workspace-write": "工作区可写",
};

function formatApprovalMode(settings: AgentTaskSettings) {
  if (settings.approvalsReviewer === "auto_review") {
    return "自动审批";
  }
  const labels: Readonly<Record<AgentTaskSettings["approvalPolicy"], string>> = {
    never: "从不询问",
    "on-request": "按需审批",
    untrusted: "仅不受信任操作",
  };
  return labels[settings.approvalPolicy];
}

function collectInspectorSources(
  projectName: string,
  projectPath: string,
  turns: readonly AgentTurn[],
  skills: readonly AgentSkill[],
): InspectorSource[] {
  const sources: InspectorSource[] = [
    { detail: projectPath, id: `project:${projectPath}`, kind: "project", name: projectName },
  ];
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const seenSkills = new Set<string>();
  const seenAttachments = new Set<string>();

  // 同一来源可能在多个 Turn 中重复出现，Inspector 只保留首次使用位置的稳定条目。
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "message" || item.role !== "user") {
        continue;
      }
      for (const skillReference of item.skills ?? []) {
        if (seenSkills.has(skillReference.name)) {
          continue;
        }
        seenSkills.add(skillReference.name);
        const skill = skillsByName.get(skillReference.name);
        sources.push({
          detail: skill === undefined ? "Skill" : `Skill · ${formatSkillScope(skill.scope)}`,
          id: `skill:${skillReference.name}`,
          kind: "skill",
          name: skill?.displayName ?? skillReference.name,
        });
      }
      for (const attachment of item.attachments ?? []) {
        if (seenAttachments.has(attachment.id)) {
          continue;
        }
        seenAttachments.add(attachment.id);
        sources.push({
          detail: "图片附件",
          id: `attachment:${attachment.id}`,
          kind: "attachment",
          name: attachment.name,
        });
      }
    }
  }
  return sources;
}

function formatSkillScope(scope: AgentSkill["scope"]) {
  const labels: Readonly<Record<AgentSkill["scope"], string>> = {
    admin: "管理员",
    repo: "项目",
    system: "系统",
    user: "用户",
  };
  return labels[scope];
}

export function WorkbenchInspector({
  backgroundTerminals = [],
  backgroundTerminalsError = null,
  backgroundTerminalsPending = false,
  gitStatus,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
  onOpenFileDiff,
  onOpenSubagent = () => undefined,
  onRefreshGitStatus = () => undefined,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  projectName,
  projectPath,
  settings,
  skills = [],
  subagents = [],
  task,
  terminalMutationError = null,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  const [tab, setTab] = useState<"changes" | "context">(() =>
    subagents.length > 0 || backgroundTerminals.length > 0 ? "context" : "changes",
  );
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
  const sources = useMemo(
    () => collectInspectorSources(projectName, projectPath, task?.turns ?? [], skills),
    [projectName, projectPath, skills, task?.turns],
  );
  const branch =
    gitStatus?.branch ??
    (gitStatusPending ? "正在读取" : gitStatusError === null ? "未检出分支" : "不可用");

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
                <div className="flex flex-col items-center px-2 py-5 text-center">
                  <p className="text-label text-diff-removed">Git 变更自动检测已停止</p>
                  <p className="mt-1 text-caption text-muted-foreground">
                    当前目录可能不是 Git 仓库，或检测连续失败
                  </p>
                  <button
                    aria-label="手动刷新 Git 变更"
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-control bg-control px-3 text-label font-medium text-foreground transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={gitStatusRefreshing}
                    onClick={onRefreshGitStatus}
                    type="button"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`size-3.5 ${gitStatusRefreshing ? "animate-spin" : ""}`}
                    />
                    {gitStatusRefreshing ? "正在刷新" : "手动刷新"}
                  </button>
                </div>
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
            {backgroundTerminals.length > 0 ||
            backgroundTerminalsPending ||
            backgroundTerminalsError !== null ? (
              <BackgroundTerminalSection
                error={backgroundTerminalsError}
                isPending={backgroundTerminalsPending}
                mutationError={terminalMutationError}
                onTerminate={onTerminateBackgroundTerminal}
                terminals={backgroundTerminals}
                terminatingTerminalId={terminatingTerminalId}
              />
            ) : null}
            {subagents.length > 0 ? (
              <SubagentSection onOpenSubagent={onOpenSubagent} subagents={subagents} />
            ) : null}
            <InspectorSection icon={<HardDrive className="size-3.5" />} title="环境">
              <InspectorRow label="模型" value={settings.model} />
              <InspectorRow
                label="思考量"
                value={reasoningEffortLabels[settings.reasoningEffort] ?? settings.reasoningEffort}
              />
              <InspectorRow label="审批" value={formatApprovalMode(settings)} />
              <InspectorRow label="沙盒" value={sandboxModeLabels[settings.sandboxMode]} />
              <InspectorRow label="工作目录" value={projectPath} />
              <InspectorRow label="分支" value={branch} />
            </InspectorSection>
            <InspectorSection icon={<FolderRoot className="size-3.5" />} title="来源">
              <div aria-label="上下文来源" className="space-y-0.5">
                {sources.map((source) => (
                  <InspectorSourceRow key={source.id} source={source} />
                ))}
              </div>
            </InspectorSection>
          </div>
        )}
      </div>
    </aside>
  );
}

function BackgroundTerminalSection({
  error,
  isPending,
  mutationError,
  onTerminate,
  terminals,
  terminatingTerminalId,
}: Readonly<{
  error: Error | null;
  isPending: boolean;
  mutationError: Error | null;
  onTerminate: (terminalId: string) => Promise<void>;
  terminals: readonly AgentBackgroundTerminal[];
  terminatingTerminalId: string | null;
}>) {
  return (
    <InspectorSection icon={<SquareTerminal className="size-3.5" />} title="运行中的终端">
      <section aria-label="运行中的终端">
        {isPending && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">正在读取终端...</p>
        ) : error !== null && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-diff-removed">无法读取运行中的终端</p>
        ) : (
          <div className="space-y-1">
            {terminals.map((terminal) => {
              const isTerminating = terminatingTerminalId === terminal.id;
              return (
                <div
                  className="flex items-center gap-1 rounded-control px-2 py-1.5 hover:bg-control-hover"
                  key={terminal.id}
                >
                  <LoaderCircle
                    aria-label="终端运行中"
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-label font-medium text-foreground"
                      title={terminal.command}
                    >
                      {terminal.command}
                    </p>
                    <p className="truncate text-caption text-muted-foreground" title={terminal.cwd}>
                      {terminal.cwd}
                    </p>
                  </div>
                  <IconButton
                    disabled={terminatingTerminalId !== null}
                    label={
                      isTerminating
                        ? `正在停止 ${terminal.command}`
                        : `停止终端 ${terminal.command}`
                    }
                    onClick={() => void onTerminate(terminal.id)}
                    size="small"
                  >
                    <Square aria-hidden="true" className="size-3" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
        {mutationError === null ? null : (
          <p className="px-2 pt-1 text-caption text-diff-removed" role="alert">
            停止终端失败，请重试
          </p>
        )}
      </section>
    </InspectorSection>
  );
}

function SubagentSection({
  onOpenSubagent,
  subagents,
}: Readonly<{
  onOpenSubagent: (selection: SubagentSelection) => void;
  subagents: readonly SubagentContextEntry[];
}>) {
  return (
    <InspectorSection icon={<Bot className="size-3.5" />} title="子代理">
      <section aria-label="子代理">
        <p className="mb-1 px-2 text-caption text-muted-foreground">{subagents.length} 个子代理</p>
        <div className="space-y-1">
          {subagents.map((subagent) => {
            const metadata = [
              subagent.model === undefined ? undefined : formatSubagentModel(subagent.model),
              subagent.reasoningEffort,
            ].filter((value): value is string => value !== undefined);
            return (
              <button
                aria-haspopup="dialog"
                aria-label={`查看子代理 ${subagent.nickname} 的输出`}
                className="w-full rounded-control px-2 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none"
                key={subagent.taskId}
                onClick={() => {
                  onOpenSubagent({ status: subagent.status, taskId: subagent.taskId });
                }}
                type="button"
              >
                <Task collapsible={false} status={toSubagentTaskStatus(subagent.status)}>
                  <TaskTrigger title={subagent.nickname} />
                </Task>
                {metadata.length === 0 ? null : (
                  <p className="pb-2 text-caption text-muted-foreground">{metadata.join(" · ")}</p>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </InspectorSection>
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
    <section aria-label={title}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

type InspectorRowProps = Readonly<{
  label: string;
  value: string;
}>;

function InspectorRow({ label, value }: InspectorRowProps) {
  return (
    <div className="flex min-h-7 items-center gap-2 rounded-control px-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span
        className="ml-auto min-w-0 truncate text-right font-medium text-foreground"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function InspectorSourceRow({ source }: Readonly<{ source: InspectorSource }>) {
  const icon =
    source.kind === "project" ? (
      <FolderRoot aria-hidden="true" className="size-3.5" />
    ) : source.kind === "skill" ? (
      <Sparkles aria-hidden="true" className="size-3.5 text-skill" />
    ) : (
      <Paperclip aria-hidden="true" className="size-3.5" />
    );
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-control px-2 py-1.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-label font-medium text-foreground" title={source.name}>
          {source.name}
        </p>
        {source.kind === "project" ? (
          <p className="truncate text-caption text-muted-foreground" title={source.detail}>
            <span>项目目录</span>
            <span aria-hidden="true"> · </span>
            <span>{source.detail}</span>
          </p>
        ) : (
          <p className="truncate text-caption text-muted-foreground">{source.detail}</p>
        )}
      </div>
    </div>
  );
}
