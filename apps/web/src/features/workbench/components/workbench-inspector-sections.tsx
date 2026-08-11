import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTurn,
} from "@code-agent/protocol";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleOff,
  CircleX,
  FolderRoot,
  LoaderCircle,
  Paperclip,
  Plug,
  RefreshCw,
  Sparkles,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Task, TaskTrigger } from "../../../shared/components/agent/task.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/components/core/collapsible.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import {
  formatSubagentModel,
  toSubagentTaskStatus,
  type SubagentContextEntry,
  type SubagentSelection,
} from "./subagent.js";

type InspectorSource = Readonly<{
  detail: string;
  id: string;
  kind: "attachment" | "project" | "skill";
  name: string;
}>;
export function collectInspectorSources(
  projectName: string,
  projectPath: string,
  turns: readonly AgentTurn[],
  skills: readonly AgentSkill[],
): InspectorSource[] {
  // 临时 Task 的真实工作区属于内部实现，空路径表示不向上下文来源暴露该 Project。
  const sources: InspectorSource[] =
    projectPath === ""
      ? []
      : [{ detail: projectPath, id: `project:${projectPath}`, kind: "project", name: projectName }];
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
          detail: i18n.t("inspector.attachmentDetail", { ns: "conversation" }),
          id: `attachment:${attachment.id}`,
          kind: "attachment",
          name: attachment.name,
        });
      }
    }
  }
  return sources;
}

export function formatSkillScope(scope: AgentSkill["scope"]) {
  const labels: Readonly<Record<AgentSkill["scope"], string>> = {
    admin: i18n.t("inspector.sourceRole.admin", { ns: "conversation" }),
    repo: i18n.t("inspector.sourceRole.repo", { ns: "conversation" }),
    system: i18n.t("inspector.sourceRole.system", { ns: "conversation" }),
    user: i18n.t("inspector.sourceRole.user", { ns: "conversation" }),
  };
  return labels[scope];
}

