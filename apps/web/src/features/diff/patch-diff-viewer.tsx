import { PatchDiff, type PatchDiffProps } from "@pierre/diffs/react";

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
