import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve, win32 } from "node:path";

import {
  PendingRequestResolutionError,
  type AgentProvider,
  type AgentProviderAttachment,
  type AgentProviderEvent,
  type AgentProviderEventListener,
  type AgentProviderTaskSnapshot,
  type AgentProviderTurnInput,
  type AgentRuntimeProvider,
  type AgentTaskUnsubscribeStatus,
  type ListAgentTasksInput,
  type ResolvePendingRequestInput,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentBackgroundTerminal,
  AgentBackgroundTerminalPage,
  AgentContextUsage,
  AgentItem,
  AgentItemStatus,
  AgentMessageAttachment,
  AgentMcpServerPage,
  AgentTask,
  AgentTaskPage,
  AgentTurn,
  AgentModelPage,
  AgentTurnOptions,
  AgentReviewTarget,
  AgentSandboxMode,
  AgentSkillPage,
  PendingApprovalDecision,
  PendingRequest,
  Project,
  UploadAgentFeedbackRequest,
} from "@code-agent/protocol";
import pino from "pino";

import {
  RpcResponseError,
  type RpcErrorPayload,
  type RpcRequestId,
  type RpcServerRequest,
} from "./jsonl-rpc-client.js";
import { extractCodexTextSkills, readCodexTranscriptTurnSkills } from "./codex-transcript.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";
import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";

export interface CodexRpcClient {
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: { method: string; params: unknown }) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> | void;
}

export interface CreateCodexRuntimeProviderOptions {
  client: CodexRpcClient;
  logger?: CodexProviderLogger;
}

export interface CodexProviderLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
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
const CODEX_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "error",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/completed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "thread/tokenUsage/updated",
  "turn/completed",
  "turn/started",
]);
const DEFAULT_PROVIDER_LOGGER: CodexProviderLogger = pino({ level: "warn" }).child({
  component: "provider-codex",
});

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

type CodexSandboxPolicy =
  | Readonly<{ type: "dangerFullAccess" }>
  | Readonly<{ networkAccess: boolean; type: "readOnly" }>
  | Readonly<{
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      type: "workspaceWrite";
      writableRoots: readonly string[];
    }>;

type CodexSkill = Readonly<{
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  name: string;
  path: string;
  scope: AgentSkillPage["data"][number]["scope"];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexProtocolMappingError(`${context} must be an object`);
  }
  return value;
}

function mapSandboxMode(value: unknown): AgentSandboxMode {
  if (value === null) {
    // Codex 未配置时采用其交互式编码安全默认值。
    return "workspace-write";
  }
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new CodexProtocolMappingError("config/read sandbox_mode is invalid");
}

function mapSandboxPolicy(mode: AgentSandboxMode): CodexSandboxPolicy {
  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (mode === "read-only") {
    return { networkAccess: false, type: "readOnly" };
  }
  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    type: "workspaceWrite",
    writableRoots: [],
  };
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

