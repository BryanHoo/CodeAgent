import assert from "node:assert/strict";
import test from "node:test";

import { waitForWebviewBridge } from "../tests/webview/bridge-readiness.mjs";

void test("WebView bridge readiness retries transient startup failures", async () => {
  let attempts = 0;

  await waitForWebviewBridge(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("WebView test bridge is unavailable");
    },
    { intervalMs: 0, timeoutMs: 100 },
  );

  assert.equal(attempts, 3);
});

void test("WebView bridge readiness reports the last startup failure on timeout", async () => {
  const startupError = new Error("WebView test bridge is unavailable");

  await assert.rejects(
    waitForWebviewBridge(async () => Promise.reject(startupError), {
      intervalMs: 0,
      timeoutMs: 0,
    }),
    (error) => error === startupError,
  );
});
