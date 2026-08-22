import type { ProjectRoot } from "@code-agent/protocol";
import { FolderKanban } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";

function rootName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function ProjectRootSelector({
  onChange,
  roots,
  value,
}: Readonly<{
  onChange: (path: string) => void;
  roots: readonly ProjectRoot[];
  value: string;
}>) {
  const { t } = useTranslation("workbench");
  if (roots.length < 2) return null;

  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger
        aria-label={t("shell.selectProjectRoot")}
        className="h-7 min-w-0 max-w-52 gap-1.5 border-0 bg-control px-2 text-caption shadow-none sm:max-w-72"
        title={value}
      >
        <FolderKanban aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>{rootName(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {roots.map((root, index) => (
          <SelectItem key={root.path} textValue={root.path} value={root.path}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{rootName(root.path)}</span>
              <span className="truncate font-mono text-caption text-muted-foreground">
                {index === 0 ? `${t("projectPicker.primaryRoot")} · ` : ""}
                {root.path}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
