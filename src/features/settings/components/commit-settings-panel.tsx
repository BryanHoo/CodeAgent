import type { AgentGlobalSettings, AgentModel } from "@/protocol/index.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { ModelSelect, SettingsField, SettingsPanel } from "./global-settings-fields.js";

export function CommitSettingsPanel({ settings, models, onChange, onFlush }: Readonly<{
  settings: AgentGlobalSettings;
  models: readonly AgentModel[];
  onChange: (update: (current: AgentGlobalSettings) => AgentGlobalSettings, debounce?: boolean) => void;
  onFlush: () => void;
}>) {
  const { t } = useTranslation("settings");
  return <SettingsPanel activeSection="commit" id="commit" title={t("sections.commit")}>
    <SettingsField label={t("fields.model")}>
      <ModelSelect ariaLabel={t("fields.commitModel")} models={models}
        onChange={(modelId) => onChange((current) => ({ ...current, commitMessageModel: modelId }))}
        value={settings.commitMessageModel} />
    </SettingsField>
    <SettingsField alignStart label={t("fields.prompt")}>
      <textarea aria-label={t("fields.commitMessagePrompt")}
        className="h-28 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus disabled:opacity-50"
        maxLength={4_000} onBlur={onFlush} onChange={(event) => {
          const commitMessagePrompt = event.currentTarget.value;
          onChange((current) => ({ ...current, commitMessagePrompt }), true);
        }} value={settings.commitMessagePrompt} />
    </SettingsField>
  </SettingsPanel>;
}