function mapBackgroundTerminal(value: unknown): AgentBackgroundTerminal {
  const terminal = expectRecord(value, "background terminal");
  return {
    command: expectString(terminal["command"], "background terminal command"),
    cwd: expectString(terminal["cwd"], "background terminal cwd"),
    // Codex processId 只在 Provider 边界出现，统一协议将其视为不透明终端标识。
    id: expectString(terminal["processId"], "background terminal process id"),
    itemId: expectString(terminal["itemId"], "background terminal item id"),
  };
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

function createSkillId(name: string, path: string): string {
  // 浏览器只持有稳定摘要，Codex 绝对路径始终留在 Provider 边界内。
  const digest = createHash("sha256").update(`${name}\0${path}`).digest("hex");
  return `skill_${digest.slice(0, 32)}`;
}

function mapCodexSkill(value: unknown): CodexSkill {
  const skill = expectRecord(value, "skills/list skill");
  const name = expectString(skill["name"], "skills/list skill name");
  const path = expectString(skill["path"], "skills/list skill path");
  const scope = skill["scope"];
  if (scope !== "user" && scope !== "repo" && scope !== "system" && scope !== "admin") {
    throw new CodexProtocolMappingError("skills/list skill scope is invalid");
  }
  const skillInterface = skill["interface"];
  const interfaceRecord =
    skillInterface === null || skillInterface === undefined
      ? undefined
      : expectRecord(skillInterface, "skills/list skill interface");
  const displayName = optionalString(interfaceRecord?.["displayName"]) ?? name;
  const description =
    optionalString(interfaceRecord?.["shortDescription"]) ??
    optionalString(skill["shortDescription"]) ??
    expectString(skill["description"], "skills/list skill description");
  return {
    description,
    displayName,
    enabled: expectBoolean(skill["enabled"], "skills/list skill enabled"),
    id: createSkillId(name, path),
    name,
    path,
    scope,
  };
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
  // Codex 生成正式标题前统一显示新聊天，后续列表刷新会自然替换为 name 或 preview。
  return preview?.length ? preview : "新聊天";
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

function mapThreadStatus(value: unknown): AgentProviderTaskSnapshot["status"] {
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

type MapCodexMessageImage = (
  part: Record<string, unknown>,
  imageIndex: number,
) => AgentMessageAttachment | undefined;

function mapUserMessageContent(
  value: unknown,
  mapImage: MapCodexMessageImage,
): Readonly<{
  attachments: AgentMessageAttachment[];
  skills: { name: string }[];
  text: string;
}> {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex user message content must be an array");
  }
  const attachments: AgentMessageAttachment[] = [];
  const skills: { name: string }[] = [];
  const textParts: string[] = [];

  for (const part of value) {
    if (!isRecord(part)) {
      continue;
    }
    if (part["type"] === "text" && typeof part["text"] === "string") {
      const textContent = extractCodexTextSkills(part["text"]);
      skills.push(...textContent.skills);
      if (textContent.text.length > 0) {
        textParts.push(textContent.text);
      }
      continue;
    }
    if (part["type"] === "skill") {
      // Codex 历史保留 Skill 的 name/path；公开消息只暴露展示所需的 name。
      const name = expectString(part["name"], "Codex user message skill name");
      expectString(part["path"], "Codex user message skill path");
      skills.push({ name });
      continue;
    }
    if (part["type"] === "mention" && typeof part["name"] === "string") {
      textParts.push(`@${part["name"]}`);
      continue;
    }
    if (part["type"] === "image" || part["type"] === "localImage") {
      const attachment = mapImage(part, attachments.length);
      if (attachment === undefined) {
        textParts.push("[图片]");
      } else {
        attachments.push(attachment);
      }
      continue;
    }
    if (part["type"] === "audio" || part["type"] === "localAudio") {
      textParts.push("[音频]");
    }
  }

  return { attachments, skills, text: textParts.join("\n") };
}

function mergeExpandedSkillMessages(items: readonly AgentItem[]): AgentItem[] {
  const mergedItems: AgentItem[] = [];

  for (const item of items) {
    const isSkillOnlyMessage =
      item.type === "message" &&
      item.role === "user" &&
      item.text.length === 0 &&
      (item.skills?.length ?? 0) > 0;
    const previousItem = mergedItems.at(-1);
    if (isSkillOnlyMessage && previousItem?.type === "message" && previousItem.role === "user") {
      // 持久化历史把 Skill 指令放在原消息之后，恢复时合并为一个用户气泡。
      const skillNames = new Set((previousItem.skills ?? []).map((skill) => skill.name));
      const mergedSkills = [...(previousItem.skills ?? [])];
      for (const skill of item.skills ?? []) {
        if (!skillNames.has(skill.name)) {
          skillNames.add(skill.name);
          mergedSkills.push(skill);
        }
      }
      mergedItems[mergedItems.length - 1] = {
        ...previousItem,
        skills: mergedSkills,
      };
      continue;
    }
    mergedItems.push(item);
  }

  return mergedItems;
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

function markStartedItemRunning(item: AgentItem): AgentItem {
  // 启动通知代表当前操作，统一覆盖原生缺省状态供 Web 实时展示。
  if (
    item.type === "command" ||
    item.type === "file_change" ||
    item.type === "tool" ||
    item.type === "activity"
  ) {
    return { ...item, status: "running" };
  }
  return item;
}

const collaborationToolNames = {
  closeAgent: "agent/close",
  resumeAgent: "agent/resume",
  sendInput: "agent/send_input",
  spawnAgent: "agent/spawn",
  wait: "agent/wait",
} as const;

function mapCollaborationAgentStatus(value: unknown): AgentItemStatus {
  if (value === "pendingInit") {
    return "pending";
  }
  if (value === "errored" || value === "notFound") {
    return "failed";
  }
  if (value === "shutdown") {
    return "completed";
  }
  return mapItemStatus(value);
}

function mapCollaborationToolItem(
  item: Record<string, unknown>,
  id: string,
  subagentNicknames: ReadonlyMap<string, string>,
): AgentItem {
  const nativeToolName = expectString(item["tool"], "Codex collaboration tool");
  if (!(nativeToolName in collaborationToolNames)) {
    throw new CodexProtocolMappingError("Codex collaboration tool is invalid");
  }
  const toolName = collaborationToolNames[nativeToolName as keyof typeof collaborationToolNames];
  if (!Array.isArray(item["receiverThreadIds"])) {
    throw new CodexProtocolMappingError("Codex collaboration receivers must be an array");
  }
  const receiverTaskIds = item["receiverThreadIds"].map((value) =>
    expectString(value, "Codex collaboration receiver thread id"),
  );
  const prompt = optionalString(item["prompt"]);
  const model = optionalString(item["model"]);
  const reasoningEffort = optionalString(item["reasoningEffort"]);
  const agentsStates = expectRecord(item["agentsStates"], "Codex collaboration agent states");
  const agents = Object.entries(agentsStates).map(([taskId, value]) => {
    const agentState = expectRecord(value, "Codex collaboration agent state");
    const message = optionalString(agentState["message"]);
    const nickname = subagentNicknames.get(taskId);
    return {
      ...(message === undefined ? {} : { message }),
      ...(nickname === undefined ? {} : { nickname }),
      status: mapCollaborationAgentStatus(agentState["status"]),
      taskId,
    };
  });

  return {
    id,
    input: {
      ...(model === undefined ? {} : { model }),
      ...(prompt === undefined ? {} : { prompt }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      receiverTaskIds,
      senderTaskId: expectString(item["senderThreadId"], "Codex collaboration sender thread id"),
    },
    name: toolName,
    output: { agents },
    status: mapItemStatus(item["status"]),
    type: "tool",
  };
}

function mapSubagentActivityItem(item: Record<string, unknown>, id: string): AgentItem {
  expectString(item["agentThreadId"], "Codex subagent thread id");
  const agentPath = expectString(item["agentPath"], "Codex subagent path");
  const agentName = agentPath.split("/").filter(Boolean).at(-1) ?? agentPath;
  const kind = expectString(item["kind"], "Codex subagent activity kind");
  const activityLabels: Readonly<Record<string, string>> = {
    interacted: "已交互",
    interrupted: "已中断",
    started: "已启动",
  };
  const detail = activityLabels[kind];
  if (detail === undefined) {
    throw new CodexProtocolMappingError("Codex subagent activity kind is invalid");
  }
  return {
    detail,
    id,
    label: `子代理 ${agentName}`,
    status: kind === "interrupted" ? "interrupted" : "completed",
    type: "activity",
  };
}

type CodexMessagePhase = "commentary" | "final_answer";

const CODEX_UNCOMMITTED_REVIEW_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files)";

function mapReviewHint(review: string): AgentReviewTarget {
  if (review === "current changes") {
    return { type: "uncommitted_changes" };
  }
  const baseBranch = /^changes against '(.+)'$/.exec(review)?.[1];
  if (baseBranch !== undefined) {
    return { branch: baseBranch, type: "base_branch" };
  }
  const commit = /^commit (\S+)(?:: (.+))?$/.exec(review);
  if (commit?.[1] !== undefined) {
    return {
      sha: commit[1],
      ...(commit[2] === undefined ? {} : { title: commit[2] }),
      type: "commit",
    };
  }
  return { instructions: review, type: "custom" };
}

function readNativeUserMessageText(item: Record<string, unknown>): string | undefined {
  if (item["type"] !== "userMessage" || !Array.isArray(item["content"])) {
    return undefined;
  }
  return item["content"]
    .flatMap((part) => {
      const contentPart = expectRecord(part, "Codex user message content part");
      return contentPart["type"] === "text" && typeof contentPart["text"] === "string"
        ? [contentPart["text"]]
        : [];
    })
    .join("\n");
}

function inferReviewTargetFromPrompt(item: Record<string, unknown>): AgentReviewTarget | undefined {
  const text = readNativeUserMessageText(item);
  if (text === undefined) {
    return undefined;
  }
  if (text.startsWith(CODEX_UNCOMMITTED_REVIEW_PROMPT)) {
    return { type: "uncommitted_changes" };
  }
  const baseBranch = /^Review the code changes against the base branch '([^']+)'\./.exec(text)?.[1];
  if (baseBranch !== undefined) {
    return { branch: baseBranch, type: "base_branch" };
  }
  const commit = /^Review the code changes introduced by commit (\S+?)(?: \("([\s\S]+)"\))?\./.exec(
    text,
  );
  if (commit?.[1] !== undefined) {
    return {
      sha: commit[1],
      ...(commit[2] === undefined ? {} : { title: commit[2] }),
      type: "commit",
    };
  }
  return undefined;
}

function createReviewItem(turnId: string, target: AgentReviewTarget): AgentItem {
  return { id: `review-mode-${turnId}`, target, type: "review" };
}

function mapCodexMessagePhase(value: unknown): CodexMessagePhase | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value === "commentary" || value === "final_answer") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex agent message phase is invalid");
}

