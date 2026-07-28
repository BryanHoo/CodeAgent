import { setCustomExtension } from "@pierre/diffs";
import { PatchDiff, type PatchDiffProps } from "@pierre/diffs/react";

import {
  projectLanguageByExtension,
  projectLanguageByFileName,
} from "../../shared/ai-elements/code-languages.js";
import type { AgentFileChange } from "./file-change.js";
import { normalizeFileChangePatch } from "./file-change.js";

const diffOptions = {
  diffIndicators: "bars",
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  overflow: "scroll",
  theme: { dark: "github-dark", light: "github-light" },
  themeType: "system",
  unsafeCSS: `
    pre { font-family: var(--ui-font-family-mono); font-size: var(--ui-font-size-body-small); }
  `,
} satisfies NonNullable<PatchDiffProps<undefined>["options"]>;

for (const [extension, language] of Object.entries(projectLanguageByExtension)) {
  setCustomExtension(extension, language);
}
for (const [fileName, language] of Object.entries(projectLanguageByFileName)) {
  setCustomExtension(fileName, language);
}
setCustomExtension("Dockerfile", "dockerfile");
setCustomExtension("Makefile", "makefile");

export default function PatchDiffViewer({ change }: Readonly<{ change: AgentFileChange }>) {
  return (
    <PatchDiff
      className="file-diff-renderer"
      disableWorkerPool
      options={diffOptions}
      patch={normalizeFileChangePatch(change)}
    />
  );
}
