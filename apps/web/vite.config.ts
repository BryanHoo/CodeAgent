import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      {
        find: /^shiki$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/ai-elements/shiki-bundle.ts", import.meta.url),
        ),
      },
      {
        find: /^shiki\/wasm$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/ai-elements/shiki-bundle.ts", import.meta.url),
        ),
      },
      {
        find: /^@pierre\/theming\/themes$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/ai-elements/pierre-themes.ts", import.meta.url),
        ),
      },
    ],
  },
  build: {
    emptyOutDir: false,
    outDir: "../../dist/web",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:3210",
    },
    strictPort: true,
  },
});
