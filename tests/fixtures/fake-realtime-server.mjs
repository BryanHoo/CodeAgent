#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openNodeEngine } from "../../apps/node-cli/dist/engine-node/index.js";
import { createCodeAgentServer } from "../../apps/node-cli/dist/server/index.js";

const fixtureProjectId = "code-agent";
// 与 Fake Codex thread cwd 保持一致，确保 Provider history 归属同一 Project。
const projectRoot = "/workspace/CodeAgent";
const fakeCodexScript = fileURLToPath(new URL("./fake-codex-server.mjs", import.meta.url));
const codexPath = fileURLToPath(
  new URL(
    `../../.cache/e2e/fake-codex-launcher${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
const addonPath = fileURLToPath(
  new URL("../../packages/engine-node/native/code-agent-node-binding.node", import.meta.url),
);
const staticRoot = fileURLToPath(new URL("../../apps/node-cli/dist/web", import.meta.url));
const stateRoot = await mkdtemp(join(tmpdir(), "code-agent-e2e-"));

process.env["FAKE_APP_SERVER_SCENARIO"] = "realtime-actions";
process.env["CODE_AGENT_FAKE_CODEX_NODE"] = process.execPath;
process.env["CODE_AGENT_FAKE_CODEX_SCRIPT"] = fakeCodexScript;
const nativeEngine = await openNodeEngine(
  {
    appVersion: "1.9.0",
    attachmentRoot: join(stateRoot, "attachments"),
    codexHome: stateRoot,
    codexPath,
    databasePath: join(stateRoot, "state.sqlite3"),
    temporaryWorkspace: join(stateRoot, "temporary-workspace"),
  },
  { addonPath },
);
const project = await nativeEngine.projectAdd(randomUUID(), projectRoot);
const nativeProjectId = project.id;

function normalizeFixtureValue(value) {
  if (value === nativeProjectId) return fixtureProjectId;
  if (Array.isArray(value)) return value.map(normalizeFixtureValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "sessionId" ? "e2e-session" : normalizeFixtureValue(item),
    ]),
  );
}

function nativeFixtureValue(value) {
  if (value === fixtureProjectId) return nativeProjectId;
  if (Array.isArray(value)) return value.map(nativeFixtureValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, nativeFixtureValue(item)]),
  );
}

// Fixture 路由保持稳定 ID；真实 Engine 仍使用 Repository 生成的持久化 ID。
const engine = new Proxy(nativeEngine, {
  get(target, property) {
    const member = Reflect.get(target, property, target);
    if (typeof member !== "function") return member;
    if (property === "eventSubscribe") {
      return (requestId, projectId, sessionId, afterSequence, callback) =>
        member.call(
          target,
          requestId,
          projectId === fixtureProjectId ? nativeProjectId : projectId,
          sessionId,
          afterSequence,
          (frame) => {
            const value = JSON.parse(Buffer.from(frame).toString("utf8"));
            callback(Buffer.from(JSON.stringify(normalizeFixtureValue(value))));
          },
        );
    }
    return async (...args) => {
      const mappedArgs = args.map(nativeFixtureValue);
      const result = await member.apply(target, mappedArgs);
      return normalizeFixtureValue(result);
    };
  },
});

const pairingCode = process.env["CODE_AGENT_E2E_PAIRING_CODE"];
const server = await createCodeAgentServer({
  ...(pairingCode === undefined
    ? {}
    : { access: { pairingCode, sessionTtlMs: 24 * 60 * 60 * 1_000 } }),
  engine,
  installAppUpdate: () => Promise.reject(new Error("No update available")),
  loggerEnabled: false,
  readAppInfo: () =>
    Promise.resolve({
      appVersion: "1.9.0",
      codexVersion: "0.147.0",
      latestVersion: "1.9.0",
      releaseNotes: null,
      status: "current",
      updateAvailable: false,
    }),
  staticRoot,
});

let closing;
async function close() {
  closing ??= (async () => {
    try {
      await server.close();
    } finally {
      await nativeEngine.close();
      await rm(stateRoot, { force: true, recursive: true });
    }
  })();
  return closing;
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

const port = Number.parseInt(process.env["CODE_AGENT_E2E_PORT"] ?? "0", 10);
const serverUrl = await server.listen({ host: "127.0.0.1", port });
process.stdout.write(`Fake realtime server listening on ${serverUrl}\n`);
