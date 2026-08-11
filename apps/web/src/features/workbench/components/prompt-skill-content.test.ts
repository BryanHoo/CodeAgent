import type { AgentSkill, ProjectFileSearchEntry } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import {
  appendPromptFileReference,
  createPromptSkillContent,
  insertPromptFileReference,
  insertPromptSkill,
  removePromptFileReference,
  serializePromptSkillContent,
  toPromptSkillSubmission,
} from "./prompt-skill-content.js";

const skill: AgentSkill = {
  description: "审查认证边界",
  displayName: "Security review",
  id: "skill-security",
  name: "review-security",
  scope: "system",
};

const sourceFile: ProjectFileSearchEntry = { name: "main.tsx", path: "src/main.tsx" };
const testFile: ProjectFileSearchEntry = { name: "main.test.tsx", path: "src/main.test.tsx" };

describe("prompt file reference content", () => {
  it("appends a unique file or directory reference after existing draft text", () => {
    const withFile = appendPromptFileReference(createPromptSkillContent("Review this"), sourceFile);
    const withDirectory = appendPromptFileReference(withFile, {
      name: "components",
      path: "src/components",
    });

    expect(serializePromptSkillContent(withDirectory)).toBe(
      "Review this @src/main.tsx @src/components",
    );
    expect(appendPromptFileReference(withDirectory, sourceFile)).toBe(withDirectory);
  });

  it("replaces mention ranges while preserving text and Skill token order", () => {
    const withSkill = insertPromptSkill(
      createPromptSkillContent("/security 请检查 @main 后续"),
      { end: 9, start: 0 },
      skill,
    );
    const withFile = insertPromptFileReference(withSkill, { end: 26, start: 21 }, sourceFile);

    expect(serializePromptSkillContent(withFile)).toBe(
      "$review-security 请检查 @src/main.tsx 后续",
    );
    expect(toPromptSkillSubmission(withFile)).toEqual({
      skills: [skill],
      text: "请检查 @src/main.tsx 后续",
    });
  });

  it("keeps adjacent text outside a submitted file reference", () => {
    const gitignoreFile: ProjectFileSearchEntry = { name: ".gitignore", path: ".gitignore" };

    expect(
      toPromptSkillSubmission([
        { file: gitignoreFile, type: "file" },
        { text: "读取文件", type: "text" },
      ]),
    ).toEqual({
      skills: [],
      text: "@.gitignore 读取文件",
    });
  });

  it("deduplicates selected paths and removes only the requested file token", () => {
    const once = insertPromptFileReference(
      createPromptSkillContent("@main 对比 @main"),
      { end: 5, start: 0 },
      sourceFile,
    );
    const duplicate = insertPromptFileReference(once, { end: 22, start: 17 }, sourceFile);
    const withTest = insertPromptFileReference(duplicate, { end: 17, start: 17 }, testFile);

    expect(serializePromptSkillContent(duplicate)).toBe("@src/main.tsx 对比 ");
    expect(serializePromptSkillContent(removePromptFileReference(withTest, sourceFile.path))).toBe(
      " 对比 @src/main.test.tsx",
    );
  });
});
