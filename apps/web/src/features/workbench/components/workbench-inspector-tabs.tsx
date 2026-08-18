import { Braces, FolderTree, History } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

export type WorkbenchInspectorTab = "changes" | "context" | "history";

export const projectInspectorTabs: readonly WorkbenchInspectorTab[] = ["changes", "history"];
export const taskInspectorTabs: readonly WorkbenchInspectorTab[] = [
  "changes",
  "context",
  "history",
];

const tabIcons = {
  changes: FolderTree,
  context: Braces,
  history: History,
} as const;

export function WorkbenchInspectorTabs({
  activeTab,
  availableTabs,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
      {availableTabs.map((value) => {
        const Icon = tabIcons[value];
        return (
          <Button
            aria-selected={activeTab === value}
            className={`rounded-surface ${
              activeTab === value ? "bg-control-hover text-foreground" : ""
            }`}
            key={value}
            onClick={() => {
              onTabChange(value);
            }}
            role="tab"
            size="compact"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" />
            <span>{i18n.t(`inspector.${value}`, { ns: "conversation" })}</span>
          </Button>
        );
      })}
    </div>
  );
}
