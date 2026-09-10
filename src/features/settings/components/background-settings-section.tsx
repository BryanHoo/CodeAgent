import { GlobalSettingsBackground } from "./global-settings-background.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";

export function BackgroundSettingsSection() {
  // 自定义图片读取和壁纸副作用只在用户进入背景分类后启动。
  const draft = useWorkbenchBackgroundDraft();
  return <GlobalSettingsBackground
    activeSection="background"
    customImages={draft.customImages}
    disabled={draft.isLoading || draft.isSavingImages || draft.loadError}
    loadError={draft.loadError}
    onRetry={draft.retryLoad}
    onCustomFilesAdd={draft.addCustomBackgroundFiles}
    onCustomImageRemove={draft.removeCustomBackgroundImage}
    onCustomImageSelect={draft.selectCustomBackgroundImage}
    onPreferenceChange={draft.setBackground}
    preference={draft.background}
  />;
}