function mapAgentItem(
  value: unknown,
  subagentNicknames: ReadonlyMap<string, string> = new Map(),
  mapImage: MapCodexMessageImage = () => undefined,
): AgentItem {
  const item = expectRecord(value, "Codex item");
  const id = expectString(item["id"], "Codex item id");
  const type = expectString(item["type"], "Codex item type");

  switch (type) {
    case "userMessage": {
      const content = mapUserMessageContent(item["content"], mapImage);
      return {
        ...(content.attachments.length === 0 ? {} : { attachments: content.attachments }),
        id,
        role: "user",
        ...(content.skills.length === 0 ? {} : { skills: content.skills }),
        text: content.text,
        type: "message",
      };
    }
    case "agentMessage": {
      const text = expectString(item["text"], "Codex agent message text");
      // Commentary 与最终回复都是面向用户的输出，统一走普通消息的流式渲染路径。
      mapCodexMessagePhase(item["phase"]);
      return { id, role: "assistant", text, type: "message" };
    }
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
      return mapCollaborationToolItem(item, id, subagentNicknames);
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
      return mapSubagentActivityItem(item, id);
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
      return {
        id,
        target: mapReviewHint(expectString(item["review"], "Codex review mode hint")),
        type: "review",
      };
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

function mapAgentTurn(
  value: unknown,
  mapImage: MapCodexMessageImage = () => undefined,
  explicitReviewTarget?: AgentReviewTarget,
): AgentTurn {
  const turn = expectRecord(value, "Codex turn");
  if (!Array.isArray(turn["items"])) {
    throw new CodexProtocolMappingError("Codex turn items must be an array");
  }
  const turnId = expectString(turn["id"], "Codex turn id");
  const nativeItems = turn["items"].map((item) => expectRecord(item, "Codex turn item"));
  const enteredReviewMode = nativeItems.find((item) => item["type"] === "enteredReviewMode");
  const inferredReviewTarget = nativeItems
    .map(inferReviewTargetFromPrompt)
    .find((target) => target !== undefined);
  const reviewTarget =
    explicitReviewTarget ??
    (enteredReviewMode === undefined
      ? inferredReviewTarget
      : mapReviewHint(expectString(enteredReviewMode["review"], "Codex review mode hint")));
  const subagentNicknames = new Map<string, string>();
  for (const item of nativeItems) {
    if (item["type"] !== "subAgentActivity") {
      continue;
    }
    const taskId = expectString(item["agentThreadId"], "Codex subagent thread id");
    const agentPath = expectString(item["agentPath"], "Codex subagent path");
    const nickname = agentPath.split("/").filter(Boolean).at(-1) ?? agentPath;
    subagentNicknames.set(taskId, nickname);
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
    id: turnId,
    // 先收集活动项中的昵称，再回填协作项，避免向 Web 暴露不可读的线程 ID。
    items: mergeExpandedSkillMessages([
      ...(reviewTarget === undefined ? [] : [createReviewItem(turnId, reviewTarget)]),
      ...nativeItems.flatMap((item) => {
        const type = item["type"];
        // Review Prompt 是 Codex 内部执行输入；统一时间线只保留一个结构化审查请求。
        if (
          type === "enteredReviewMode" ||
          type === "exitedReviewMode" ||
          (reviewTarget !== undefined && type === "userMessage")
        ) {
          return [];
        }
        return [mapAgentItem(item, subagentNicknames, mapImage)];
      }),
    ]),
    startedAt: toNullableDateTime(turn["startedAt"], "Codex turn startedAt"),
    status: mapTurnStatus(turn["status"]),
  };
}

function attachTranscriptSkills(turn: AgentTurn, skillNames: readonly string[]): AgentTurn {
  if (skillNames.length === 0) {
    return turn;
  }

  const userMessageIndex = turn.items.findIndex(
    (item) => item.type === "message" && item.role === "user",
  );
  const userMessage = turn.items[userMessageIndex];
  if (userMessageIndex < 0 || userMessage?.type !== "message" || userMessage.role !== "user") {
    return turn;
  }

  const existingSkillNames = new Set((userMessage.skills ?? []).map((skill) => skill.name));
  const skills = [...(userMessage.skills ?? [])];
  for (const name of skillNames) {
    if (!existingSkillNames.has(name)) {
      existingSkillNames.add(name);
      skills.push({ name });
    }
  }
  const items = turn.items.map((item, itemIndex) =>
    itemIndex === userMessageIndex ? { ...userMessage, skills } : item,
  );
  return { ...turn, items };
}

function mapCodexNotification(
  method: string,
  value: unknown,
  mapImage: (
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ) => AgentMessageAttachment | undefined,
  reviewTarget?: AgentReviewTarget,
): AgentProviderEvent | undefined {
  if (!CODEX_NOTIFICATION_METHODS.has(method)) {
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
    const turn = mapAgentTurn(
      params["turn"],
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      reviewTarget,
    );
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

  if (method === "item/started") {
    const nativeItem = expectRecord(params["item"], "Codex started item");
    if (nativeItem["type"] === "enteredReviewMode") {
      const item = createReviewItem(
        turnId,
        reviewTarget ?? mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint")),
      );
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.started" };
    }
    // 文本与推理由专用 Delta 创建；结构化操作必须立即交付当前运行状态。
    if (
      nativeItem["type"] === "userMessage" ||
      nativeItem["type"] === "agentMessage" ||
      nativeItem["type"] === "reasoning" ||
      nativeItem["type"] === "exitedReviewMode"
    ) {
      return undefined;
    }
    const item = markStartedItemRunning(mapAgentItem(nativeItem));
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.started",
    };
  }

  if (method === "item/completed") {
    const nativeItem = expectRecord(params["item"], "Codex completed item");
    if (nativeItem["type"] === "exitedReviewMode") {
      return undefined;
    }
    const promptReviewTarget = inferReviewTargetFromPrompt(nativeItem);
    if (nativeItem["type"] === "userMessage" && reviewTarget !== undefined) {
      return undefined;
    }
    if (nativeItem["type"] === "enteredReviewMode" || promptReviewTarget !== undefined) {
      const target =
        reviewTarget ??
        promptReviewTarget ??
        mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint"));
      const item = createReviewItem(turnId, target);
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.completed" };
    }
    const item = mapAgentItem(nativeItem, new Map(), (part, imageIndex) =>
      mapImage(taskId, part, imageIndex),
    );
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

function normalizedPathIdentity(path: string): string {
  if (win32.isAbsolute(path)) {
    return win32.resolve(path).toLocaleLowerCase("en-US");
  }
  return resolve(path);
}

function isSameResolvedPath(left: string, right: string): boolean {
  return normalizedPathIdentity(left) === normalizedPathIdentity(right);
}

async function canonicalPathIdentity(path: string): Promise<string> {
  try {
    // 历史 Thread 可能保留符号链接路径，归属校验需要与已注册 Project 的真实路径对齐。
    return normalizedPathIdentity(await realpath(path));
  } catch {
    return normalizedPathIdentity(path);
  }
}

async function isSameCanonicalPath(left: string, right: string): Promise<boolean> {
  const [leftIdentity, rightIdentity] = await Promise.all([
    canonicalPathIdentity(left),
    canonicalPathIdentity(right),
  ]);
  return leftIdentity === rightIdentity;
}

async function isProjectThread(
  thread: Record<string, unknown>,
  project: Project,
): Promise<boolean> {
  const cwd = expectString(thread["cwd"], "Codex thread cwd");
  return isSameCanonicalPath(cwd, project.rootPath);
}

async function assertProjectThread(
  thread: Record<string, unknown>,
  project: Project,
): Promise<void> {
  if (!(await isProjectThread(thread, project))) {
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

function isBackgroundTerminalThreadMissingError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not found:")
  );
}

function isThreadNotMaterializedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.includes(
      "is not materialized yet; includeTurns is unavailable before first user message",
    )
  );
}

function createUnmaterializedTaskSnapshot(task: AgentTask): AgentProviderTaskSnapshot {
  return {
    ...task,
    contextUsage: null,
    pendingRequests: [],
    status: "idle",
    turns: [],
  };
}

async function mapAgentTask(thread: Record<string, unknown>, project: Project): Promise<AgentTask> {
  await assertProjectThread(thread, project);
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
  readonly #activeReviewTargets = new Map<string, AgentReviewTarget>();
  readonly #eventListeners = new Set<AgentProviderEventListener>();
  readonly #historicalAttachments = new CodexHistoricalAttachmentStore();
  readonly #logger: CodexProviderLogger;
  readonly #pendingRequests = new Map<string, PendingCodexRequest>();
  readonly #pendingTaskServerRequests = new Map<string, PendingCodexRequest[]>();
  readonly #pendingTaskEvents = new Map<string, AgentProviderEvent[]>();
  readonly #pendingTaskReads = new Map<string, number>();
  readonly #project: Project;
  readonly #projectTaskIds = new Set<string>();
  readonly #resumedTaskIds = new Set<string>();
  readonly #taskResumePromises = new Map<string, Promise<void>>();
  readonly #requestExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #resolvingRequests = new Map<string, ResolvingPendingRequest>();
  readonly #runningTaskIds = new Set<string>();
  readonly #taskContextUsage = new Map<string, AgentContextUsage>();
  readonly #terminalRequests = new Map<string, PendingRequest>();
  readonly #unmaterializedTasks = new Map<string, AgentTask>();
  readonly #skillsById = new Map<string, CodexSkill>();

  public constructor(
    client: CodexRpcClient,
    project: Project,
    options: { logger?: CodexProviderLogger; subscribeRpc?: boolean } = {},
  ) {
    this.#client = client;
    this.#logger = options.logger ?? DEFAULT_PROVIDER_LOGGER;
    this.#project = project;
    if (options.subscribeRpc ?? true) {
      this.#client.onNotification((notification) => {
        this.receiveNotification(notification.method, notification.params);
      });
      this.#client.onServerRequest((request) => {
        this.receiveServerRequest(request);
      });
    }
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        rollback: true,
        start: true,
        steer: true,
      },
    });
  }

  public async readSandboxMode(): Promise<AgentSandboxMode> {
    const response = expectRecord(
      await this.#client.request("config/read", { cwd: this.#project.rootPath }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    return mapSandboxMode(config["sandbox_mode"]);
  }

  public async archiveTask(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/archive", { threadId: taskId }),
      "thread/archive response",
    );
  }

  public async compactTask(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/compact/start", { threadId: taskId }),
      "thread/compact/start response",
    );
  }

  public async forkTask(taskId: string): Promise<AgentTask> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/fork", { threadId: taskId }),
      "thread/fork response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/fork thread"),
      this.#project,
    );
    // Fork 成功后立即接受新 Task 的实时通知与后续 Mutation。
    this.#projectTaskIds.add(task.id);
    this.#resumedTaskIds.add(task.id);
    return task;
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("thread/name/set", { name: title, threadId: taskId }),
      "thread/name/set response",
    );
  }

  public async listMcpServers(): Promise<AgentMcpServerPage> {
    const response = expectRecord(
      await this.#client.request("config/read", { cwd: this.#project.rootPath }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    const rawMcpServers = config["mcp_servers"];
    if (rawMcpServers === undefined) {
      return { data: [] };
    }

    const mcpServers = expectRecord(rawMcpServers, "config/read mcp_servers");
    // 配置只在 Provider 边界判定启用状态，对外只保留名称以隔离命令、环境变量和 Secret。
    const data = Object.entries(mcpServers)
      .filter(([name, value]) => {
        if (name.length === 0) {
          throw new CodexProtocolMappingError("config/read MCP server name is invalid");
        }
        const server = expectRecord(value, `config/read MCP server ${name}`);
        const enabled = server["enabled"];
        if (enabled !== undefined && typeof enabled !== "boolean") {
          throw new CodexProtocolMappingError("config/read MCP server enabled is invalid");
        }
        return enabled !== false;
      })
      .map(([name]) => ({ name }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { data };
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

  public async listSkills(): Promise<AgentSkillPage> {
    const response = expectRecord(
      await this.#client.request("skills/list", {
        cwds: [this.#project.rootPath],
        forceReload: false,
      }),
      "skills/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("skills/list data must be an array");
    }
    let projectEntry: Record<string, unknown> | undefined;
    for (const value of response["data"]) {
      const entry = expectRecord(value, "skills/list entry");
      if (
        await isSameCanonicalPath(
          expectString(entry["cwd"], "skills/list cwd"),
          this.#project.rootPath,
        )
      ) {
        projectEntry = entry;
        break;
      }
    }
    if (projectEntry === undefined || !Array.isArray(projectEntry["skills"])) {
      throw new CodexProtocolMappingError("skills/list did not return the active project");
    }

    const skills = projectEntry["skills"].map(mapCodexSkill).filter((skill) => skill.enabled);
    this.#skillsById.clear();
    for (const skill of skills) {
      this.#skillsById.set(skill.id, skill);
    }
    return {
      data: skills.map(({ description, displayName, id, name, scope }) => ({
        description,
        displayName,
        id,
        name,
        scope,
      })),
      nextCursor: null,
    };
  }

  public async startTask(): Promise<AgentTask> {
    const response = expectRecord(
      await this.#client.request("thread/start", { cwd: this.#project.rootPath }),
      "thread/start response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/start thread"),
      this.#project,
    );
    // 新建 Task 必须立即接收后续 Turn 通知，不能等待下一次列表刷新。
    this.#projectTaskIds.add(task.id);
    this.#resumedTaskIds.add(task.id);
    this.#unmaterializedTasks.set(task.id, task);
    return task;
  }

  public async startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#assertKnownProjectTask(taskId);
    const codexInput = await this.#mapTurnInput(input);
    await this.#resumeTask(taskId);
    const response = expectRecord(
      await this.#client.request("turn/start", {
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        effort: options.reasoningEffort,
        input: codexInput,
        model: options.model,
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        sandboxPolicy: mapSandboxPolicy(options.sandboxMode),
        threadId: taskId,
      }),
      "turn/start response",
    );
    const turn = mapAgentTurn(response["turn"], (part, imageIndex) =>
      this.#mapMessageImage(taskId, part, imageIndex),
    );
    if (turn.status === "running") {
      this.#runningTaskIds.add(taskId);
    }
    return turn;
  }

  public async steerTurn(
    taskId: string,
    turnId: string,
    input: AgentProviderTurnInput,
  ): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const codexInput = await this.#mapTurnInput(input);
    const response = expectRecord(
      await this.#client.request("turn/steer", {
        expectedTurnId: turnId,
        input: codexInput,
        threadId: taskId,
      }),
      "turn/steer response",
    );
    if (response["turnId"] !== turnId) {
      throw new CodexProtocolMappingError("turn/steer returned an unexpected turn id");
    }
  }

  async #mapTurnInput(input: AgentProviderTurnInput) {
    if (input.skills.some((skill) => !this.#skillsById.has(skill.id))) {
      await this.listSkills();
    }
    // 每个引用独立解析为 Codex 原生 Skill part，并保持 Composer 中的选择顺序。
    const skills = input.skills.map((reference) => {
      const skill = this.#skillsById.get(reference.id);
      if (skill?.name !== reference.name) {
        throw new CodexProtocolMappingError("Provider turn skill is unavailable");
      }
      return { name: skill.name, path: skill.path, type: "skill" as const };
    });
    const images = input.images.map((image) => {
      if (!image.url.startsWith(`data:${image.mediaType};base64,`)) {
        throw new CodexProtocolMappingError("Provider image URL does not match its media type");
      }
      return { type: "image" as const, url: image.url };
    });
    const files = input.files.map((file) => ({
      name: file.name,
      path: file.path,
      type: "mention" as const,
    }));
    const textAttachments = input.textAttachments.map((attachment) => ({
      text: attachment.text,
      text_elements: [
        {
          byteRange: { end: Buffer.byteLength(attachment.text, "utf8"), start: 0 },
          placeholder: attachment.name,
        },
      ],
      type: "text" as const,
    }));
    const codexInput = [
      ...skills,
      ...(input.text.length === 0
        ? []
        : [{ text: input.text, text_elements: [], type: "text" as const }]),
      ...textAttachments,
      ...files,
      ...images,
    ];
    if (codexInput.length === 0) {
      throw new CodexProtocolMappingError("Provider turn input must not be empty");
    }
    return codexInput;
  }

  public async startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.#assertKnownProjectTask(taskId);
    const nativeTarget =
      target.type === "uncommitted_changes"
        ? { type: "uncommittedChanges" as const }
        : target.type === "base_branch"
          ? { branch: target.branch, type: "baseBranch" as const }
          : target.type === "commit"
            ? { sha: target.sha, title: target.title ?? null, type: "commit" as const }
            : { instructions: target.instructions, type: "custom" as const };
    // Notification 可能早于 RPC 响应到达，先记录目标以隐藏内部 Prompt 并生成稳定审查 Item。
    this.#activeReviewTargets.set(taskId, target);
    let response: Record<string, unknown>;
    try {
      response = expectRecord(
        await this.#client.request("review/start", {
          delivery: "inline",
          target: nativeTarget,
          threadId: taskId,
        }),
        "review/start response",
      );
    } catch (error) {
      this.#activeReviewTargets.delete(taskId);
      throw error;
    }
    if (expectString(response["reviewThreadId"], "review/start thread id") !== taskId) {
      throw new CodexProtocolMappingError("review/start returned a different thread");
    }
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
      target,
    );
    if (turn.status !== "running") {
      this.#activeReviewTargets.delete(taskId);
    }
    return turn;
  }

  public async interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    expectRecord(
      await this.#client.request("turn/interrupt", { threadId: taskId, turnId }),
      "turn/interrupt response",
    );
  }

  public async listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    this.#assertKnownProjectTask(taskId);
    const terminals: AgentBackgroundTerminal[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    try {
      do {
        const response = expectRecord(
          await this.#client.request("thread/backgroundTerminals/list", {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
            threadId: taskId,
          }),
          "thread/backgroundTerminals/list response",
        );
        if (!Array.isArray(response["data"])) {
          throw new CodexProtocolMappingError("background terminal list data must be an array");
        }
        terminals.push(...response["data"].map(mapBackgroundTerminal));
        const nextCursor = optionalString(response["nextCursor"]);
        if (nextCursor === undefined) {
          cursor = undefined;
        } else {
          if (seenCursors.has(nextCursor)) {
            throw new CodexProtocolMappingError("background terminal list cursor must advance");
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
      } while (cursor !== undefined);
    } catch (error) {
      if (isBackgroundTerminalThreadMissingError(error)) {
        // 历史 Task 可从持久化记录读取，但未加载到当前运行时，因此不可能存在后台终端。
        return { data: [] };
      }
      throw error;
    }

    return { data: terminals };
  }

  public async terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/backgroundTerminals/terminate", {
        processId: terminalId,
        threadId: taskId,
      }),
      "thread/backgroundTerminals/terminate response",
    );
    return expectBoolean(response["terminated"], "background terminal terminate result");
  }

  public async rollbackLatestTurn(taskId: string): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("thread/rollback", { numTurns: 1, threadId: taskId }),
      "thread/rollback response",
    );
    const thread = expectRecord(response["thread"], "thread/rollback thread");
    if (expectString(thread["id"], "thread/rollback thread id") !== taskId) {
      throw new CodexProtocolMappingError("thread/rollback returned a different thread");
    }
    if (!Array.isArray(thread["turns"])) {
      throw new CodexProtocolMappingError("thread/rollback turns must be an array");
    }
  }

  public async uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.#assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.#client.request("feedback/upload", { ...input, threadId: taskId }),
      "feedback/upload response",
    );
    if (expectString(response["threadId"], "feedback/upload thread id") !== taskId) {
      throw new CodexProtocolMappingError("feedback/upload returned a different thread");
    }
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
    const nativeTasks = await Promise.all(
      response["data"].map((thread) =>
        mapAgentTask(expectRecord(thread, "Codex thread"), this.#project),
      ),
    );
    for (const task of nativeTasks) {
      this.#projectTaskIds.add(task.id);
      this.#unmaterializedTasks.delete(task.id);
    }
    // thread/list 可能晚于 thread/start materialize；首屏先合并本地已确认的新 Task。
    const pendingTasks =
      input.cursor === undefined
        ? [...this.#unmaterializedTasks.values()].toSorted((leftTask, rightTask) =>
            rightTask.updatedAt.localeCompare(leftTask.updatedAt),
          )
        : [];
    const data = [...pendingTasks, ...nativeTasks];
    return { data, nextCursor: nextCursor ?? null };
  }

  public async readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined> {
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
        const unmaterializedTask = this.#unmaterializedTasks.get(taskId);
        if (unmaterializedTask !== undefined && isThreadNotMaterializedError(error)) {
          // Codex 在首条用户消息前不允许 includeTurns，返回已知新 Task 的空快照供首轮校验。
          projectOwnershipVerified = true;
          this.#promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        // Codex 用明确的 RPC 错误表示 Task 不存在，其他连接与协议错误继续向上传播。
        if (isThreadNotLoadedError(error)) {
          return undefined;
        }
        throw error;
      }
      const response = expectRecord(nativeResponse, "thread/read response");
      const thread = expectRecord(response["thread"], "thread/read thread");
      if (!(await isProjectThread(thread, this.#project))) {
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.#promotePendingServerRequests(taskId);
      const task = await mapAgentTask(thread, this.#project);
      if (!Array.isArray(thread["turns"])) {
        throw new CodexProtocolMappingError("thread/read turns must be an array");
      }
      const transcriptSkillsByTurnId = await readCodexTranscriptTurnSkills(taskId);
      // Store 为未变化的来源复用随机授权 ID，重复读取不能使已交付的 Snapshot 图片失效。
      const turns = thread["turns"]
        .map((turn) =>
          mapAgentTurn(turn, (part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex)),
        )
        .map((turn) => attachTranscriptSkills(turn, transcriptSkillsByTurnId.get(turn.id) ?? []));
      const status = mapThreadStatus(thread["status"]);
      if (status === "running") {
        this.#runningTaskIds.add(taskId);
      } else {
        this.#runningTaskIds.delete(taskId);
      }
      const snapshot: AgentProviderTaskSnapshot = {
        ...task,
        contextUsage: this.#taskContextUsage.get(taskId) ?? null,
        pendingRequests: [...this.#pendingRequests.values()]
          .map((entry) => entry.request)
          .filter((request) => request.taskId === taskId),
        status,
        turns,
      };
      return snapshot;
    } finally {
      this.#finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  public readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.#projectTaskIds.has(taskId)) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.#historicalAttachments.read(taskId, attachmentId));
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

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.#projectTaskIds.has(taskId)) {
      return "notLoaded";
    }
    if (this.#hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }
    const terminals = await this.listBackgroundTerminals(taskId);
    if (terminals.data.length > 0 || this.#hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }

    const response = expectRecord(
      await this.#client.request("thread/unsubscribe", { threadId: taskId }),
      "thread/unsubscribe response",
    );
    const status = expectString(response["status"], "thread/unsubscribe status");
    if (status !== "notLoaded" && status !== "notSubscribed" && status !== "unsubscribed") {
      throw new CodexProtocolMappingError("thread/unsubscribe returned an unknown status");
    }
    this.#clearTaskRuntimeState(taskId);
    return status;
  }

  public receiveNotification(method: string, params: unknown): void {
    this.#handleNotification(method, params);
  }

  public receiveServerRequest(request: RpcServerRequest): void {
    this.#handleServerRequest(request);
  }

  #handleNotification(method: string, params: unknown): void {
    if (method === "serverRequest/resolved") {
      this.#handleServerRequestResolved(params);
      return;
    }
    let event: AgentProviderEvent | undefined;
    try {
      event = mapCodexNotification(
        method,
        params,
        (taskId, part, imageIndex) => this.#mapMessageImage(taskId, part, imageIndex),
        this.#activeReviewTargets.get(readTaskId(params) ?? ""),
      );
    } catch {
      // 单个原生通知字段漂移不能中断 JSONL Client 或后续关键事件。
      this.#warnDroppedNotification("invalid_notification", method, params);
      return;
    }
    if (event === undefined) {
      if (!CODEX_NOTIFICATION_METHODS.has(method)) {
        this.#warnDroppedNotification("unknown_notification", method, params);
      }
      return;
    }
    if (
      event.type === "usage.updated" &&
      (this.#projectTaskIds.has(event.taskId) || this.#pendingTaskReads.has(event.taskId))
    ) {
      // 快照和实时事件共享同一份最近一轮上下文用量。
      this.#taskContextUsage.set(event.taskId, event.payload.usage);
    }
    if (event.type === "turn.started") {
      this.#runningTaskIds.add(event.taskId);
    }
    if (event.type === "turn.completed") {
      this.#runningTaskIds.delete(event.taskId);
      this.#activeReviewTargets.delete(event.taskId);
      this.#removeQueuedRequestsForTurn(event.taskId, event.turnId);
      for (const entry of [...this.#pendingRequests.values()]) {
        if (entry.request.taskId === event.taskId && entry.request.turnId === event.turnId) {
          this.#terminalizeRequest(entry, "expired");
        }
      }
    }
    this.#routeEvent(event);
  }

  #warnDroppedNotification(
    diagnosticCode: "invalid_notification" | "unknown_notification",
    method: string,
    params: unknown,
  ): void {
    // 原始通知可能包含 Prompt、命令或文件正文，诊断日志只保留关联身份。
    this.#logger.warn(
      {
        codexVersion: SUPPORTED_CODEX_VERSION,
        diagnosticCode,
        method,
        projectId: this.#project.id,
        taskId: readTaskId(params) ?? null,
      },
      "Codex notification dropped",
    );
  }

  #hasTaskLifecycleObligations(taskId: string): boolean {
    return (
      this.#runningTaskIds.has(taskId) ||
      this.#pendingTaskReads.has(taskId) ||
      this.#taskResumePromises.has(taskId) ||
      (this.#pendingTaskServerRequests.get(taskId)?.length ?? 0) > 0 ||
      [...this.#pendingRequests.values()].some((entry) => entry.request.taskId === taskId)
    );
  }

  #clearTaskRuntimeState(taskId: string): void {
    this.#activeReviewTargets.delete(taskId);
    this.#historicalAttachments.clearTask(taskId);
    this.#pendingTaskEvents.delete(taskId);
    this.#pendingTaskServerRequests.delete(taskId);
    this.#pendingTaskReads.delete(taskId);
    this.#projectTaskIds.delete(taskId);
    this.#resumedTaskIds.delete(taskId);
    this.#runningTaskIds.delete(taskId);
    this.#taskContextUsage.delete(taskId);
    this.#taskResumePromises.delete(taskId);
    this.#unmaterializedTasks.delete(taskId);
    for (const [requestId, request] of this.#terminalRequests) {
      if (request.taskId === taskId) {
        this.#terminalRequests.delete(requestId);
      }
    }
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

  #mapMessageImage(
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    if (part["type"] === "image") {
      const url = optionalString(part["url"]);
      if (url === undefined) {
        return undefined;
      }
      const name = optionalString(part["name"]);
      return this.#historicalAttachments.addDataUrl(
        taskId,
        { ...(name === undefined ? {} : { name }), url },
        imageIndex,
      );
    }
    const path = optionalString(part["path"]);
    return path === undefined
      ? undefined
      : this.#historicalAttachments.addLocalImage(taskId, path, imageIndex);
  }

  #assertKnownProjectTask(taskId: string): void {
    if (!this.#projectTaskIds.has(taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }

  async #resumeTask(taskId: string): Promise<void> {
    if (this.#resumedTaskIds.has(taskId)) {
      return;
    }
    const currentResume = this.#taskResumePromises.get(taskId);
    if (currentResume !== undefined) {
      return currentResume;
    }

    const resumePromise = (async () => {
      const response = expectRecord(
        await this.#client.request("thread/resume", { threadId: taskId }),
        "thread/resume response",
      );
      const thread = expectRecord(response["thread"], "thread/resume thread");
      if (expectString(thread["id"], "thread/resume thread id") !== taskId) {
        throw new CodexProtocolMappingError("thread/resume returned a different thread");
      }
      await assertProjectThread(thread, this.#project);
      // 恢复成功后，本次 App Server 生命周期内可直接继续后续 Turn。
      this.#resumedTaskIds.add(taskId);
    })();
    this.#taskResumePromises.set(taskId, resumePromise);
    try {
      await resumePromise;
    } finally {
      if (this.#taskResumePromises.get(taskId) === resumePromise) {
        this.#taskResumePromises.delete(taskId);
      }
    }
  }
}

function readTaskId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value["threadId"] === "string") {
    return value["threadId"];
  }
  const thread = value["thread"];
  return isRecord(thread) && typeof thread["id"] === "string" ? thread["id"] : undefined;
}

class CodexRuntimeProjectProvider implements AgentProvider {
  readonly #delegate: CodexAgentProvider;
  readonly #project: Project;
  readonly #runtime: CodexRuntimeProvider;

  public constructor(
    runtime: CodexRuntimeProvider,
    delegate: CodexAgentProvider,
    project: Project,
  ) {
    this.#delegate = delegate;
    this.#project = project;
    this.#runtime = runtime;
  }

  public async archiveTask(taskId: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.archiveTask(taskId);
  }

  public compactTask(taskId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.compactTask(taskId);
  }

  public async forkTask(taskId: string): Promise<AgentTask> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    const task = await this.#delegate.forkTask(taskId);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return this.#delegate.getCapabilities();
  }

  public interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.interruptTurn(taskId, turnId);
  }

  public listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.listBackgroundTerminals(taskId);
  }

  public terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.terminateBackgroundTerminal(taskId, terminalId);
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return "notLoaded";
    }
    const status = await this.#delegate.unsubscribeTask(taskId);
    if (status !== "busy") {
      this.#runtime.releaseTask(this.#project, taskId);
    }
    return status;
  }

  public listModels(): Promise<AgentModelPage> {
    return this.#delegate.listModels();
  }

  public listMcpServers(): Promise<AgentMcpServerPage> {
    return this.#delegate.listMcpServers();
  }

  public listSkills(): Promise<AgentSkillPage> {
    return this.#delegate.listSkills();
  }

  public readSandboxMode(): Promise<AgentSandboxMode> {
    return this.#delegate.readSandboxMode();
  }

  public async listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage> {
    const page = await this.#delegate.listTasks(input);
    for (const task of page.data) {
      this.#runtime.claimTask(this.#project, task.id);
    }
    return page;
  }

  public async readTask(taskId: string): Promise<AgentProviderTaskSnapshot | undefined> {
    if (!this.#runtime.beginTaskRead(this.#project, taskId)) {
      return undefined;
    }
    try {
      const snapshot = await this.#delegate.readTask(taskId);
      if (snapshot === undefined) {
        this.#runtime.releaseProvisionalTask(this.#project, taskId);
      } else {
        this.#runtime.claimTask(this.#project, taskId);
      }
      return snapshot;
    } catch (error) {
      this.#runtime.releaseProvisionalTask(this.#project, taskId);
      throw error;
    }
  }

  public readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return Promise.resolve(undefined);
    }
    return this.#delegate.readTaskAttachment(taskId, attachmentId);
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.renameTask(taskId, title);
  }

  public resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    this.#runtime.assertTaskOwner(this.#project, input.taskId);
    return this.#delegate.resolvePendingRequest(input);
  }

  public rollbackLatestTurn(taskId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.rollbackLatestTurn(taskId);
  }

  public startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.startReview(taskId, target);
  }

  public async startTask(): Promise<AgentTask> {
    const task = await this.#delegate.startTask();
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.startTurn(taskId, input, options);
  }

  public steerTurn(taskId: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.steerTurn(taskId, turnId, input);
  }

  public subscribeEvents(listener: AgentProviderEventListener): () => void {
    return this.#delegate.subscribeEvents(listener);
  }

  public uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.uploadFeedback(taskId, input);
  }

  async #ensureTaskOwner(taskId: string): Promise<void> {
    if (this.#runtime.isTaskOwner(this.#project, taskId)) {
      return;
    }
    // Sidebar 可直接操作已释放的历史 Task，先重新读取并恢复 Project 归属。
    if ((await this.readTask(taskId)) === undefined) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }
}

