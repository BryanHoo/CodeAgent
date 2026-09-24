import type { AgentSkill, ProjectFileSearchEntry } from "@/protocol/index.js";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PromptSkillEditor, type PromptSkillEditorHandle } from "./prompt-skill-editor.js";
import { toPromptSkillSubmission } from "./prompt-skill-content.js";
import { createRef } from "react";

const skill = { id: "/skills/review/SKILL.md", name: "review", displayName: "Review" } as AgentSkill;
const file = {
  name: "main.ts", path: "src/main.ts", rootId: "root", rootPath: "/project",
} as ProjectFileSearchEntry;

it("用纯文本编辑 skill 和文件引用，并同步提交内容", async () => {
  const ref = createRef<PromptSkillEditorHandle>();
  const onChange = vi.fn();
  const screen = await render(
    <PromptSkillEditor
      content={[{ skill, type: "skill" }, { text: " ", type: "text" }, { file, type: "file" }]}
      onChange={onChange}
      placeholder="输入"
      ref={ref}
      scope="test"
      skills={[skill]}
    />,
  );
  const input = screen.container.querySelector("textarea")!;
  expect(input.value).toBe("$review @/project/src/main.ts");
  expect(screen.container.querySelector("[contenteditable], [data-prompt-skill-id], [data-prompt-file-path]")).toBeNull();

  await screen.getByRole("textbox").fill("@/project/src/main.ts changed");
  expect(toPromptSkillSubmission(ref.current!.getContent())).toEqual({
    skills: [], text: "@/project/src/main.ts changed",
  });
  expect(onChange).toHaveBeenCalled();
});
