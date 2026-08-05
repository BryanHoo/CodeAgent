import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AgentProviderEvent, AgentProviderTaskSnapshot } from "@code-agent/core";
import type {
  AgentBackgroundTerminal,
  AgentContextUsage,
  AgentItem,
  AgentItemStatus,
  AgentMessageAttachment,
  AgentTurn,
  AgentModelPage,
  AgentReviewTarget,
  AgentSandboxMode,
  AgentSkillPage,
  PendingApprovalDecision,
  PendingRequest,
  Project,
} from "@code-agent/protocol";
import type { RpcRequestId, RpcServerRequest } from "./jsonl-rpc-client.js";
import { extractCodexTextSkills } from "./codex-transcript.js";

export class CodexProtocolMappingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodexProtocolMappingError";
  }
}

const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES = 10_000;
export const CODEX_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
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

export interface PendingCodexRequest {
  denyDecision?: "cancel" | "decline";
  providerRequestId: RpcRequestId;
  request: PendingRequest & { status: "pending" };
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

export type CodexSkill = Readonly<{
  description: string;
  displayName: string;
  enabled: boolean;
  id: string;
  name: string;
  path: string;
  scope: AgentSkillPage["data"][number]["scope"];
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CodexProtocolMappingError(`${context} must be an object`);
  }
  return value;
}

export function mapSandboxMode(value: unknown): AgentSandboxMode {
  if (value === null) {
    // Codex 未配置时采用其交互式编码安全默认值。
    return "workspace-write";
  }
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new CodexProtocolMappingError("config/read sandbox_mode is invalid");
}

