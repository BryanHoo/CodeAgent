import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nextProvider, i18n, synchronizeLanguagePreference } from "./i18n/i18n.js";
import { initializeAppStorage } from "./platform/tauri/app-storage.js";
import "./shared/styles/globals.css";
import "./shared/styles/desktop-pet.css";
import "./shared/styles/workbench.css";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}
const applicationRoot = rootElement;
const windowSurface = new URLSearchParams(window.location.search).get("window");
const appSurface = windowSurface === "desktop-pet" ? windowSurface : "main";
document.documentElement.dataset.appSurface = appSurface;

async function startApplication(): Promise<void> {
  if (appSurface !== "main") {
    const { DesktopPetWindow } = await import(
      "./features/pets/components/desktop-pet-window.js"
    );
    await synchronizeLanguagePreference();
    createRoot(applicationRoot).render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <DesktopPetWindow />
        </I18nextProvider>
      </StrictMode>,
    );
    return;
  }
  const [{ App }, { AppProviders }, { initializeThemePreference }] = await Promise.all([
    import("./App.js"),
    import("./app/providers.js"),
    import("./features/settings/theme-preference.js"),
  ]);
  try {
    // 首次启动会先把旧 WebView 数据迁入应用目录，失败时保留旧数据供下次重试。
    await initializeAppStorage();
  } catch {
    // 存储故障不应阻断工作台启动，本次运行使用默认值。
  }
  initializeThemePreference();
  await synchronizeLanguagePreference();

  // 应用装配集中在唯一入口，避免功能模块直接控制 React 根节点。
  createRoot(applicationRoot).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

void startApplication();
