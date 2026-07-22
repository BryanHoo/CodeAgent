import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}

// 应用装配集中在唯一入口，避免功能模块直接控制 React 根节点。
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
