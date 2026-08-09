import type { AgentSkill } from "@code-agent/protocol";

import type { PromptSlashCommand } from "./prompt-command.js";

export type PromptSkillContentPart =
  Readonly<{ text: string; type: "text" }> | Readonly<{ skill: AgentSkill; type: "skill" }>;

export type PromptSkillContent = readonly PromptSkillContentPart[];

export type PromptSkillSubmission = Readonly<{
  skills: readonly AgentSkill[];
  text: string;
}>;

export function createPromptSkillContent(text = ""): PromptSkillContent {
  return text === "" ? [] : [{ text, type: "text" }];
}

export function normalizePromptSkillContent(
  parts: readonly PromptSkillContentPart[],
): PromptSkillContent {
  const normalized: PromptSkillContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text === "") {
        continue;
      }
      const previous = normalized.at(-1);
      if (previous?.type === "text") {
        normalized[normalized.length - 1] = {
          text: previous.text + part.text,
          type: "text",
        };
      } else {
        normalized.push(part);
      }
      continue;
    }
    normalized.push(part);
  }
  return normalized;
}

export function skillPlainText(skill: Pick<AgentSkill, "name">): string {
  return `$${skill.name}`;
}

export function partLength(part: PromptSkillContentPart): number {
  return part.type === "text" ? part.text.length : skillPlainText(part.skill).length;
}

export function splitPromptSkillContent(
  content: PromptSkillContent,
  offset: number,
): readonly [PromptSkillContent, PromptSkillContent] {
  const before: PromptSkillContentPart[] = [];
  const after: PromptSkillContentPart[] = [];
  let position = 0;
  for (const part of content) {
    const length = partLength(part);
    const end = position + length;
    if (offset <= position) {
      after.push(part);
    } else if (offset >= end) {
      before.push(part);
    } else if (part.type === "text") {
      const localOffset = offset - position;
      before.push({ text: part.text.slice(0, localOffset), type: "text" });
      after.push({ text: part.text.slice(localOffset), type: "text" });
    } else {
      // Skill Token 不可编辑，选区落入其纯文本范围时按最接近的边界处理。
      (offset - position < length / 2 ? after : before).push(part);
    }
    position = end;
  }
  return [normalizePromptSkillContent(before), normalizePromptSkillContent(after)];
}

export function insertPromptSkill(
  content: PromptSkillContent,
  slashCommand: Pick<PromptSlashCommand, "end" | "start">,
  skill: AgentSkill,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, slashCommand.start);
  const [, after] = splitPromptSkillContent(content, slashCommand.end);
  const alreadySelected = content.some(
    (part) => part.type === "skill" && part.skill.id === skill.id,
  );
  return normalizePromptSkillContent([
    ...before,
    ...(alreadySelected ? [] : [{ skill, type: "skill" as const }]),
    ...after,
  ]);
}

export function recognizePromptSkillReferences(
  content: PromptSkillContent,
  availableSkills: readonly AgentSkill[],
): PromptSkillContent {
  const skillsByName = new Map(availableSkills.map((skill) => [skill.name, skill]));
  const selectedSkillIds = new Set(
    content.flatMap((part) => (part.type === "skill" ? [part.skill.id] : [])),
  );
  const recognized: PromptSkillContentPart[] = [];
  let changed = false;

  for (const part of content) {
    if (part.type === "skill") {
      recognized.push(part);
      continue;
    }

    let textOffset = 0;
    for (const match of part.text.matchAll(/\$([^\s$]+)/gu)) {
      const referenceStart = match.index;
      const skillName = match[1];
      const precedingCharacter = part.text[referenceStart - 1];
      const skill = skillName === undefined ? undefined : skillsByName.get(skillName);
      if (
        skill === undefined ||
        (precedingCharacter !== undefined && !/\s/u.test(precedingCharacter))
      ) {
        continue;
      }

      const referenceEnd = referenceStart + match[0].length;
      recognized.push({ text: part.text.slice(textOffset, referenceStart), type: "text" });
      if (!selectedSkillIds.has(skill.id)) {
        recognized.push({ skill, type: "skill" });
        selectedSkillIds.add(skill.id);
      }
      textOffset = referenceEnd;
      changed = true;
    }
    recognized.push({ text: part.text.slice(textOffset), type: "text" });
  }

  return changed ? normalizePromptSkillContent(recognized) : content;
}

export function removePromptSlashCommand(
  content: PromptSkillContent,
  slashCommand: Pick<PromptSlashCommand, "end" | "start">,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, slashCommand.start);
  const [, after] = splitPromptSkillContent(content, slashCommand.end);
  return normalizePromptSkillContent([...before, ...after]);
}

export function removePromptSkill(
  content: PromptSkillContent,
  skillId: string,
): PromptSkillContent {
  return normalizePromptSkillContent(
    content.filter((part) => part.type !== "skill" || part.skill.id !== skillId),
  );
}

export function serializePromptSkillContent(content: PromptSkillContent): string {
  return content
    .map((part) => (part.type === "text" ? part.text : skillPlainText(part.skill)))
    .join("");
}

export function toPromptSkillSubmission(content: PromptSkillContent): PromptSkillSubmission {
  const skills: AgentSkill[] = [];
  let text = "";
  for (const part of content) {
    if (part.type === "skill") {
      skills.push(part.skill);
    } else {
      text += part.text;
    }
  }
  return { skills, text: text.trim() };
}

export function isPromptSkillContentEmpty(content: PromptSkillContent): boolean {
  const submission = toPromptSkillSubmission(content);
  return submission.text === "" && submission.skills.length === 0;
}
