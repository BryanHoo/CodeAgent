#!/usr/bin/env node

import { createInterface } from "node:readline";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.145.0\n");
  process.exit(0);
}

const expectedArgs = ["app-server", "--listen", "stdio://", "--strict-config"];
if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
  process.stderr.write(`unexpected argv: ${JSON.stringify(args)}\n`);
  process.exit(64);
}

const scenario = process.env["FAKE_APP_SERVER_SCENARIO"] ?? "normal";
const input = createInterface({ input: process.stdin });
let initializeParams;
let initialized = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    initializeParams = message.params;
    if (scenario === "invalid-jsonl") {
      process.stdout.write("not-json\n");
      return;
    }
    if (scenario === "exit-during-initialize") {
      process.stderr.write("fake initialization failure\n");
      process.exit(17);
    }
    send({ id: message.id, result: { platformFamily: "unix", userAgent: "fake-codex" } });
    return;
  }

  if (message.method === "initialized") {
    initialized = true;
    return;
  }

  if (!initialized) {
    send({ error: { code: -32002, message: "Not initialized" }, id: message.id });
    return;
  }

  if (message.method === "inspect") {
    send({
      id: message.id,
      result: { args, initializeParams, initialized },
    });
    return;
  }

  if (message.method === "echo") {
    send({ id: message.id, result: message.params });
    return;
  }

  if (message.method === "slow") {
    return;
  }

  if (message.method === "invalid") {
    process.stdout.write("invalid-jsonl\n");
    return;
  }

  if (message.method === "crash") {
    process.stderr.write("fake app server crashed\n");
    process.exit(23);
  }

  send({ error: { code: -32601, message: "Method not found" }, id: message.id });
});

input.on("close", () => {
  process.exit(0);
});
