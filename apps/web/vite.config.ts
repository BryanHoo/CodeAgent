import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

// 最低版本同时覆盖 AbortSignal.any()、AbortSignal.timeout()、toSorted() 与 toSpliced()。
export const supportedBrowserTargets = ["chrome116", "firefox124", "safari17.4"] as const;

export type CodeAgentBuildTarget = "desktop" | "web";

export function resolveBuildTarget(mode: string): CodeAgentBuildTarget {
  if (mode === "desktop" || mode === "web") return mode;
  throw new Error(`Unsupported CODE_AGENT_TARGET mode: ${mode}`);
}

export function createViteConfig(target: CodeAgentBuildTarget): UserConfig {
  const hostTransport =
    target === "web"
      ? "../../packages/transport-http/src/index.ts"
      : "../../packages/transport-tauri/src/index.ts";
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
        {
          find: "@code-agent/host-transport",
          replacement: fileURLToPath(new URL(hostTransport, import.meta.url)),
        },
        {
          find: /^shiki$/u,
          replacement: fileURLToPath(
            new URL("./src/shared/components/agent/shiki-bundle.ts", import.meta.url),
          ),
        },
        {
          find: /^shiki\/wasm$/u,
          replacement: fileURLToPath(
            new URL("./src/shared/components/agent/shiki-bundle.ts", import.meta.url),
          ),
        },
        {
          find: /^@pierre\/theming\/themes$/u,
          replacement: fileURLToPath(
            new URL("./src/shared/components/agent/pierre-themes.ts", import.meta.url),
          ),
        },
      ],
    },
    build: {
      // 每种宿主只清理自己的目录，连续构建时保留另一目标产物。
      emptyOutDir: true,
      manifest: true,
      outDir: `../../dist/${target}`,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // 宏与专用支持 Grammar 同组，避免它们回指主 C++ Chunk；共享 SQL 继续独立复用。
                includeDependenciesRecursively: false,
                name: "grammar-cpp-support",
                test: /@shikijs[\\/]langs[\\/]dist[\\/](?:cpp-macro|regexp|glsl)\.mjs$/u,
              },
              {
                // React、React DOM 与 Scheduler 组成自包含运行时，避免只拆单包造成依赖回指。
                includeDependenciesRecursively: false,
                name: "react-runtime",
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
              },
            ],
          },
        },
      },
      sourcemap: false,
      target: [...supportedBrowserTargets],
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      ...(target === "web" ? { proxy: { "/v1": "http://127.0.0.1:3210" } } : {}),
      strictPort: true,
    },
  };
}

export default defineConfig(({ mode }) => createViteConfig(resolveBuildTarget(mode)));
