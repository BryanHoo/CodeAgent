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
const actionScenario = scenario === "agent-actions" || scenario === "realtime-actions";
const realtimeScenario = scenario === "realtime" || scenario === "realtime-actions";
const pendingRequestScenario = scenario === "pending-requests" || actionScenario;
const input = createInterface({ input: process.stdin });
let initializeParams;
let initialized = false;
let realtimeRunning = false;
let nextActionTask = 1;
let nextActionTurn = 1;
const actionThreads = new Map();
const pendingServerRequests = new Map();
const pendingServerResponses = [];
let nextPendingRequest = 1;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function pendingRequestParams(
  kind,
  identity = { itemId: `${kind}-item`, threadId: "task-1", turnId: "turn-1" },
) {
  if (kind === "command") {
    return {
      ...identity,
      availableDecisions: ["accept", "acceptForSession", "decline"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      reason: "需要执行检查",
      startedAtMs: 1_753_228_800_000,
    };
  }
  if (kind === "file") {
    return {
      ...identity,
      grantRoot: "/workspace/CodeAgent",
      reason: "需要修改文件",
      startedAtMs: 1_753_228_801_000,
    };
  }
  return {
    ...identity,
    autoResolutionMs: 30_000,
    questions: [
      {
        header: "执行模式",
        id: "mode",
        isOther: true,
        isSecret: false,
        options: [
          { description: "继续实现", label: "继续" },
          { description: "停止当前工作", label: "停止" },
        ],
        question: "下一步怎么处理？",
      },
    ],
  };
}

function sendPendingRequest(
  kind,
  requestId,
  identity = { itemId: `${kind}-item`, threadId: "task-1", turnId: "turn-1" },
  completeOnResolve = false,
) {
  const method =
    kind === "command"
      ? "item/commandExecution/requestApproval"
      : kind === "file"
        ? "item/fileChange/requestApproval"
        : "item/tool/requestUserInput";
  pendingServerRequests.set(requestId, {
    completeOnResolve,
    kind,
    threadId: identity.threadId,
    turnId: identity.turnId,
  });
  send({ id: requestId, method, params: pendingRequestParams(kind, identity) });
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

function actionThread(id, turns = []) {
  return {
    createdAt: 1_753_228_800,
    cwd: "/workspace/CodeAgent",
    id,
    name: "Agent Action",
    preview: "Agent Action",
    status: { type: turns.some((turn) => turn.status === "inProgress") ? "active" : "notLoaded" },
    turns,
    updatedAt: 1_753_228_800 + turns.length,
  };
}

function actionTurn(id, status, items) {
  return {
    completedAt: status === "inProgress" ? null : 1_753_228_802,
    durationMs: status === "inProgress" ? null : 2_000,
    error: null,
    id,
    items,
    itemsView: { type: "full" },
    startedAt: 1_753_228_800,
    status,
  };
}

function completeActionTurn(threadId, turnId) {
  const thread = actionThreads.get(threadId);
  const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
  if (thread === undefined || runningTurn === undefined || runningTurn.status !== "inProgress") {
    return;
  }
  const message = {
    id: `${turnId}-assistant`,
    memoryCitation: null,
    phase: null,
    text: "流式回复完成",
    type: "agentMessage",
  };
  const completedTurn = actionTurn(turnId, "completed", [...runningTurn.items, message]);
  actionThreads.set(
    threadId,
    actionThread(
      threadId,
      thread.turns.map((turn) => (turn.id === turnId ? completedTurn : turn)),
    ),
  );
  for (const delta of ["流式回复", "完成"]) {
    send({
      method: "item/agentMessage/delta",
      params: { delta, itemId: message.id, threadId, turnId },
    });
  }
  send({
    method: "item/completed",
    params: { item: message, threadId, turnId },
  });
  send({ method: "turn/completed", params: { threadId, turn: completedTurn } });
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

  if (message.method === undefined && pendingServerRequests.has(message.id)) {
    const pending = pendingServerRequests.get(message.id);
    pendingServerRequests.delete(message.id);
    pendingServerResponses.push({ id: message.id, result: message.result });
    send({
      method: "serverRequest/resolved",
      params: { requestId: message.id, threadId: pending.threadId },
    });
    if (pending.completeOnResolve) {
      completeActionTurn(pending.threadId, pending.turnId);
    }
    return;
  }

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

  if (pendingRequestScenario && message.method === "trigger/pending") {
    const kind = message.params?.kind;
    if (kind !== "command" && kind !== "file" && kind !== "user_input") {
      send({ error: { code: -32602, message: "invalid pending request kind" }, id: message.id });
      return;
    }
    const requestId = `fake-${kind}-${String(nextPendingRequest)}`;
    nextPendingRequest += 1;
    send({ id: message.id, result: { requestId } });
    sendPendingRequest(kind, requestId);
    return;
  }

  if (pendingRequestScenario && message.method === "inspect/pending") {
    send({ id: message.id, result: { responses: pendingServerResponses } });
    return;
  }

  if (realtimeScenario && message.method === "thread/list") {
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
          ...(actionScenario ? [...actionThreads.values()] : []),
        ],
        nextCursor: null,
      },
    });
    return;
  }

  if (
    realtimeScenario &&
    message.method === "thread/read" &&
    message.params?.threadId === "task-realtime"
  ) {
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

  if (actionScenario && message.method === "thread/list") {
    send({
      id: message.id,
      result: { data: [...actionThreads.values()], nextCursor: null },
    });
    return;
  }

  if (actionScenario && message.method === "thread/start") {
    const threadId = `task-action-${String(nextActionTask)}`;
    nextActionTask += 1;
    const thread = actionThread(threadId);
    actionThreads.set(threadId, thread);
    send({ id: message.id, result: { thread } });
    return;
  }

  if (actionScenario && message.method === "thread/read") {
    const thread = actionThreads.get(message.params?.threadId);
    if (thread === undefined) {
      send({
        error: { code: -32600, message: `thread not loaded: ${String(message.params?.threadId)}` },
        id: message.id,
      });
      return;
    }
    send({ id: message.id, result: { thread } });
    return;
  }

  if (actionScenario && message.method === "turn/start") {
    const threadId = message.params?.threadId;
    const thread = actionThreads.get(threadId);
    if (thread === undefined) {
      send({
        error: { code: -32600, message: `thread not loaded: ${String(threadId)}` },
        id: message.id,
      });
      return;
    }
    const turnId = `turn-action-${String(nextActionTurn)}`;
    nextActionTurn += 1;
    const prompt = message.params?.input?.[0]?.text ?? "";
    const userMessage = {
      content: [{ text: prompt, type: "text" }],
      id: `${turnId}-user`,
      type: "userMessage",
    };
    const turn = actionTurn(turnId, "inProgress", [userMessage]);
    actionThreads.set(threadId, actionThread(threadId, [...thread.turns, turn]));
    send({ id: message.id, result: { turn } });
    send({ method: "turn/started", params: { threadId, turn } });
    const pendingKind = prompt.includes("审批命令")
      ? "command"
      : prompt.includes("审批文件")
        ? "file"
        : prompt.includes("用户输入")
          ? "user_input"
          : undefined;
    if (pendingKind !== undefined) {
      const requestId = `fake-${pendingKind}-${String(nextPendingRequest)}`;
      nextPendingRequest += 1;
      sendPendingRequest(
        pendingKind,
        requestId,
        { itemId: `${turnId}-${pendingKind}`, threadId, turnId },
        true,
      );
    } else if (!prompt.includes("中断")) {
      setTimeout(() => completeActionTurn(threadId, turnId), 120);
    }
    return;
  }

  if (actionScenario && message.method === "turn/interrupt") {
    const threadId = message.params?.threadId;
    const turnId = message.params?.turnId;
    const thread = actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      send({ error: { code: -32600, message: "turn not found" }, id: message.id });
      return;
    }
    const interruptedTurn = actionTurn(turnId, "interrupted", runningTurn.items);
    actionThreads.set(
      threadId,
      actionThread(
        threadId,
        thread.turns.map((turn) => (turn.id === turnId ? interruptedTurn : turn)),
      ),
    );
    send({ id: message.id, result: {} });
    send({ method: "turn/completed", params: { threadId, turn: interruptedTurn } });
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
