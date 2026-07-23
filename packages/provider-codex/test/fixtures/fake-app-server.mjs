#!/usr/bin/env node

import { createInterface } from "node:readline";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.145.0\n");
  process.exit(0);
}

const expectedArgs = ["app-server", "--listen", "stdio://"];
if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
  process.stderr.write(`unexpected argv: ${JSON.stringify(args)}\n`);
  process.exit(64);
}

const scenario = process.env["FAKE_APP_SERVER_SCENARIO"] ?? "normal";
const input = createInterface({ input: process.stdin });
let initializeParams;
let initialized = false;
let realtimeRunning = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function realtimeTurn(status, items, error = null) {
  return {
    completedAt: status === "inProgress" ? null : 1_753_228_802,
    durationMs: status === "inProgress" ? null : 2_000,
    error,
    id: "turn-realtime",
    items,
    itemsView: { type: "full" },
    startedAt: 1_753_228_800,
    status,
  };
}

function scheduleRealtimeEvents() {
  if (realtimeRunning) {
    return;
  }
  realtimeRunning = true;
  setTimeout(() => {
    const messageItem = {
      id: "message-realtime",
      memoryCitation: null,
      phase: null,
      text: "Realtime connected",
      type: "agentMessage",
    };
    const commandItem = {
      aggregatedOutput: "Done\n",
      command: "pnpm check",
      commandActions: [],
      cwd: "/workspace/CodeAgent",
      durationMs: 20,
      exitCode: 0,
      id: "command-realtime",
      processId: null,
      source: "agent",
      status: "completed",
      type: "commandExecution",
    };
    send({
      method: "turn/started",
      params: { threadId: "task-realtime", turn: realtimeTurn("inProgress", []) },
    });
    for (const delta of ["Realtime ", "connected"]) {
      send({
        method: "item/agentMessage/delta",
        params: {
          delta,
          itemId: "message-realtime",
          threadId: "task-realtime",
          turnId: "turn-realtime",
        },
      });
    }
    send({
      method: "item/completed",
      params: {
        completedAtMs: 1_753_228_801_000,
        item: messageItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    send({
      method: "item/commandExecution/outputDelta",
      params: {
        delta: "Done\n",
        itemId: "command-realtime",
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    send({
      method: "item/completed",
      params: {
        completedAtMs: 1_753_228_801_500,
        item: commandItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: "task-realtime",
        turn: realtimeTurn("completed", [messageItem, commandItem]),
      },
    });
    send({
      method: "error",
      params: {
        error: { message: "模型服务不可用" },
        threadId: "task-realtime",
        turnId: "turn-realtime",
        willRetry: false,
      },
    });
    // 同一轮读取期间只调度一次，完成后允许 Playwright 重试重新触发场景。
    realtimeRunning = false;
  }, 250);
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

  if (scenario === "realtime" && message.method === "thread/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1_753_228_800,
            cwd: "/workspace/CodeAgent",
            id: "task-realtime",
            name: "Realtime Path",
            preview: "Realtime Path",
            status: { type: "active" },
            updatedAt: 1_753_228_800,
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }

  if (scenario === "realtime" && message.method === "thread/read") {
    send({
      id: message.id,
      result: {
        thread: {
          createdAt: 1_753_228_800,
          cwd: "/workspace/CodeAgent",
          id: "task-realtime",
          name: "Realtime Path",
          preview: "Realtime Path",
          status: { type: "active" },
          turns: [],
          updatedAt: 1_753_228_800,
        },
      },
    });
    scheduleRealtimeEvents();
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
