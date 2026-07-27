import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractCodexTextSkills, readCodexTranscriptTurnSkills } from "./codex-transcript.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Codex transcript Skills", () => {
  it("extracts native linked and expanded Skill text", () => {
    expect(
      extractCodexTextSkills(
        "[$superwork:superwork-start](/Users/test/skills/superwork-start/SKILL.md) 阅读项目",
      ),
    ).toEqual({
      skills: [{ name: "superwork:superwork-start" }],
      text: "阅读项目",
    });
    expect(
      extractCodexTextSkills(
        [
          "<skill>",
          "<name>superwork:superwork-start</name>",
          "<path>/Users/test/skills/superwork-start/SKILL.md</path>",
          "Skill instructions",
          "</skill>",
        ].join("\n"),
      ),
    ).toEqual({
      skills: [{ name: "superwork:superwork-start" }],
      text: "",
    });
  });

  it("restores Skills filtered from thread/read using the Codex rollout transcript", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "code-agent-codex-home-"));
    temporaryDirectories.push(codexHome);
    const sessionDirectory = join(codexHome, "sessions", "2026", "07", "27");
    await mkdir(sessionDirectory, { recursive: true });
    const threadId = "019fa2cd-e2fa-7fb3-8ecd-c7d56cd26383";
    const transcriptPath = join(sessionDirectory, `rollout-2026-07-27T17-00-29-${threadId}.jsonl`);
    const transcriptEntry = {
      payload: {
        content: [
          {
            text: [
              "<skill>",
              "<name>superwork:superwork-start</name>",
              "<path>/Users/test/skills/superwork-start/SKILL.md</path>",
              "Skill instructions",
              "</skill>",
            ].join("\n"),
            type: "input_text",
          },
        ],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
        role: "user",
        type: "message",
      },
      type: "response_item",
    };
    await writeFile(transcriptPath, `${JSON.stringify(transcriptEntry)}\n`, "utf8");

    const skillsByTurnId = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(skillsByTurnId.get("turn-1")).toEqual(["superwork:superwork-start"]);
  });
});
