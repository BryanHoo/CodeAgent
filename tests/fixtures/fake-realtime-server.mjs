import { fileURLToPath } from "node:url";

import {
  createCodexRuntimeProvider,
  startCodexAppServer,
} from "../../dist/providers/codex/index.js";
import { createCodeAgentServer } from "../../dist/server/index.js";

const projectRoot = "/workspace/CodeAgent";
const fakeAppServerPath = fileURLToPath(
  new URL("../../packages/provider-codex/test/fixtures/fake-app-server.mjs", import.meta.url),
);
const staticRoot = fileURLToPath(new URL("../../dist/web", import.meta.url));

const runtime = await startCodexAppServer({
  binaryPath: fakeAppServerPath,
  env: { ...process.env, FAKE_APP_SERVER_SCENARIO: "realtime-actions" },
  rpcTimeoutMs: 1_000,
  shutdownTimeoutMs: 500,
});
const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  rootPath: projectRoot,
};
const provider = createCodexRuntimeProvider({ client: runtime.client });
let globalSettings;
const projectDefaults = new Map();
const pinnedTaskIds = new Map();
const taskSettings = new Map();
const server = await createCodeAgentServer({
  eventSessionId: "e2e-session",
  projectRepository: {
    list: () => Promise.resolve([project]),
    read: (projectId) => Promise.resolve(projectId === project.id ? project : undefined),
    register: () => Promise.resolve(project),
    reorder: () => Promise.resolve([project]),
  },
  provider,
  selectProjectDirectory: () => Promise.resolve(undefined),
  settingsRepository: {
    // 保持真实服务的全局设置读写契约，确保运行时回退链可正常执行。
    readGlobalSettings: () => Promise.resolve(globalSettings),
    readProjectDefaults: (projectId) => Promise.resolve(projectDefaults.get(projectId)),
    readTaskSettings: (projectId, taskId) =>
      Promise.resolve(taskSettings.get(`${projectId}:${taskId}`)),
    writeProjectDefaults: (projectId, settings) => {
      projectDefaults.set(projectId, settings);
      return Promise.resolve(settings);
    },
    writeGlobalSettings: (settings) => {
      globalSettings = settings;
      return Promise.resolve(settings);
    },
    writeTaskSettings: (projectId, taskId, settings) => {
      taskSettings.set(`${projectId}:${taskId}`, settings);
      return Promise.resolve(settings);
    },
  },
  taskMetadataRepository: {
    listPinnedTaskIds: (projectId) => Promise.resolve([...(pinnedTaskIds.get(projectId) ?? [])]),
    writeTaskPinned: (projectId, taskId, pinned) => {
      const current = pinnedTaskIds.get(projectId) ?? new Set();
      if (pinned) {
        current.add(taskId);
      } else {
        current.delete(taskId);
      }
      pinnedTaskIds.set(projectId, current);
      return Promise.resolve(pinned);
    },
  },
  staticRoot,
});

const close = async () => {
  await server.close();
  await runtime.close();
};
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

const e2ePort = Number.parseInt(process.env["CODE_AGENT_E2E_PORT"] ?? "4173", 10);
await server.listen({ host: "127.0.0.1", port: e2ePort });
process.stdout.write(`Fake realtime server listening on http://127.0.0.1:${String(e2ePort)}\n`);