export function BackgroundTerminalSection({
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
    <InspectorSection
      icon={<SquareTerminal className="size-3.5" />}
      title={i18n.t("inspector.terminals", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.terminals", { ns: "conversation" })}>
        {isPending && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">
            {i18n.t("inspector.terminalLoading", { ns: "conversation" })}
          </p>
        ) : error !== null && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-diff-removed">
            {i18n.t("inspector.terminalError", { ns: "conversation" })}
          </p>
        ) : (
          <div className="space-y-1">
            {terminals.map((terminal) => {
              const isTerminating = terminatingTerminalId === terminal.id;
              const terminateLabel = isTerminating
                ? i18n.t("inspector.terminalStopping", {
                    command: terminal.command,
                    ns: "conversation",
                  })
                : i18n.t("inspector.terminalStop", {
                    command: terminal.command,
                    ns: "conversation",
                  });
              return (
                <div
                  className="flex items-center gap-1 rounded-control px-2 py-1.5 hover:bg-control-hover"
                  key={terminal.id}
                >
                  <LoaderCircle
                    aria-label={i18n.t("inspector.terminalRunning", { ns: "conversation" })}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={terminateLabel}
                        disabled={terminatingTerminalId !== null}
                        onClick={() => void onTerminate(terminal.id)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Square aria-hidden="true" className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{terminateLabel}</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
        {mutationError === null ? null : (
          <p className="px-2 pt-1 text-caption text-diff-removed" role="alert">
            {i18n.t("inspector.terminalStopRetry", { ns: "conversation" })}
          </p>
        )}
      </section>
    </InspectorSection>
  );
}

export function SubagentSection({
  onOpenSubagent,
  subagents,
}: Readonly<{
  onOpenSubagent: (selection: SubagentSelection) => void;
  subagents: readonly SubagentContextEntry[];
}>) {
  return (
    <InspectorSection
      icon={<Bot className="size-3.5" />}
      title={i18n.t("inspector.subagents", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.subagents", { ns: "conversation" })}>
        <p className="mb-1 px-2 text-caption text-muted-foreground">
          {i18n.t("inspector.subagentCount", {
            count: subagents.length,
            ns: "conversation",
          })}
        </p>
        <div className="space-y-1">
          {subagents.map((subagent) => {
            const metadata = [
              subagent.model === undefined ? undefined : formatSubagentModel(subagent.model),
              subagent.reasoningEffort,
            ].filter((value): value is string => value !== undefined);
            return (
              <Button
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={i18n.t("inspector.subagentOutput", {
                  nickname: subagent.nickname,
                  ns: "conversation",
                })}
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
              </Button>
            );
          })}
        </div>
      </section>
    </InspectorSection>
  );
}

export function McpServerSection({
  canRetry,
  error,
  isPending,
  isRefreshing,
  isRetrying,
  onRetry,
  retryError,
  servers,
}: Readonly<{
  canRetry: boolean;
  error: Error | null;
  isPending: boolean;
  isRefreshing: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  retryError: Error | null;
  servers: readonly AgentMcpServer[];
}>) {
  const reloadLabel = i18n.t(isRetrying ? "inspector.mcpReloading" : "inspector.mcpReload", {
    ns: "conversation",
  });
  const requestError = retryError ?? error;
  const requestErrorTitleKey =
    retryError === null ? "inspector.mcpError" : "inspector.mcpRetryError";
  return (
    <InspectorSection
      action={
        canRetry ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={reloadLabel}
                disabled={isRefreshing || isRetrying}
                onClick={onRetry}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={isRefreshing || isRetrying ? "animate-spin" : undefined}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{reloadLabel}</TooltipContent>
          </Tooltip>
        ) : null
      }
      icon={<Plug className="size-3.5" />}
      title="MCP"
    >
      {isPending && servers.length === 0 ? (
        <p className="flex min-h-9 items-center gap-2 px-2 py-2 text-caption text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          {i18n.t("inspector.mcpLoading", { ns: "conversation" })}
        </p>
      ) : requestError !== null && servers.length === 0 ? (
        <McpRequestErrorState error={requestError} titleKey={requestErrorTitleKey} />
      ) : servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-muted-foreground">
          {i18n.t("inspector.mcpEmpty", { ns: "conversation" })}
        </p>
      ) : (
        <div
          aria-label={i18n.t("inspector.mcpEnabled", { ns: "conversation" })}
          className="space-y-0.5"
        >
          {servers.map((server) => (
            <McpServerRow key={server.name} server={server} />
          ))}
        </div>
      )}
      {retryError === null || servers.length === 0 ? null : (
        <McpRequestErrorState error={retryError} titleKey="inspector.mcpRetryError" />
      )}
    </InspectorSection>
  );
}

function formatMcpErrorMetadata(error: Error): string | null {
  const details: string[] = [];
  if ("code" in error && typeof error.code === "string") {
    details.push(error.code);
  }
  if ("status" in error && typeof error.status === "number") {
    details.push(`HTTP ${String(error.status)}`);
  }
  return details.length === 0 ? null : details.join(" · ");
}

function McpErrorLog({ error }: Readonly<{ error: string }>) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button className="group h-7 justify-start px-0 text-caption" type="button" variant="link">
          <ChevronRight
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-90"
            data-icon="inline-start"
          />
          {i18n.t("inspector.mcpErrorLog", { ns: "conversation" })}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:hidden" forceMount>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-control bg-control px-2 py-1.5 font-mono text-meta leading-5 text-foreground">
          {error}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function McpRequestErrorState({
  error,
  titleKey,
}: Readonly<{ error: Error; titleKey: "inspector.mcpError" | "inspector.mcpRetryError" }>) {
  const metadata = formatMcpErrorMetadata(error);
  return (
    <div className="flex items-start gap-2 px-2 py-1.5" role="alert">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium text-danger">
          {i18n.t(titleKey, { ns: "conversation" })}
        </p>
        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-meta leading-5 text-foreground">
          {error.message}
        </pre>
        {metadata === null ? null : (
          <p className="mt-1 text-meta text-muted-foreground">{metadata}</p>
        )}
      </div>
    </div>
  );
}

function McpServerRow({ server }: Readonly<{ server: AgentMcpServer }>) {
  const metadata = [
    i18n.t(`inspector.mcpStatus.${server.status}`, { ns: "conversation" }),
    ...(server.status === "ready"
      ? [i18n.t("inspector.mcpToolCount", { count: server.toolCount, ns: "conversation" })]
      : []),
    ...(server.authStatus === null
      ? []
      : [i18n.t(`inspector.mcpAuth.${server.authStatus}`, { ns: "conversation" })]),
    ...(server.version === null
      ? []
      : [i18n.t("inspector.mcpVersion", { ns: "conversation", version: server.version })]),
  ];
  const statusIcon =
    server.status === "ready" ? (
      <CheckCircle2 aria-hidden="true" className="size-3.5 text-brand" />
    ) : server.status === "starting" ? (
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />
    ) : server.status === "failed" ? (
      <CircleX aria-hidden="true" className="size-3.5 text-danger" />
    ) : (
      <CircleOff aria-hidden="true" className="size-3.5 text-warning" />
    );

  return (
    <div className="flex min-h-10 items-start gap-2 rounded-control px-2 py-1.5">
      <span className="mt-0.5 shrink-0">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-medium text-foreground" title={server.name}>
          {server.name}
        </p>
        <p className="text-caption text-muted-foreground">{metadata.join(" · ")}</p>
        {server.failureReason === null ? null : (
          <p className="text-caption text-danger">
            {i18n.t(`inspector.mcpFailureReason.${server.failureReason}`, {
              ns: "conversation",
            })}
          </p>
        )}
        {server.error === null ? null : <McpErrorLog error={server.error} />}
      </div>
    </div>
  );
}

type InspectorSectionProps = Readonly<{
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>;

export function InspectorSection({ action, children, icon, title }: InspectorSectionProps) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2 text-xs font-medium text-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

export function InspectorSourceRow({ source }: Readonly<{ source: InspectorSource }>) {
  const icon =
    source.kind === "project" ? (
      <FolderRoot aria-hidden="true" className="size-3.5" />
    ) : source.kind === "skill" ? (
      <Sparkles aria-hidden="true" className="size-3.5 text-brand" />
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
            <span>{i18n.t("inspector.projectDirectory", { ns: "conversation" })}</span>
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
