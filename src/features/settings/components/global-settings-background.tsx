import { useTranslation } from "../../../i18n/i18n.js";
import type {
  CustomBackgroundImage,
  WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";
import { type SettingsSectionId } from "./global-settings-fields.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";

export function GlobalSettingsBackground({
  activeSection,
  customImages,
  disabled,
  loadError,
  onRetry,
  onCustomFilesAdd,
  onCustomImageRemove,
  onCustomImageSelect,
  onPreferenceChange,
  preference,
}: Readonly<{
  activeSection: SettingsSectionId;
  customImages: readonly CustomBackgroundImage[];
  disabled: boolean;
  loadError: boolean;
  onRetry: () => void;
  onCustomFilesAdd: (files: readonly File[]) => void;
  onCustomImageRemove: (imageId: string) => void;
  onCustomImageSelect: (imageId: string) => void;
  onPreferenceChange: (preference: WorkbenchBackgroundPreference) => void;
  preference: WorkbenchBackgroundPreference;
}>) {
  const { t } = useTranslation("settings");
  if (activeSection !== "background") return null;
  return (
    <section id="settings-panel-background">
      <h1 className="mb-6 text-xl font-semibold">{t("sections.background")}</h1>
        <WorkbenchBackgroundSettings
          customImages={customImages}
          disabled={disabled}
          loadError={loadError}
          onRetry={onRetry}
          onCustomFilesAdd={onCustomFilesAdd}
          onCustomImageRemove={onCustomImageRemove}
          onCustomImageSelect={onCustomImageSelect}
          onPreferenceChange={onPreferenceChange}
          preference={preference}
        />
    </section>
  );
}
