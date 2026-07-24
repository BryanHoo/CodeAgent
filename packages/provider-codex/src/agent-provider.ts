import { Buffer } from "node:buffer";
import { resolve } from "node:path";

import {
  PendingRequestResolutionError,
  type AgentProvider,
  type AgentProviderEvent,
  type AgentProviderEventListener,
  type AgentProviderTurnInput,
  type ListAgentTasksInput,
  type ResolvePendingRequestInput,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentContextUsage,
  AgentItem,
  AgentItemStatus,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshot,
  AgentTurn,
  AgentModelPage,
  AgentTurnOptions,
  PendingApprovalDecision,
  PendingRequest,
  Project,
} from "@code-agent/protocol";

import {
  RpcResponseError,
  type RpcErrorPayload,
  type RpcRequestId,
  type RpcServerRequest,
} from "./jsonl-rpc-client.js";

export interface CodexRpcClient {
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: { method: string; params: unknown }) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> | void;
}

export interface CreateCodexAgentProviderOptions {
  client: CodexRpcClient;
  project: Project;
}

export class CodexProtocolMappingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodexProtocolMappingError";
  }
}

const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES = 10_000;
const MAX_TERMINAL_PENDING_REQUESTS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface PendingCodexRequest {
  denyDecision?: "cancel" | "decline";
  providerRequestId: RpcRequestId;
  request: PendingRequest & { status: "pending" };
}

interface ResolvingPendingRequest {
  fingerprint: string;
  status: "expired" | "resolved";
  promise: Promise<PendingRequest>;
}

type NetworkAccess = NonNullable<
  Extract<PendingRequest, { type: "command_approval" }>["networkAccess"]
>;
type PendingUserInputQuestion = Extract<
  PendingRequest,
  { type: "user_input" }
>["questions"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexProtocolMappingError(`${context} must be an object`);
  }
  return value;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new CodexProtocolMappingError(`${context} must be a string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function optionalNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new CodexProtocolMappingError(`${context} must be a boolean`);
  }
  return value;
}

function requestIdKey(id: RpcRequestId): string {
  return `${typeof id}:${String(id)}`;
}

function toDateTimeMs(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a Unix timestamp in milliseconds`);
  }
  return new Date(value).toISOString();
}

function mapApprovalDecisions(value: unknown): {
  availableDecisions: PendingApprovalDecision[];
  denyDecision: "cancel" | "decline";
} {
  const nativeDecisions = Array.isArray(value)
    ? value.filter((decision): decision is string => typeof decision === "string")
    : ["accept", "acceptForSession", "decline"];
  const availableDecisions: PendingApprovalDecision[] = [];
  if (nativeDecisions.includes("accept")) {
    availableDecisions.push("allow");
  }
  if (nativeDecisions.includes("acceptForSession")) {
    availableDecisions.push("allow_for_session");
  }
  if (nativeDecisions.includes("decline") || nativeDecisions.includes("cancel")) {
    availableDecisions.push("deny");
  }
  if (availableDecisions.length === 0) {
    throw new CodexProtocolMappingError("Codex approval has no supported decisions");
  }
  return {
    availableDecisions,
    denyDecision: nativeDecisions.includes("decline") ? "decline" : "cancel",
  };
}

function isNetworkApprovalProtocol(value: unknown): value is NetworkAccess["protocol"] {
  return value === "http" || value === "https" || value === "socks5Tcp" || value === "socks5Udp";
}

function mapNetworkApprovalContext(value: unknown): NetworkAccess | null {
  if (value === null || value === undefined) {
    return null;
  }
  // 只向上暴露用户做网络授权所需的稳定目标信息。
  const context = expectRecord(value, "Codex network approval context");
  const host = expectString(context["host"], "Codex network approval host");
  const protocol = context["protocol"];
  if (host.length === 0) {
    throw new CodexProtocolMappingError("Codex network approval host must not be empty");
  }
  if (!isNetworkApprovalProtocol(protocol)) {
    throw new CodexProtocolMappingError("Codex network approval protocol is invalid");
  }
  return { host, protocol };
}

function isConfirmationOptions(options: readonly { label: string }[]): boolean {
  if (options.length !== 2) {
    return false;
  }
  const labels = new Set(options.map((option) => option.label.trim().toLocaleLowerCase()));
  return [
    ["yes", "no"],
    ["是", "否"],
    ["确认", "取消"],
    ["allow", "deny"],
    ["accept", "decline"],
  ].some((pair) => pair.every((label) => labels.has(label)));
}

function mapUserInputQuestions(value: unknown): PendingUserInputQuestion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new CodexProtocolMappingError("Codex user input questions must contain 1 to 3 items");
  }
  return value.map((questionValue) => {
    const question = expectRecord(questionValue, "Codex user input question");
    const nativeOptions = question["options"] ?? null;
    if (nativeOptions !== null && !Array.isArray(nativeOptions)) {
      throw new CodexProtocolMappingError("Codex user input options must be an array or null");
    }
    const isOther =
      question["isOther"] === undefined
        ? false
        : expectBoolean(question["isOther"], "Codex user input question isOther");
    const options = (nativeOptions ?? []).map((optionValue) => {
      const option = expectRecord(optionValue, "Codex user input option");
      return {
        description: expectString(option["description"], "Codex user input option description"),
        label: expectString(option["label"], "Codex user input option label"),
      };
    });
    if (nativeOptions !== null && options.length === 0 && !isOther) {
      throw new CodexProtocolMappingError("Codex choice question has no available answer");
    }
    const mappedQuestion = {
      header: expectString(question["header"], "Codex user input question header"),
      id: expectString(question["id"], "Codex user input question id"),
      isOther,
      isSecret:
        question["isSecret"] === undefined
          ? false
          : expectBoolean(question["isSecret"], "Codex user input question isSecret"),
      options,
      prompt: expectString(question["question"], "Codex user input question prompt"),
    };
    if (nativeOptions === null) {
      return { ...mappedQuestion, type: "short_text" };
    }
    if (isConfirmationOptions(options) && !isOther) {
      return { ...mappedQuestion, isOther: false, type: "confirmation" };
    }
    return { ...mappedQuestion, type: "choice" };
  });
}

