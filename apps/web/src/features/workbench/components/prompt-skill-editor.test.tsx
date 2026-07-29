import { describe, expect, it } from "vitest";

import type { AgentSkill } from "@code-agent/protocol";

import {
  createPromptSkillContent,
  insertPromptSkill,
  removePromptSkill,
  serializePromptSkillContent,
  toPromptSkillSubmission,
} from "./prompt-skill-editor.js";

const securitySkill: AgentSkill = {
  description: "审查认证边界",
  displayName: "Security review",
  id: "skill-security",
  name: "review-security",
  scope: "system",
};

const documentationSkill: AgentSkill = {
  description: "编写项目文档",
  displayName: "Documentation writer",
  id: "skill-docs",
  name: "documentation-writer",
  scope: "user",
};

describe("prompt skill editor model", () => {
  it("inserts multiple skills at slash ranges while preserving inline order", () => {
    const initial = createPromptSkillContent("/security 之后 /docs");
    const withSecurity = insertPromptSkill(initial, { end: 9, start: 0 }, securitySkill);
    const withBoth = insertPromptSkill(withSecurity, { end: 25, start: 20 }, documentationSkill);

    expect(serializePromptSkillContent(withBoth)).toBe(
      "$review-security 之后 $documentation-writer",
    );
    expect(toPromptSkillSubmission(withBoth)).toEqual({
      skills: [securitySkill, documentationSkill],
      text: "之后",
    });
  });

  it("deduplicates the same skill and removes only the selected token", () => {
    const initial = createPromptSkillContent("/security 说明 /security");
    const once = insertPromptSkill(initial, { end: 9, start: 0 }, securitySkill);
    const duplicate = insertPromptSkill(once, { end: 29, start: 20 }, securitySkill);
    const withDocumentation = insertPromptSkill(
      duplicate,
      { end: 20, start: 20 },
      documentationSkill,
    );

    expect(serializePromptSkillContent(duplicate)).toBe("$review-security 说明 ");
    expect(
      serializePromptSkillContent(removePromptSkill(withDocumentation, securitySkill.id)),
    ).toBe(" 说明 $documentation-writer");
  });
});