type TaskOwner = Readonly<{ projectId: string; provisional: boolean; rootPath: string }>;

export class CodexRuntimeProvider implements AgentRuntimeProvider {
  readonly #client: CodexRpcClient;
  readonly #logger: CodexProviderLogger;
  readonly #projects = new Map<string, Project>();
  readonly #projectProviders = new Map<string, CodexRuntimeProjectProvider>();
  readonly #rawProviders = new Map<string, CodexAgentProvider>();
  readonly #taskOwners = new Map<string, TaskOwner>();

  public constructor(
    client: CodexRpcClient,
    logger: CodexProviderLogger = DEFAULT_PROVIDER_LOGGER,
  ) {
    this.#client = client;
    this.#logger = logger;
    client.onNotification((notification) => {
      const taskId = readTaskId(notification.params);
      if (taskId !== undefined) {
        this.#rawProviders
          .get(this.#taskOwners.get(taskId)?.projectId ?? "")
          ?.receiveNotification(notification.method, notification.params);
      }
    });
    client.onServerRequest((request) => {
      const taskId = readTaskId(request.params);
      const provider =
        taskId === undefined
          ? undefined
          : this.#rawProviders.get(this.#taskOwners.get(taskId)?.projectId ?? "");
      if (provider !== undefined) {
        provider.receiveServerRequest(request);
        return;
      }
      void client
        .rejectServerRequest(request.id, {
          code: -32602,
          data: { method: request.method },
          message: "Task project is unknown",
        })
        .catch(() => undefined);
    });
  }

  public forProject(project: Project): AgentProvider {
    const current = this.#projectProviders.get(project.id);
    if (current !== undefined) {
      const registeredProject = this.#projects.get(project.id);
      if (
        registeredProject === undefined ||
        !isSameResolvedPath(registeredProject.rootPath, project.rootPath)
      ) {
        throw new CodexProtocolMappingError("Codex project identity belongs to another cwd");
      }
      return current;
    }
    const rawProvider = new CodexAgentProvider(this.#client, project, {
      logger: this.#logger,
      subscribeRpc: false,
    });
    const provider = new CodexRuntimeProjectProvider(this, rawProvider, project);
    this.#rawProviders.set(project.id, rawProvider);
    this.#projectProviders.set(project.id, provider);
    this.#projects.set(project.id, project);
    return provider;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        rollback: true,
        start: true,
        steer: true,
      },
    });
  }

  public listModels(): Promise<AgentModelPage> {
    const firstProvider = this.#projectProviders.values().next().value;
    if (firstProvider !== undefined) {
      return firstProvider.listModels();
    }
    const runtimeProject: Project = {
      createdAt: new Date(0).toISOString(),
      id: "runtime",
      name: "Runtime",
      rootPath: resolve("/"),
    };
    return new CodexAgentProvider(this.#client, runtimeProject, {
      logger: this.#logger,
      subscribeRpc: false,
    }).listModels();
  }

  public beginTaskRead(project: Project, taskId: string): boolean {
    const owner = this.#taskOwners.get(taskId);
    if (owner !== undefined) {
      return owner.projectId === project.id && isSameResolvedPath(owner.rootPath, project.rootPath);
    }
    this.#taskOwners.set(taskId, {
      projectId: project.id,
      provisional: true,
      rootPath: project.rootPath,
    });
    return true;
  }

  public claimTask(project: Project, taskId: string): void {
    const owner = this.#taskOwners.get(taskId);
    if (
      owner !== undefined &&
      (owner.projectId !== project.id || !isSameResolvedPath(owner.rootPath, project.rootPath))
    ) {
      throw new CodexProtocolMappingError("Codex thread belongs to another project");
    }
    this.#taskOwners.set(taskId, {
      projectId: project.id,
      provisional: false,
      rootPath: project.rootPath,
    });
  }

  public assertTaskOwner(project: Project, taskId: string): void {
    if (!this.isTaskOwner(project, taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }

  public isTaskOwner(project: Project, taskId: string): boolean {
    const owner = this.#taskOwners.get(taskId);
    return (
      owner !== undefined &&
      !owner.provisional &&
      owner.projectId === project.id &&
      isSameResolvedPath(owner.rootPath, project.rootPath)
    );
  }

  public releaseTask(project: Project, taskId: string): void {
    if (this.isTaskOwner(project, taskId)) {
      this.#taskOwners.delete(taskId);
    }
  }

  public releaseProvisionalTask(project: Project, taskId: string): void {
    const owner = this.#taskOwners.get(taskId);
    if (owner?.provisional === true && owner.projectId === project.id) {
      this.#taskOwners.delete(taskId);
    }
  }
}

export function createCodexRuntimeProvider(
  options: CreateCodexRuntimeProviderOptions,
): CodexRuntimeProvider {
  return new CodexRuntimeProvider(options.client, options.logger);
}