function userInputAnswersMatchRequest(
  request: Extract<PendingRequest, { type: "user_input" }>,
  answers: Readonly<Record<string, readonly string[]>>,
): boolean {
  const answerIds = Object.keys(answers);
  const questionIds = new Set(request.questions.map((question) => question.id));
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    return false;
  }
  // 当前统一协议只提供单选、确认和短文本；固定选项不能接受任意值。
  return request.questions.every((question) => {
    const values = answers[question.id];
    const answer = values?.[0];
    if (values?.length !== 1 || answer === undefined || answer.trim().length === 0) {
      return false;
    }
    if (question.type === "short_text" || question.isOther) {
      return true;
    }
    return question.options.some((option) => option.label === answer);
  });
}

function mapCodexServerRequest(
  serverRequest: RpcServerRequest,
  project: Project,
): PendingCodexRequest | undefined {
  if (
    serverRequest.method !== "item/commandExecution/requestApproval" &&
    serverRequest.method !== "item/fileChange/requestApproval" &&
    serverRequest.method !== "item/tool/requestUserInput"
  ) {
    return undefined;
  }
  const params = expectRecord(serverRequest.params, `Codex ${serverRequest.method} params`);
  const taskId = expectString(params["threadId"], `Codex ${serverRequest.method} threadId`);
  const turnId = expectString(params["turnId"], `Codex ${serverRequest.method} turnId`);
  const itemId = expectString(params["itemId"], `Codex ${serverRequest.method} itemId`);
  const requestId = requestIdKey(serverRequest.id);

  if (serverRequest.method === "item/tool/requestUserInput") {
    const autoResolutionMs = params["autoResolutionMs"] ?? null;
    if (
      autoResolutionMs !== null &&
      (typeof autoResolutionMs !== "number" ||
        !Number.isInteger(autoResolutionMs) ||
        autoResolutionMs < 0)
    ) {
      throw new CodexProtocolMappingError("Codex user input autoResolutionMs is invalid");
    }
    const createdAtMs = Date.now();
    return {
      providerRequestId: serverRequest.id,
      request: {
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt:
          autoResolutionMs === null ? null : new Date(createdAtMs + autoResolutionMs).toISOString(),
        itemId,
        projectId: project.id,
        questions: mapUserInputQuestions(params["questions"]),
        requestId,
        status: "pending",
        taskId,
        turnId,
        type: "user_input",
      },
    };
  }

  const decisions = mapApprovalDecisions(params["availableDecisions"]);
  const identity = {
    createdAt: toDateTimeMs(params["startedAtMs"], `Codex ${serverRequest.method} startedAtMs`),
    expiresAt: null,
    itemId,
    projectId: project.id,
    requestId,
    status: "pending" as const,
    taskId,
    turnId,
  };
  if (serverRequest.method === "item/commandExecution/requestApproval") {
    return {
      denyDecision: decisions.denyDecision,
      providerRequestId: serverRequest.id,
      request: {
        ...identity,
        availableDecisions: decisions.availableDecisions,
        command: optionalNullableString(params["command"]),
        cwd: optionalNullableString(params["cwd"]),
        networkAccess: mapNetworkApprovalContext(params["networkApprovalContext"]),
        reason: optionalNullableString(params["reason"]),
        type: "command_approval",
      },
    };
  }
  return {
    denyDecision: decisions.denyDecision,
    providerRequestId: serverRequest.id,
    request: {
      ...identity,
      availableDecisions: decisions.availableDecisions,
      grantRoot: optionalNullableString(params["grantRoot"]),
      reason: optionalNullableString(params["reason"]),
      type: "file_change_approval",
    },
  };
}

