import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTurn,
} from "@code-agent/protocol";
import {
  Bot,
  FolderRoot,
  LoaderCircle,
  Paperclip,
  Plug,
  Sparkles,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Task, TaskTrigger } from "../../../shared/ai-elements/task.js";
import { Button } from "../../../shared/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
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
  error,
  isPending,
  servers,
}: Readonly<{
  error: Error | null;
  isPending: boolean;
  servers: readonly AgentMcpServer[];
}>) {
  return (
    <InspectorSection icon={<Plug className="size-3.5" />} title="MCP">
      {isPending && servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-muted-foreground">
          {i18n.t("inspector.mcpLoading", { ns: "conversation" })}
        </p>
      ) : error !== null && servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-diff-removed">
          {i18n.t("inspector.mcpError", { ns: "conversation" })}
        </p>
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
            <div
              className="flex min-h-7 items-center rounded-control px-2 text-label font-medium text-foreground"
              key={server.name}
              title={server.name}
            >
              <span className="min-w-0 truncate">{server.name}</span>
            </div>
          ))}
        </div>
      )}
    </InspectorSection>
  );
}

type InspectorSectionProps = Readonly<{
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>;

export function InspectorSection({ children, icon, title }: InspectorSectionProps) {
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

export function InspectorSourceRow({ source }: Readonly<{ source: InspectorSource }>) {
  const icon =
    source.kind === "project" ? (
      <FolderRoot aria-hidden="true" className="size-3.5" />
    ) : source.kind === "skill" ? (
      <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
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