export function mapSandboxPolicy(mode: AgentSandboxMode): CodexSandboxPolicy {
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

export function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new CodexProtocolMappingError(`${context} must be a string`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function mapBackgroundTerminal(value: unknown): AgentBackgroundTerminal {
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

export function expectBoolean(value: unknown, context: string): boolean {
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

export function mapCodexSkill(value: unknown): CodexSkill {
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

export function requestIdKey(id: RpcRequestId): string {
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

export function userInputAnswersMatchRequest(
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

export function mapCodexServerRequest(
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

export function toDateTime(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a Unix timestamp`);
  }
  return new Date(value * 1_000).toISOString();
}

function toNullableDateTime(value: unknown, context: string): string | null {
  return value === null || value === undefined ? null : toDateTime(value, context);
}

export function normalizedTitle(thread: Record<string, unknown>): string {
  const name = optionalString(thread["name"])?.trim();
  if (name) {
    return name;
  }
  const preview = optionalString(thread["preview"])?.trim().split(/\r?\n/u)[0]?.trim();
  // Codex 生成正式标题前统一显示新聊天，后续列表刷新会自然替换为 name 或 preview。
  return preview?.length ? preview : "新聊天";
}

export function mapAgentModel(value: unknown): AgentModelPage["data"][number] | undefined {
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

export function mapContextUsage(value: unknown): AgentContextUsage {
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

export function mapThreadStatus(value: unknown): AgentProviderTaskSnapshot["status"] {
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

type MapCodexMessageText = (
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
) => AgentMessageAttachment | undefined;

const codexTextEncoder = new TextEncoder();
const codexTextDecoder = new TextDecoder("utf-8", { fatal: true });

function mapCodexTextPart(
  part: Record<string, unknown>,
  textIndex: number,
  mapText: MapCodexMessageText,
): Readonly<{ attachments: AgentMessageAttachment[]; text: string }> {
  const text = expectString(part["text"], "Codex user message text");
  const nativeElements = part["text_elements"];
  if (!Array.isArray(nativeElements) || nativeElements.length === 0) {
    return { attachments: [], text };
  }

  const encodedText = codexTextEncoder.encode(text);
  const ranges: { end: number; name: string; start: number }[] = [];
  for (const value of nativeElements) {
    if (!isRecord(value) || !isRecord(value["byteRange"])) {
      return { attachments: [], text };
    }
    const range = value["byteRange"];
    const start = range["start"];
    const end = range["end"];
    const placeholder = value["placeholder"];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      start < 0 ||
      end <= start ||
      end > encodedText.byteLength ||
      typeof placeholder !== "string" ||
      placeholder.trim().length === 0
    ) {
      return { attachments: [], text };
    }
    ranges.push({ end, name: placeholder.trim().slice(0, 255), start });
  }
  ranges.sort((left, right) => left.start - right.start);

  const attachments: AgentMessageAttachment[] = [];
  const visibleText: string[] = [];
  let cursor = 0;
  try {
    for (const range of ranges) {
      if (range.start < cursor) {
        return { attachments: [], text };
      }
      const prefix = codexTextDecoder.decode(encodedText.subarray(cursor, range.start));
      if (prefix.length > 0) {
        visibleText.push(prefix);
      }
      const attachmentText = codexTextDecoder.decode(encodedText.subarray(range.start, range.end));
      const attachment = mapText(
        { name: range.name, text: attachmentText },
        textIndex + attachments.length,
      );
      if (attachment === undefined) {
        visibleText.push(`@${range.name}`);
      } else {
        attachments.push(attachment);
      }
      cursor = range.end;
    }
    const suffix = codexTextDecoder.decode(encodedText.subarray(cursor));
    if (suffix.length > 0) {
      visibleText.push(suffix);
    }
  } catch {
    // 非法 UTF-8 字节边界不能吞掉用户内容，退回原始文本显示。
    return { attachments: [], text };
  }
  return { attachments, text: visibleText.join("") };
}

function mapUserMessageContent(
  value: unknown,
  mapImage: MapCodexMessageImage,
  mapText: MapCodexMessageText,
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
  let imageIndex = 0;
  let textIndex = 0;

  for (const part of value) {
    if (!isRecord(part)) {
      continue;
    }
    if (part["type"] === "text" && typeof part["text"] === "string") {
      const mappedText = mapCodexTextPart(part, textIndex, mapText);
      attachments.push(...mappedText.attachments);
      textIndex += mappedText.attachments.length;
      const textContent = extractCodexTextSkills(mappedText.text);
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
      const attachment = mapImage(part, imageIndex);
      imageIndex += 1;
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
  mapText: MapCodexMessageText = () => undefined,
): AgentItem {
  const item = expectRecord(value, "Codex item");
  const id = expectString(item["id"], "Codex item id");
  const type = expectString(item["type"], "Codex item type");

  switch (type) {
    case "userMessage": {
      const content = mapUserMessageContent(item["content"], mapImage, mapText);
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
      // Codex 将最终审查结论放在 exitedReviewMode.review，而不是 agentMessage。
      return {
        id,
        role: "assistant",
        text: expectString(item["review"], "Codex review result"),
        type: "message",
      };
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

export function mapAgentTurn(
  value: unknown,
  mapImage: MapCodexMessageImage = () => undefined,
  mapText: MapCodexMessageText = () => undefined,
  explicitReviewTarget?: AgentReviewTarget,
  explicitTurnId?: string,
  reviewWorker = false,
  suppressReviewResult = false,
): AgentTurn {
  const turn = expectRecord(value, "Codex turn");
  if (!Array.isArray(turn["items"])) {
    throw new CodexProtocolMappingError("Codex turn items must be an array");
  }
  const turnId = explicitTurnId ?? expectString(turn["id"], "Codex turn id");
  const nativeItems = turn["items"].map((item) => expectRecord(item, "Codex turn item"));
  const enteredReviewMode = nativeItems.find((item) => item["type"] === "enteredReviewMode");
  const exitedReviewMode = nativeItems.findLast(
    (item) =>
      item["type"] === "exitedReviewMode" &&
      typeof item["review"] === "string" &&
      item["review"].trim().length > 0,
  );
  const interruptedReviewMessage = nativeItems.findLast(
    (item) =>
      item["type"] === "agentMessage" &&
      item["phase"] !== "commentary" &&
      typeof item["text"] === "string" &&
      item["text"].trim().length > 0,
  );
  const inferredReviewTarget = nativeItems
    .map(inferReviewTargetFromPrompt)
    .find((target) => target !== undefined);
  const reviewTarget =
    explicitReviewTarget ??
    (enteredReviewMode === undefined
      ? inferredReviewTarget
      : mapReviewHint(expectString(enteredReviewMode["review"], "Codex review mode hint")));
  const isReviewTurn =
    explicitReviewTarget !== undefined ||
    enteredReviewMode !== undefined ||
    nativeItems.some((item) => item["type"] === "exitedReviewMode");
  const reviewResultItem = exitedReviewMode ?? interruptedReviewMessage;
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
    items: reviewWorker
      ? mergeExpandedSkillMessages([
          ...(reviewTarget === undefined ? [] : [createReviewItem(turnId, reviewTarget)]),
          ...nativeItems.flatMap((item) =>
            item["type"] === "userMessage" ||
            item["type"] === "enteredReviewMode" ||
            item["type"] === "exitedReviewMode"
              ? []
              : [mapAgentItem(item, subagentNicknames, mapImage, mapText)],
          ),
        ])
      : isReviewTurn
        ? [
            ...(reviewTarget === undefined ? [] : [createReviewItem(turnId, reviewTarget)]),
            ...(reviewResultItem === undefined || suppressReviewResult
              ? []
              : [mapAgentItem(reviewResultItem, subagentNicknames, mapImage, mapText)]),
          ]
        : mergeExpandedSkillMessages(
            nativeItems.map((item) => mapAgentItem(item, subagentNicknames, mapImage, mapText)),
          ),
    startedAt: toNullableDateTime(turn["startedAt"], "Codex turn startedAt"),
    status: mapTurnStatus(turn["status"]),
  };
}

export function mapAgentTurns(
  values: readonly unknown[],
  mapImage: MapCodexMessageImage = () => undefined,
  mapText: MapCodexMessageText = () => undefined,
): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (let turnIndex = 0; turnIndex < values.length; turnIndex += 1) {
    const nativeTurn = expectRecord(values[turnIndex], "Codex turn");
    const mappedTurn = mapAgentTurn(nativeTurn, mapImage, mapText);
    const nativeItems = Array.isArray(nativeTurn["items"])
      ? nativeTurn["items"].map((item) => expectRecord(item, "Codex turn item"))
      : [];
    const isReviewContainer = nativeItems.some(
      (item) => item["type"] === "enteredReviewMode" || item["type"] === "exitedReviewMode",
    );
    const nextNativeTurn = values[turnIndex + 1];
    if (!isReviewContainer || nextNativeTurn === undefined) {
      turns.push(mappedTurn);
      continue;
    }

    const workerTurn = expectRecord(nextNativeTurn, "Codex reviewer turn");
    const workerItems = Array.isArray(workerTurn["items"])
      ? workerTurn["items"].map((item) => expectRecord(item, "Codex reviewer item"))
      : [];
    const isReviewerWorker = workerItems.some(
      (item) => item["type"] === "userMessage" && inferReviewTargetFromPrompt(item) !== undefined,
    );
    if (!isReviewerWorker) {
      turns.push(mappedTurn);
      continue;
    }

    const mappedWorker = mapAgentTurn(workerTurn, mapImage, mapText);
    const visibleWorkerItems = mappedWorker.items.filter(
      (item) => item.type !== "message" || item.role !== "user",
    );
    const hasWorkerResponse = visibleWorkerItems.some(
      (item) => item.type === "message" && item.role === "assistant",
    );
    const hasOuterReviewExit = nativeItems.some((item) => item["type"] === "exitedReviewMode");
    const reviewRequestItems = mappedTurn.items.filter((item) => item.type === "review");
    const outerFallbackItems = hasWorkerResponse
      ? []
      : mappedTurn.items.filter((item) => item.type === "message" && item.role === "assistant");
    turns.push({
      completedAt: hasOuterReviewExit ? (mappedTurn.completedAt ?? mappedWorker.completedAt) : null,
      error: mappedWorker.error ?? mappedTurn.error,
      id: mappedTurn.id,
      items: [...reviewRequestItems, ...visibleWorkerItems, ...outerFallbackItems],
      startedAt: mappedWorker.startedAt ?? mappedTurn.startedAt,
      status: hasOuterReviewExit ? mappedWorker.status : "running",
    });
    turnIndex += 1;
  }
  return turns;
}

export function attachTranscriptSkills(turn: AgentTurn, skillNames: readonly string[]): AgentTurn {
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

export function mapCodexNotification(
  method: string,
  value: unknown,
  mapImage: (
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ) => AgentMessageAttachment | undefined,
  mapText: (
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ) => AgentMessageAttachment | undefined,
  reviewTarget?: AgentReviewTarget,
  explicitTurnId?: string,
  reviewWorker = false,
  suppressReviewResult = false,
  explicitTaskId?: string,
): AgentProviderEvent | undefined {
  if (!CODEX_NOTIFICATION_METHODS.has(method)) {
    return undefined;
  }

  const params = expectRecord(value, `Codex ${method} params`);
  const taskId = explicitTaskId ?? expectString(params["threadId"], `Codex ${method} threadId`);

  if (method === "thread/tokenUsage/updated") {
    return {
      payload: { usage: mapContextUsage(params["tokenUsage"]) },
      taskId,
      turnId: explicitTurnId ?? expectString(params["turnId"], "Codex token usage turnId"),
      type: "usage.updated",
    };
  }

  if (method === "turn/started" || method === "turn/completed") {
    const turn = mapAgentTurn(
      params["turn"],
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
      reviewTarget,
      explicitTurnId,
      reviewWorker,
      suppressReviewResult,
    );
    return {
      payload: { turn },
      taskId,
      turnId: turn.id,
      type: method === "turn/started" ? "turn.started" : "turn.completed",
    };
  }

  const turnId = explicitTurnId ?? expectString(params["turnId"], `Codex ${method} turnId`);
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
    const item = mapAgentItem(
      nativeItem,
      new Map(),
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
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
