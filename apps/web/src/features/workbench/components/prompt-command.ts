import type { AgentCapabilities, AgentSkill } from "@code-agent/protocol";

import { i18n } from "../../../i18n/i18n.js";

export type PromptCommandAction = "compact" | "fork" | "initialize" | "review";

export type PromptCommandItem = Readonly<{
  action: PromptCommandAction;
  description: string;
  id: string;
  keywords: readonly string[];
  label: string;
}>;

export function getPromptCommandItems(): readonly PromptCommandItem[] {
  const translate = (key: string) => i18n.t(key, { ns: "workbench" });
  return [
    {
      action: "review",
      description: translate("promptCommand.review.description"),
      id: "review-code",
      keywords: ["review", "code review", "审查", "代码审查"],
      label: translate("promptCommand.review.label"),
    },
    {
      action: "initialize",
      description: translate("promptCommand.initialize.description"),
      id: "initialize",
      keywords: ["init", "initialize", "初始化", "AGENTS.md"],
      label: translate("promptCommand.initialize.label"),
    },
    {
      action: "compact",
      description: translate("promptCommand.compact.description"),
      id: "compact",
      keywords: ["compact", "context", "压缩", "上下文"],
      label: translate("promptCommand.compact.label"),
    },
    {
      action: "fork",
      description: translate("promptCommand.fork.description"),
      id: "copy-task",
      keywords: ["fork", "copy", "复制", "任务"],
      label: translate("promptCommand.fork.label"),
    },
  ];
}

export function getPromptCommandAvailability(
  item: PromptCommandItem,
  capabilities: AgentCapabilities | undefined,
  hasTask: boolean,
): Readonly<{ available: boolean; reason?: string }> {
  if (capabilities === undefined) {
    return {
      available: false,
      reason: i18n.t("promptCommand.availability.notReady", { ns: "workbench" }),
    };
  }
  if (item.action !== "initialize" && item.action !== "review" && !hasTask) {
    return {
      available: false,
      reason: i18n.t("promptCommand.availability.noTask", { ns: "workbench" }),
    };
  }

  const available =
    item.action === "initialize"
      ? capabilities.turns.start && (hasTask || capabilities.tasks.start)
      : item.action === "review"
        ? capabilities.turns.review && (hasTask || capabilities.tasks.start)
        : item.action === "compact"
          ? capabilities.turns.compact
          : capabilities.tasks.fork;
  return available
    ? { available: true }
    : {
        available: false,
        reason: i18n.t("promptCommand.availability.unsupported", { ns: "workbench" }),
      };
}

export type PromptSlashCommand = Readonly<{
  end: number;
  query: string;
  start: number;
}>;

export function resolvePromptSlashCommand(
  draft: string,
  cursorPosition: number,
): PromptSlashCommand | null {
  if (cursorPosition < 0 || cursorPosition > draft.length) {
    return null;
  }

  const draftBeforeCursor = draft.slice(0, cursorPosition);
  const commandStart = draftBeforeCursor.lastIndexOf("/");
  if (commandStart < 0) {
    return null;
  }

  const precedingCharacter = draftBeforeCursor[commandStart - 1];
  const query = draftBeforeCursor.slice(commandStart + 1);
  if ((precedingCharacter !== undefined && !/\s/u.test(precedingCharacter)) || /\s/u.test(query)) {
    return null;
  }

  return {
    end: cursorPosition,
    query,
    start: commandStart,
  };
}

export function filterPromptCommandItems<TItem extends PromptCommandItem>(
  items: readonly TItem[],
  query: string,
): readonly TItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return items;
  }

  return items.filter((item) =>
    [item.label, ...item.keywords].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}

export function filterPromptSkills<TSkill extends AgentSkill>(
  skills: readonly TSkill[],
  query: string,
): readonly TSkill[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return skills;
  }

  return skills.filter((skill) =>
    [skill.displayName, skill.name, skill.description].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}

export function movePromptCommandSelection(
  currentIndex: number,
  direction: -1 | 1,
  itemCount: number,
): number {
  if (itemCount === 0) {
    return 0;
  }
  return (currentIndex + direction + itemCount) % itemCount;
}
