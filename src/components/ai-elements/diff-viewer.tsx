import { PatchDiff, type PatchDiffProps } from "@pierre/diffs/react";

const options = {
  diffIndicators: "bars",
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  overflow: "scroll",
  theme: { dark: "github-dark", light: "github-light" },
  themeType: "system",
  unsafeCSS: "pre { font-family: var(--ui-font-family-mono); font-size: var(--ui-font-size-caption); }",
} satisfies NonNullable<PatchDiffProps<undefined>["options"]>;

export function DiffViewer({ patch }: Readonly<{ patch: string }>) {
  return <PatchDiff className="ai-diff-viewer" disableWorkerPool options={options} patch={patch} />;
}
