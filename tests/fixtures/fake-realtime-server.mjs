import { fileURLToPath } from "node:url";

import { createCodexAgentProvider, startCodexAppServer } from "../../dist/providers/codex/index.js";
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
const provider = createCodexAgentProvider({ client: runtime.client, project });
const server = await createCodeAgentServer({
  eventSessionId: "e2e-session",
  project,
  provider,
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
