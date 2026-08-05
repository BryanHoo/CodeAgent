import type { AgentModel } from "@code-agent/protocol";
import {
  Bot,
  ChevronDown,
  GitCommitHorizontal,
  Info,
  MonitorCog,
  Network,
  Palette,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputSelect } from "../../../shared/ai-elements/prompt-input.js";
import { Button } from "../../../shared/ui/button.js";

export type SettingsSectionId =
  "about" | "access" | "agent" | "appearance" | "commit" | "integration";

export const settingsSections: readonly Readonly<{
  icon: LucideIcon;
  id: SettingsSectionId;
}>[] = [
  { icon: Palette, id: "appearance" },
  { icon: Bot, id: "agent" },
  { icon: GitCommitHorizontal, id: "commit" },
  { icon: MonitorCog, id: "integration" },
  { icon: Network, id: "access" },
  { icon: Info, id: "about" },
];

export function SettingsPanel({
  activeSection,
  children,
  id,
  title,
}: Readonly<{
  activeSection: SettingsSectionId;
  children: ReactNode;
  id: SettingsSectionId;
  title: string;
}>) {
  return (
    <section hidden={activeSection !== id} id={`settings-panel-${id}`}>
      <h3 className="mb-4 text-heading font-semibold">{title}</h3>
      <div className="divide-y divide-separator">{children}</div>
    </section>
  );
}

export function SettingsField({
  alignStart = false,
  children,
  label,
}: Readonly<{
  alignStart?: boolean;
  children: ReactNode;
  label: string;
}>) {
  return (
    <div
      className={`grid min-h-16 gap-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] ${alignStart ? "items-start" : "items-center"}`}
    >
      <span className={`text-body-small font-medium text-foreground ${alignStart ? "pt-2" : ""}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function ThemeButton({
  ariaLabel,
  icon: Icon,
  label,
  onClick,
  selected,
}: Readonly<{
  ariaLabel: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  selected: boolean;
}>) {
  return (
    <Button
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`inline-flex h-8 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium transition-colors ${selected ? "bg-raised text-foreground shadow-control" : "text-muted-foreground hover:text-foreground"}`}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" className="size-4" />
      <span>{label}</span>
    </Button>
  );
}

export function ModelSelect({
  ariaLabel,
  disabled,
  models,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  models: readonly AgentModel[];
  onChange: (modelId: string) => void;
  value: string;
}>) {
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.displayName}
        </option>
      ))}
    </SettingsSelect>
  );
}

export function ReasoningSelect({
  ariaLabel,
  disabled,
  model,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  model: AgentModel | undefined;
  onChange: (effort: string) => void;
  value: string;
}>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {model?.supportedReasoningEfforts.map((effort) => (
        <option key={effort.id} value={effort.id}>
          {t(`effort.${effort.id}`, { defaultValue: effort.id })}
        </option>
      ))}
    </SettingsSelect>
  );
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <PromptInputSelect
        className="h-9 w-full max-w-none !border !border-separator-strong !bg-control px-2.5 pr-8 text-body-small text-foreground"
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