function toDateTime(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a Unix timestamp`);
  }
  return new Date(value * 1_000).toISOString();
}

function toNullableDateTime(value: unknown, context: string): string | null {
  return value === null || value === undefined ? null : toDateTime(value, context);
}

function normalizedTitle(thread: Record<string, unknown>): string {
  const name = optionalString(thread["name"])?.trim();
  if (name) {
    return name;
  }
  const preview = optionalString(thread["preview"])?.trim().split(/\r?\n/u)[0]?.trim();
  return preview?.length ? preview : "未命名任务";
}

function mapAgentModel(value: unknown): AgentModelPage["data"][number] | undefined {
  const model = expectRecord(value, "Codex model");
  if (model["hidden"] === true) {
    return undefined;
  }
  if (model["hidden"] !== false || typeof model["isDefault"] !== "boolean") {
    throw new CodexProtocolMappingError("Codex model visibility or default flag is invalid");
  }
  if (!Array.isArray(model["supportedReasoningEfforts"])) {
    throw new CodexProtocolMappingError("Codex model reasoning efforts must be an array");
  }
  const supportedReasoningEfforts = model["supportedReasoningEfforts"].map((value) => {
    const option = expectRecord(value, "Codex model reasoning effort");
    return {
      description: expectString(option["description"], "Codex reasoning effort description"),
      id: expectString(option["reasoningEffort"], "Codex reasoning effort id"),
    };
  });
  const defaultReasoningEffort = expectString(
    model["defaultReasoningEffort"],
    "Codex model default reasoning effort",
  );
  if (
    supportedReasoningEfforts.length === 0 ||
    !supportedReasoningEfforts.some((option) => option.id === defaultReasoningEffort)
  ) {
    throw new CodexProtocolMappingError("Codex model default reasoning effort is unsupported");
  }
  return {
    defaultReasoningEffort,
    description: expectString(model["description"], "Codex model description"),
    displayName: expectString(model["displayName"], "Codex model displayName"),
    id: expectString(model["model"], "Codex model model"),
    isDefault: model["isDefault"],
    supportedReasoningEfforts,
  };
}

function mapContextUsage(value: unknown): AgentContextUsage {
  const tokenUsage = expectRecord(value, "Codex token usage");
  const last = expectRecord(tokenUsage["last"], "Codex last token usage");
  const usedTokens = optionalInteger(last["totalTokens"]);
  const rawContextWindow = tokenUsage["modelContextWindow"];
  const parsedContextWindow = rawContextWindow === null ? null : optionalInteger(rawContextWindow);
  if (usedTokens === undefined || usedTokens < 0) {
    throw new CodexProtocolMappingError("Codex context usage is invalid");
  }
  if (
    parsedContextWindow !== null &&
    (parsedContextWindow === undefined || parsedContextWindow <= 0)
  ) {
    throw new CodexProtocolMappingError("Codex context usage is invalid");
  }
  return { contextWindow: parsedContextWindow, usedTokens };
}

function mapThreadStatus(value: unknown): AgentTaskSnapshot["status"] {
  const type = optionalString(isRecord(value) ? value["type"] : undefined);
  if (type === "active") {
    return "running";
  }
  if (type === "systemError") {
    return "failed";
  }
  return "idle";
}

function mapTurnStatus(value: unknown): AgentTurn["status"] {
  if (value === "inProgress") {
    return "running";
  }
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex turn status is invalid");
}

function mapItemStatus(value: unknown): AgentItemStatus {
  if (value === "inProgress") {
    return "running";
  }
  if (value === "completed" || value === "failed" || value === "declined") {
    return value;
  }
  if (value === "interrupted" || value === "pending" || value === "running") {
    return value;
  }
  return "completed";
}

function mapUserMessageText(value: unknown): string {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex user message content must be an array");
  }
  return value
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      if (part["type"] === "text" && typeof part["text"] === "string") {
        return [part["text"]];
      }
      if (
        (part["type"] === "skill" || part["type"] === "mention") &&
        typeof part["name"] === "string"
      ) {
        return [`@${part["name"]}`];
      }
      if (part["type"] === "image" || part["type"] === "localImage") {
        return ["[图片]"];
      }
      if (part["type"] === "audio" || part["type"] === "localAudio") {
        return ["[音频]"];
      }
      return [];
    })
    .join("\n");
}

function mapFileChangeKind(value: unknown): "create" | "delete" | "update" {
  const type = optionalString(isRecord(value) ? value["type"] : undefined);
  if (type === "add") {
    return "create";
  }
  if (type === "delete" || type === "update") {
    return type;
  }
  throw new CodexProtocolMappingError("Codex file change kind is invalid");
}

function sliceUtf8Tail(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  let start = Math.max(0, encoded.length - maxBytes);

  // 跳过 UTF-8 续字节，确保截断后的首字符保持完整。
  while (start < encoded.length) {
    const byte = encoded[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    start += 1;
  }

  return encoded.subarray(start).toString("utf8");
}

function boundCommandOutput(value: string): { output: string; outputTruncated: boolean } {
  let output = value;
  let outputTruncated = false;
  let newlineCount = 0;

  // 从尾部保留最新日志；超过行数时无需创建完整行数组。
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output.charCodeAt(index) !== 10) {
      continue;
    }
    newlineCount += 1;
    if (newlineCount === MAX_COMMAND_OUTPUT_LINES) {
      output = output.slice(index + 1);
      outputTruncated = true;
      break;
    }
  }

  if (Buffer.byteLength(output, "utf8") > MAX_COMMAND_OUTPUT_BYTES) {
    output = sliceUtf8Tail(output, MAX_COMMAND_OUTPUT_BYTES);
    outputTruncated = true;
  }

  return { output, outputTruncated };
}

function mapToolError(value: unknown): { error: string } | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const error = expectRecord(value, "Codex tool error");
  return { error: expectString(error["message"], "Codex tool error message") };
}

function mapToolItem(item: Record<string, unknown>, id: string, name: string): AgentItem {
  const input = item["arguments"];
  const output = item["result"] ?? item["contentItems"] ?? mapToolError(item["error"]);
  return {
    id,
    ...(input === undefined ? {} : { input }),
    name,
    ...(output === undefined ? {} : { output }),
    status: mapItemStatus(item["status"]),
    type: "tool",
  };
}

function createActivityItem(id: string, label: string, detail?: string): AgentItem {
  return detail === undefined
    ? { id, label, type: "activity" }
    : { detail, id, label, type: "activity" };
}

function mapAgentItem(value: unknown): AgentItem {
  const item = expectRecord(value, "Codex item");
  const id = expectString(item["id"], "Codex item id");
  const type = expectString(item["type"], "Codex item type");

  switch (type) {
    case "userMessage":
      return { id, role: "user", text: mapUserMessageText(item["content"]), type: "message" };
    case "agentMessage":
      return {
        id,
        role: "assistant",
        text: expectString(item["text"], "Codex agent message text"),
        type: "message",
      };
    case "reasoning":
      return {
        content: Array.isArray(item["content"])
          ? item["content"].filter((entry): entry is string => typeof entry === "string").join("\n")
          : "",
        id,
        summary: Array.isArray(item["summary"])
          ? item["summary"].filter((entry): entry is string => typeof entry === "string").join("\n")
          : "",
        type: "reasoning",
      };
    case "commandExecution": {
      const exitCode = optionalInteger(item["exitCode"]);
      const nativeOutput = optionalString(item["aggregatedOutput"]);
      const output = nativeOutput === undefined ? undefined : boundCommandOutput(nativeOutput);
      return {
        command: expectString(item["command"], "Codex command"),
        cwd: expectString(item["cwd"], "Codex command cwd"),
        ...(exitCode === undefined ? {} : { exitCode }),
        id,
        ...(output === undefined ? {} : { output: output.output }),
        outputTruncated: output?.outputTruncated ?? false,
        status: mapItemStatus(item["status"]),
        type: "command",
      };
    }
    case "fileChange": {
      if (!Array.isArray(item["changes"])) {
        throw new CodexProtocolMappingError("Codex file changes must be an array");
      }
      return {
        changes: item["changes"].map((change) => {
          const nativeChange = expectRecord(change, "Codex file change");
          return {
            diff: expectString(nativeChange["diff"], "Codex file change diff"),
            kind: mapFileChangeKind(nativeChange["kind"]),
            path: expectString(nativeChange["path"], "Codex file change path"),
          };
        }),
        id,
        status: mapItemStatus(item["status"]),
        type: "file_change",
      };
    }
    case "mcpToolCall":
      return mapToolItem(
        item,
        id,
        `${expectString(item["server"], "Codex MCP server")}/${expectString(item["tool"], "Codex MCP tool")}`,
      );
    case "dynamicToolCall": {
      const namespace = optionalString(item["namespace"]);
      const tool = expectString(item["tool"], "Codex dynamic tool");
      return mapToolItem(item, id, namespace ? `${namespace}/${tool}` : tool);
    }
    case "collabAgentToolCall":
      return mapToolItem(
        { ...item, arguments: { receiverTaskIds: item["receiverThreadIds"] } },
        id,
        `collaboration/${expectString(item["tool"], "Codex collaboration tool")}`,
      );
    case "webSearch":
      return {
        id,
        input: { query: expectString(item["query"], "Codex web search query") },
        name: "web_search",
        ...(item["results"] === undefined || item["results"] === null
          ? {}
          : { output: item["results"] }),
        status: "completed",
        type: "tool",
      };
    case "imageGeneration":
      return {
        id,
        name: "image_generation",
        output: {
          result: optionalString(item["result"]) ?? "",
          ...(optionalString(item["savedPath"]) === undefined
            ? {}
            : { savedPath: optionalString(item["savedPath"]) }),
        },
        status: mapItemStatus(item["status"]),
        type: "tool",
      };
    case "plan":
      return { id, text: expectString(item["text"], "Codex plan text"), type: "plan" };
    case "hookPrompt":
      return createActivityItem(id, "Hook 提示");
    case "subAgentActivity":
      return createActivityItem(id, "子任务活动", optionalString(item["kind"]));
    case "imageView":
      return createActivityItem(id, "查看图片", optionalString(item["path"]));
    case "sleep":
      return {
        detail: `${String(optionalInteger(item["durationMs"]) ?? 0)}ms`,
        id,
        label: "等待",
        type: "activity",
      };
    case "enteredReviewMode":
      return createActivityItem(id, "进入审查", optionalString(item["review"]));
    case "exitedReviewMode":
      return createActivityItem(id, "结束审查", optionalString(item["review"]));
    case "contextCompaction":
      return createActivityItem(id, "上下文压缩");
    default:
      // 未知原生对象不向上透传，只保留定位协议漂移所需的类型名称。
      return {
        detail: `未识别的活动类型: ${type}`,
        id,
        label: "Provider 活动",
        type: "activity",
      };
  }
}

function mapAgentTurn(value: unknown): AgentTurn {
  const turn = expectRecord(value, "Codex turn");
  if (!Array.isArray(turn["items"])) {
    throw new CodexProtocolMappingError("Codex turn items must be an array");
  }
  return {
    completedAt: toNullableDateTime(turn["completedAt"], "Codex turn completedAt"),
    error:
      turn["error"] === null || turn["error"] === undefined
        ? null
        : expectString(
            expectRecord(turn["error"], "Codex turn error")["message"],
            "Codex turn error message",
          ),
    id: expectString(turn["id"], "Codex turn id"),
    items: turn["items"].map(mapAgentItem),
    startedAt: toNullableDateTime(turn["startedAt"], "Codex turn startedAt"),
    status: mapTurnStatus(turn["status"]),
  };
}

function mapCodexNotification(method: string, value: unknown): AgentProviderEvent | undefined {
  if (
    method !== "turn/started" &&
    method !== "turn/completed" &&
    method !== "item/agentMessage/delta" &&
    method !== "item/reasoning/summaryTextDelta" &&
    method !== "item/reasoning/textDelta" &&
    method !== "item/commandExecution/outputDelta" &&
    method !== "item/completed" &&
    method !== "thread/tokenUsage/updated" &&
    method !== "error"
  ) {
    return undefined;
  }

  const params = expectRecord(value, `Codex ${method} params`);
  const taskId = expectString(params["threadId"], `Codex ${method} threadId`);

  if (method === "thread/tokenUsage/updated") {
    return {
      payload: { usage: mapContextUsage(params["tokenUsage"]) },
      taskId,
      turnId: expectString(params["turnId"], "Codex token usage turnId"),
      type: "usage.updated",
    };
  }

  if (method === "turn/started" || method === "turn/completed") {
    const turn = mapAgentTurn(params["turn"]);
    return {
      payload: { turn },
      taskId,
      turnId: turn.id,
      type: method === "turn/started" ? "turn.started" : "turn.completed",
    };
  }

  const turnId = expectString(params["turnId"], `Codex ${method} turnId`);
  if (method === "error") {
    const error = expectRecord(params["error"], "Codex error notification error");
    if (typeof params["willRetry"] !== "boolean") {
      throw new CodexProtocolMappingError("Codex error notification willRetry must be a boolean");
    }
    return {
      payload: {
        message: expectString(error["message"], "Codex error notification message"),
        willRetry: params["willRetry"],
      },
      taskId,
      turnId,
      type: "provider.error",
    };
  }

  if (method === "item/completed") {
    const item = mapAgentItem(params["item"]);
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.completed",
    };
  }

  const itemId = expectString(params["itemId"], `Codex ${method} itemId`);
  const delta = expectString(params["delta"], `Codex ${method} delta`);
  if (method === "item/agentMessage/delta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "message.delta" };
  }
  if (method === "item/commandExecution/outputDelta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "command.output_delta" };
  }
  return {
    itemId,
    payload: {
      delta,
      field: method === "item/reasoning/summaryTextDelta" ? "summary" : "content",
    },
    taskId,
    turnId,
    type: "reasoning.delta",
  };
}

function isProjectThread(thread: Record<string, unknown>, project: Project): boolean {
  const cwd = expectString(thread["cwd"], "Codex thread cwd");
  return resolve(cwd) === resolve(project.rootPath);
}

function assertProjectThread(thread: Record<string, unknown>, project: Project): void {
  if (!isProjectThread(thread, project)) {
    throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
  }
}

function isThreadNotLoadedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not loaded:")
  );
}

function mapAgentTask(thread: Record<string, unknown>, project: Project): AgentTask {
  assertProjectThread(thread, project);
  return {
    id: expectString(thread["id"], "Codex thread id"),
    pinned: false,
    projectId: project.id,
    title: normalizedTitle(thread),
    updatedAt: toDateTime(thread["updatedAt"], "Codex thread updatedAt"),
  };
}

export class CodexAgentProvider implements AgentProvider {
  readonly #client: CodexRpcClient;
  readonly #eventListeners = new Set<AgentProviderEventListener>();
  readonly #pendingRequests = new Map<string, PendingCodexRequest>();
  readonly #pendingTaskServerRequests = new Map<string, PendingCodexRequest[]>();
  readonly #pendingTaskEvents = new Map<string, AgentProviderEvent[]>();
  readonly #pendingTaskReads = new Map<string, number>();
  readonly #project: Project;
  readonly #projectTaskIds = new Set<string>();
  readonly #requestExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #resolvingRequests = new Map<string, ResolvingPendingRequest>();
  readonly #taskContextUsage = new Map<string, AgentContextUsage>();
  readonly #terminalRequests = new Map<string, PendingRequest>();

  public constructor(client: CodexRpcClient, project: Project) {
    this.#client = client;
    this.#project = project;
    this.#client.onNotification((notification) => {
      this.#handleNotification(notification.method, notification.params);
    });
    this.#client.onServerRequest((request) => {
      this.#handleServerRequest(request);
    });
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      provider: "codex",
      tasks: { list: true, read: true, start: true },
      turns: { interrupt: true, start: true },
    });
  }

  public async listModels(): Promise<AgentModelPage> {
    const data: AgentModelPage["data"][number][] = [];
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const response = expectRecord(
        await this.#client.request("model/list", {
          ...(cursor === undefined ? {} : { cursor }),
          includeHidden: false,
          limit: 100,
        }),
        "model/list response",
      );
      if (!Array.isArray(response["data"])) {
        throw new CodexProtocolMappingError("model/list data must be an array");
      }
      for (const value of response["data"]) {
        const model = mapAgentModel(value);
        if (model !== undefined) {
          data.push(model);
        }
      }
      const nextCursor = response["nextCursor"];
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new CodexProtocolMappingError("model/list nextCursor must be a string or null");
      }
      if (typeof nextCursor === "string") {
        if (visitedCursors.has(nextCursor)) {
          throw new CodexProtocolMappingError("model/list returned a repeated cursor");
        }
        visitedCursors.add(nextCursor);
        cursor = nextCursor;
      } else {
        cursor = undefined;
      }
    } while (cursor !== undefined);

    return { data, nextCursor: null };
  }

  public async startTask(): Promise<AgentTask> {
    const response = expectRecord(
      await this.#client.request("thread/start", { cwd: this.#project.rootPath }),
      "thread/start response",
    );
    const task = mapAgentTask(
      expectRecord(response["thread"], "thread/start thread"),
      this.#project,
    );
    // 新建 Task 必须立即接收后续 Turn 通知，不能等待下一次列表刷新。
    this.#projectTaskIds.add(task.id);
    return task;
  }

  public async startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#assertKnownProjectTask(taskId);
    const images = input.images.map((image) => {
      if (!image.url.startsWith(`data:${image.mediaType};base64,`)) {
        throw new CodexProtocolMappingError("Provider image URL does not match its media type");
      }
      return { type: "image" as const, url: image.url };
    });
    const codexInput = [
      ...(input.text.length === 0
        ? []
        : [{ text: input.text, text_elements: [], type: "text" as const }]),
      ...images,
    ];
    if (codexInput.length === 0) {
      throw new CodexProtocolMappingError("Provider turn input must not be empty");
    }
    const response = expectRecord(
      await this.#client.request("turn/start", {
        approvalPolicy: options.approvalPolicy,
        effort: options.reasoningEffort,
        input: codexInput,
        model: options.model,
        threadId: taskId,
      }),
      "turn/start response",
    );
    return mapAgentTurn(response["turn"]);
  }

  public async interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("turn/interrupt", { threadId: taskId, turnId }),
      "turn/interrupt response",
    );
  }

  public async listTasks(input: ListAgentTasksInput = {}): Promise<AgentTaskPage> {
    const response = expectRecord(
      await this.#client.request("thread/list", {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        cwd: this.#project.rootPath,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        sortDirection: "desc",
        sortKey: "updated_at",
      }),
      "thread/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("thread/list data must be an array");
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
      throw new CodexProtocolMappingError("thread/list nextCursor must be a string or null");
    }
    const data = response["data"].map((thread) =>
      mapAgentTask(expectRecord(thread, "Codex thread"), this.#project),
    );
    for (const task of data) {
      this.#projectTaskIds.add(task.id);
    }
    return { data, nextCursor: nextCursor ?? null };
  }

  public async readTask(taskId: string): Promise<AgentTaskSnapshot | undefined> {
    this.#pendingTaskReads.set(taskId, (this.#pendingTaskReads.get(taskId) ?? 0) + 1);
    let projectOwnershipVerified = false;
    try {
      let nativeResponse: unknown;
      try {
        nativeResponse = await this.#client.request("thread/read", {
          includeTurns: true,
          threadId: taskId,
        });
      } catch (error) {
        // Codex 用明确的 RPC 错误表示 Task 不存在，其他连接与协议错误继续向上传播。
        if (isThreadNotLoadedError(error)) {
          return undefined;
        }
        throw error;
      }
      const response = expectRecord(nativeResponse, "thread/read response");
      const thread = expectRecord(response["thread"], "thread/read thread");
      if (!isProjectThread(thread, this.#project)) {
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.#promotePendingServerRequests(taskId);
      const task = mapAgentTask(thread, this.#project);
      if (!Array.isArray(thread["turns"])) {
        throw new CodexProtocolMappingError("thread/read turns must be an array");
      }
      const snapshot: AgentTaskSnapshot = {
        ...task,
        contextUsage: this.#taskContextUsage.get(taskId) ?? null,
        pendingRequests: [...this.#pendingRequests.values()]
          .map((entry) => entry.request)
          .filter((request) => request.taskId === taskId),
        status: mapThreadStatus(thread["status"]),
        turns: thread["turns"].map(mapAgentTurn),
      };
      return snapshot;
    } finally {
      this.#finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  public async resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    const entry = this.#pendingRequests.get(input.requestId);
    if (entry === undefined) {
      const terminal = this.#terminalRequests.get(input.requestId);
      if (terminal !== undefined) {
        throw new PendingRequestResolutionError(
          terminal.status === "resolved" ? "resolved" : "expired",
          `Pending request is already ${terminal.status}`,
        );
      }
      throw new PendingRequestResolutionError("not_found", "Pending request was not found");
    }
    const request = entry.request;
    if (
      request.projectId !== input.projectId ||
      request.taskId !== input.taskId ||
      request.turnId !== input.turnId ||
      request.itemId !== input.itemId ||
      request.type !== input.type
    ) {
      throw new PendingRequestResolutionError(
        "mismatch",
        "Pending request identity does not match",
      );
    }

    let result: unknown;
    if (input.type === "user_input") {
      if (request.type !== "user_input") {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      if (!userInputAnswersMatchRequest(request, input.resolution.answers)) {
        throw new PendingRequestResolutionError(
          "mismatch",
          "User input answers do not match the pending questions",
        );
      }
      result = {
        answers: Object.fromEntries(
          request.questions.map((question) => [
            question.id,
            { answers: input.resolution.answers[question.id] },
          ]),
        ),
      };
    } else {
      if (request.type === "user_input") {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      const decision = input.resolution.decision;
      if (!request.availableDecisions.includes(decision)) {
        throw new PendingRequestResolutionError(
          "mismatch",
          "Approval decision is not available for this request",
        );
      }
      result = {
        decision:
          decision === "allow"
            ? "accept"
            : decision === "allow_for_session"
              ? "acceptForSession"
              : (entry.denyDecision ?? "decline"),
      };
    }

    const fingerprint = JSON.stringify(result);
    const resolvingRequest = this.#resolvingRequests.get(input.requestId);
    if (resolvingRequest !== undefined) {
      if (resolvingRequest.fingerprint !== fingerprint) {
        throw new PendingRequestResolutionError(
          "resolved",
          "Pending request is already resolving with another response",
        );
      }
      return resolvingRequest.promise;
    }
    if (request.expiresAt !== null && Date.now() >= Date.parse(request.expiresAt)) {
      this.#expirePendingRequest(entry);
      throw new PendingRequestResolutionError("expired", "Pending request expired");
    }

    return this.#beginPendingRequestResolution(entry, result, fingerprint, "resolved");
  }

  public subscribeEvents(listener: AgentProviderEventListener): () => void {
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  #handleNotification(method: string, params: unknown): void {
    if (method === "serverRequest/resolved") {
      this.#handleServerRequestResolved(params);
      return;
    }
    let event: AgentProviderEvent | undefined;
    try {
      event = mapCodexNotification(method, params);
    } catch {
      // 单个原生通知字段漂移不能中断 JSONL Client 或后续关键事件。
      return;
    }
    if (event === undefined) {
      return;
    }
    if (
      event.type === "usage.updated" &&
      (this.#projectTaskIds.has(event.taskId) || this.#pendingTaskReads.has(event.taskId))
    ) {
      // 快照和实时事件共享同一份最近一轮上下文用量。
      this.#taskContextUsage.set(event.taskId, event.payload.usage);
    }
    if (event.type === "turn.completed") {
      this.#removeQueuedRequestsForTurn(event.taskId, event.turnId);
      for (const entry of [...this.#pendingRequests.values()]) {
        if (entry.request.taskId === event.taskId && entry.request.turnId === event.turnId) {
          this.#terminalizeRequest(entry, "expired");
        }
      }
    }
    this.#routeEvent(event);
  }

  #handleServerRequest(serverRequest: RpcServerRequest): void {
    let entry: PendingCodexRequest | undefined;
    try {
      entry = mapCodexServerRequest(serverRequest, this.#project);
    } catch {
      // 单个请求字段漂移不能破坏后续帧，也不能让 Codex 永久等待。
      this.#rejectServerRequest(serverRequest, {
        code: -32602,
        data: { method: serverRequest.method },
        message: "Invalid params",
      });
      return;
    }
    if (entry === undefined) {
      this.#rejectServerRequest(serverRequest, {
        code: -32601,
        data: { method: serverRequest.method },
        message: "Method not found",
      });
      return;
    }
    if (this.#hasPendingRequest(entry.request.requestId)) {
      return;
    }
    if (!this.#projectTaskIds.has(entry.request.taskId)) {
      if (this.#pendingTaskReads.has(entry.request.taskId)) {
        const queued = this.#pendingTaskServerRequests.get(entry.request.taskId) ?? [];
        queued.push(entry);
        this.#pendingTaskServerRequests.set(entry.request.taskId, queued);
      }
      return;
    }
    this.#activatePendingRequest(entry);
  }

  #rejectServerRequest(serverRequest: RpcServerRequest, error: RpcErrorPayload): void {
    // 写入失败会由 RPC Client 关闭连接；此处不制造未处理的异步拒绝。
    void this.#client.rejectServerRequest(serverRequest.id, error).catch(() => undefined);
  }

  #activatePendingRequest(entry: PendingCodexRequest): void {
    if (this.#hasPendingRequest(entry.request.requestId)) {
      return;
    }
    this.#pendingRequests.set(entry.request.requestId, entry);
    this.#schedulePendingRequestExpiry(entry);
    this.#routeEvent({
      itemId: entry.request.itemId,
      payload: { request: entry.request },
      taskId: entry.request.taskId,
      turnId: entry.request.turnId,
      type: "pending_request.created",
    });
  }

  #hasPendingRequest(requestId: string): boolean {
    if (this.#pendingRequests.has(requestId) || this.#terminalRequests.has(requestId)) {
      return true;
    }
    return [...this.#pendingTaskServerRequests.values()].some((entries) =>
      entries.some((entry) => entry.request.requestId === requestId),
    );
  }

  #promotePendingServerRequests(taskId: string): void {
    const entries = this.#pendingTaskServerRequests.get(taskId) ?? [];
    this.#pendingTaskServerRequests.delete(taskId);
    for (const entry of entries) {
      this.#activatePendingRequest(entry);
    }
  }

  #removeQueuedRequestsForTurn(taskId: string, turnId: string): void {
    const queued = this.#pendingTaskServerRequests.get(taskId);
    if (queued === undefined) {
      return;
    }
    const remaining = queued.filter((entry) => entry.request.turnId !== turnId);
    if (remaining.length === 0) {
      this.#pendingTaskServerRequests.delete(taskId);
      return;
    }
    this.#pendingTaskServerRequests.set(taskId, remaining);
  }

  #handleServerRequestResolved(value: unknown): void {
    let params: Record<string, unknown>;
    try {
      params = expectRecord(value, "Codex serverRequest/resolved params");
    } catch {
      return;
    }
    const providerRequestId = params["requestId"];
    if (
      typeof providerRequestId !== "string" &&
      !(typeof providerRequestId === "number" && Number.isFinite(providerRequestId))
    ) {
      return;
    }
    const taskId = params["threadId"];
    if (typeof taskId !== "string") {
      return;
    }
    const requestId = requestIdKey(providerRequestId);
    const entry = this.#pendingRequests.get(requestId);
    if (entry !== undefined) {
      if (entry.request.taskId === taskId) {
        const status = this.#resolvingRequests.get(requestId)?.status ?? "expired";
        this.#terminalizeRequest(entry, status);
      }
      return;
    }

    // 原生终态也要清理归属验证中的暂存项，但此时不能发布未验证事件。
    const queued = this.#pendingTaskServerRequests.get(taskId);
    const queuedIndex = queued?.findIndex((candidate) => candidate.request.requestId === requestId);
    if (queued === undefined || queuedIndex === undefined || queuedIndex < 0) {
      return;
    }
    queued.splice(queuedIndex, 1);
    if (queued.length === 0) {
      this.#pendingTaskServerRequests.delete(taskId);
    }
  }

  #routeEvent(event: AgentProviderEvent): void {
    if (this.#projectTaskIds.has(event.taskId)) {
      this.#publishEvent(event);
      return;
    }
    if (this.#pendingTaskReads.has(event.taskId)) {
      const pendingEvents = this.#pendingTaskEvents.get(event.taskId) ?? [];
      pendingEvents.push(event);
      this.#pendingTaskEvents.set(event.taskId, pendingEvents);
    }
  }

  #beginPendingRequestResolution(
    entry: PendingCodexRequest,
    result: unknown,
    fingerprint: string,
    status: "expired" | "resolved",
  ): Promise<PendingRequest> {
    const requestId = entry.request.requestId;
    // 保留到期定时器；响应失败或写入超时后仍必须进入自动过期路径。
    const promise = Promise.resolve()
      .then(() => this.#client.respondToServerRequest(entry.providerRequestId, result))
      .then(
        () => this.#terminalizeRequest(entry, status),
        (error: unknown) => {
          // Codex 原生终态比本地写回调更权威，可确认响应已经被服务端接收。
          const terminalRequest = this.#terminalRequests.get(requestId);
          if (terminalRequest?.status === "resolved") {
            return terminalRequest;
          }
          throw error;
        },
      );
    const resolving = { fingerprint, promise, status };
    this.#resolvingRequests.set(requestId, resolving);
    const clearResolution = () => {
      if (this.#resolvingRequests.get(requestId) === resolving) {
        this.#resolvingRequests.delete(requestId);
      }
    };
    void promise.then(clearResolution, clearResolution);
    return promise;
  }

  #schedulePendingRequestExpiry(entry: PendingCodexRequest): void {
    if (entry.request.type !== "user_input" || entry.request.expiresAt === null) {
      return;
    }
    const schedule = () => {
      if (this.#pendingRequests.get(entry.request.requestId) !== entry) {
        return;
      }
      const remainingMs = Date.parse(entry.request.expiresAt ?? "") - Date.now();
      if (remainingMs <= 0) {
        this.#requestExpiryTimers.delete(entry.request.requestId);
        this.#expirePendingRequest(entry);
        return;
      }
      const timer = setTimeout(schedule, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
      timer.unref();
      this.#requestExpiryTimers.set(entry.request.requestId, timer);
    };
    schedule();
  }

  #expirePendingRequest(entry: PendingCodexRequest): void {
    if (this.#pendingRequests.get(entry.request.requestId) !== entry) {
      return;
    }
    const resolving = this.#resolvingRequests.get(entry.request.requestId);
    if (resolving !== undefined) {
      // 截止时已有用户响应时等待它；仅在写入失败后补做自动过期。
      void resolving.promise.catch(() => {
        this.#expirePendingRequest(entry);
      });
      return;
    }
    const expiration = this.#beginPendingRequestResolution(
      entry,
      { answers: {} },
      "auto-expire",
      "expired",
    );
    void expiration.catch(() => {
      if (this.#pendingRequests.get(entry.request.requestId) === entry) {
        this.#terminalizeRequest(entry, "expired");
      }
    });
  }

  #clearRequestExpiryTimer(requestId: string): void {
    const timer = this.#requestExpiryTimers.get(requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#requestExpiryTimers.delete(requestId);
    }
  }

  #terminalizeRequest(entry: PendingCodexRequest, status: "expired" | "resolved"): PendingRequest {
    if (!this.#pendingRequests.delete(entry.request.requestId)) {
      return this.#terminalRequests.get(entry.request.requestId) ?? entry.request;
    }
    this.#clearRequestExpiryTimer(entry.request.requestId);
    const request =
      status === "resolved"
        ? ({ ...entry.request, status: "resolved" } as PendingRequest & { status: "resolved" })
        : ({ ...entry.request, status: "expired" } as PendingRequest & { status: "expired" });
    this.#terminalRequests.set(request.requestId, request);
    if (this.#terminalRequests.size > MAX_TERMINAL_PENDING_REQUESTS) {
      const oldestRequestId = this.#terminalRequests.keys().next().value;
      if (oldestRequestId !== undefined) {
        this.#terminalRequests.delete(oldestRequestId);
      }
    }
    if (request.status === "resolved") {
      this.#routeEvent({
        itemId: request.itemId,
        payload: { request },
        taskId: request.taskId,
        turnId: request.turnId,
        type: "pending_request.resolved",
      });
    } else {
      this.#routeEvent({
        itemId: request.itemId,
        payload: { request },
        taskId: request.taskId,
        turnId: request.turnId,
        type: "pending_request.expired",
      });
    }
    return request;
  }

  #finishTaskRead(taskId: string, projectOwnershipVerified: boolean): void {
    const remainingReads = (this.#pendingTaskReads.get(taskId) ?? 1) - 1;
    if (projectOwnershipVerified) {
      // 归属确认后先同步交付读取期间的通知，再让 readTask Promise 完成。
      this.#projectTaskIds.add(taskId);
      const pendingEvents = this.#pendingTaskEvents.get(taskId) ?? [];
      this.#pendingTaskEvents.delete(taskId);
      for (const event of pendingEvents) {
        this.#publishEvent(event);
      }
    }
    if (remainingReads > 0) {
      this.#pendingTaskReads.set(taskId, remainingReads);
      return;
    }
    this.#pendingTaskReads.delete(taskId);
    if (!this.#projectTaskIds.has(taskId)) {
      this.#pendingTaskEvents.delete(taskId);
      this.#pendingTaskServerRequests.delete(taskId);
      this.#taskContextUsage.delete(taskId);
      for (const entry of [...this.#pendingRequests.values()]) {
        if (entry.request.taskId === taskId) {
          this.#pendingRequests.delete(entry.request.requestId);
        }
      }
    }
  }

  #publishEvent(event: AgentProviderEvent): void {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // 一个订阅者失败不能阻塞其他交付边界。
      }
    }
  }

  #assertKnownProjectTask(taskId: string): void {
    if (!this.#projectTaskIds.has(taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }
}

export function createCodexAgentProvider(
  options: CreateCodexAgentProviderOptions,
): CodexAgentProvider {
  // App Server Runtime 已完成握手；Provider 只负责统一只读能力与字段映射。
  return new CodexAgentProvider(options.client, options.project);
}
