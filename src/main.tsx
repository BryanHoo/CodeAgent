import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { initializeRuntimeStore } from "@/stores/runtime-store";
import "@/styles/globals.css";

// 应用级 Channel 必须早于组件挂载初始化，避免 StrictMode 重挂载造成重复订阅。
initializeRuntimeStore();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
