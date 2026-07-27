import type { AgentCapabilities, AgentSkill } from "@code-agent/protocol";

export type PromptCommandAction =
  "compact" | "feedback" | "fork" | "initialize" | "review" | "subtask";

export type PromptCommandItem = Readonly<{
  action: PromptCommandAction;
  description: string;
  id: string;
  keywords: readonly string[];
  label: string;
}>;

export const promptCommandItems = [
  {
    action: "review",
    description: "审查未暂存的更改，或与某个分支进行比较",
    id: "review-code",
    keywords: ["review", "code review", "审查", "代码审查"],
    label: "代码审查",
  },
  {
    action: "initialize",
    description: "创建包含 Codex 说明的 AGENTS.md 文件",
    id: "initialize",
    keywords: ["init", "initialize", "初始化", "AGENTS.md"],
    label: "初始化",
  },
  {
    action: "subtask",
    description: "发起临时侧边对话",
    id: "subtask",
    keywords: ["subtask", "subagent", "副任务", "子代理"],
    label: "副任务",
  },
  {
    action: "compact",
    description: "压缩此任务的上下文",
    id: "compact",
    keywords: ["compact", "context", "压缩", "上下文"],
    label: "压缩",
  },
  {
    action: "feedback",
    description: "发送关于此任务的反馈",
    id: "feedback",
    keywords: ["feedback", "反馈"],
    label: "反馈",
  },
  {
    action: "fork",
    description: "在当前工作空间中创建新任务",
    id: "continue-in-new-task",
    keywords: ["fork", "continue", "new task", "继续", "新任务"],
    label: "在新任务中继续",
  },
] as const satisfies readonly PromptCommandItem[];

export function getPromptCommandAvailability(
  item: PromptCommandItem,
  capabilities: AgentCapabilities | undefined,
  hasTask: boolean,
): Readonly<{ available: boolean; reason?: string }> {
  if (capabilities === undefined) {
    return { available: false, reason: "运行时能力尚未就绪" };
  }
  if (item.action !== "initialize" && !hasTask) {
    return { available: false, reason: "需要先打开一个任务" };
  }

  const available =
    item.action === "initialize"
      ? capabilities.turns.start && (hasTask || capabilities.tasks.start)
      : item.action === "subtask"
        ? capabilities.turns.start
        : item.action === "review"
          ? capabilities.turns.review
          : item.action === "compact"
            ? capabilities.turns.compact
            : item.action === "feedback"
              ? capabilities.feedback.upload
              : capabilities.tasks.fork;
  return available ? { available: true } : { available: false, reason: "当前运行时不支持此命令" };
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
