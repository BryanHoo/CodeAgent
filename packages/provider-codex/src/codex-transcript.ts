import { createReadStream } from "node:fs";
import { glob } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const EXPANDED_SKILL_PATTERN =
  /^<skill>\s*<name>(?<name>[^<]+)<\/name>\s*<path>(?<path>[^<]+)<\/path>[\s\S]*<\/skill>\s*$/u;
const LINKED_SKILL_PATTERN = /\[\$(?<name>[^\]\s]+)\]\((?<path>[^)]+\/SKILL\.md)\)/gu;
const SAFE_THREAD_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractCodexTextSkills(value: string): Readonly<{
  skills: { name: string }[];
  text: string;
}> {
  const expandedSkill = EXPANDED_SKILL_PATTERN.exec(value);
  const expandedSkillName = expandedSkill?.groups?.["name"];
  const expandedSkillPath = expandedSkill?.groups?.["path"];
  if (expandedSkillName !== undefined && expandedSkillPath !== undefined) {
    // Codex 会把 Skill 展开为独立文本项；路径仅用于确认格式，不进入公开消息。
    return { skills: [{ name: expandedSkillName.trim() }], text: "" };
  }

  const skills: { name: string }[] = [];
  const text = value.replace(LINKED_SKILL_PATTERN, (...arguments_: unknown[]) => {
    const groups = arguments_.at(-1);
    if (isRecord(groups) && typeof groups["name"] === "string") {
      skills.push({ name: groups["name"] });
    }
    return "";
  });
  return { skills, text: text.trimStart() };
}

function collectTranscriptLineSkills(
  line: string,
  skillNamesByTurnId: Map<string, Set<string>>,
): void {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(entry) || entry["type"] !== "response_item") {
    return;
  }
  const payload = entry["payload"];
  if (!isRecord(payload) || payload["type"] !== "message" || payload["role"] !== "user") {
    return;
  }
  const metadata = payload["internal_chat_message_metadata_passthrough"];
  const turnId = isRecord(metadata) ? metadata["turn_id"] : undefined;
  if (typeof turnId !== "string" || !Array.isArray(payload["content"])) {
    return;
  }

  for (const contentPart of payload["content"]) {
    if (!isRecord(contentPart) || typeof contentPart["text"] !== "string") {
      continue;
    }
    const extracted = extractCodexTextSkills(contentPart["text"]);
    for (const skill of extracted.skills) {
      const skillNames = skillNamesByTurnId.get(turnId) ?? new Set<string>();
      skillNames.add(skill.name);
      skillNamesByTurnId.set(turnId, skillNames);
    }
  }
}

export async function readCodexTranscriptTurnSkills(
  threadId: string,
  codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex"),
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (!SAFE_THREAD_ID_PATTERN.test(threadId)) {
    return new Map();
  }

  const skillNamesByTurnId = new Map<string, Set<string>>();
  const transcriptPattern = join(codexHome, "sessions", "**", `rollout-*-${threadId}.jsonl`);

  try {
    for await (const transcriptPath of glob(transcriptPattern)) {
      const transcriptLines = createInterface({
        crlfDelay: Number.POSITIVE_INFINITY,
        input: createReadStream(transcriptPath, { encoding: "utf8" }),
      });
      for await (const line of transcriptLines) {
        // App Server 会过滤内部 Skill 消息，只在 Codex transcript 中恢复其名称。
        collectTranscriptLineSkills(line, skillNamesByTurnId);
      }
    }
  } catch {
    return new Map();
  }

  return new Map([...skillNamesByTurnId].map(([turnId, skillNames]) => [turnId, [...skillNames]]));
}
