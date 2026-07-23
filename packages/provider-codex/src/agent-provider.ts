import { Buffer } from "node:buffer";
import { resolve } from "node:path";

import type { AgentProvider, ListAgentTasksInput } from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentItem,
  AgentItemStatus,
  AgentTask,
  AgentTaskPage,
  AgentTaskSnapshot,
  AgentTurn,
  Project,
} from "@code-agent/protocol";

import { RpcResponseError } from "./jsonl-rpc-client.js";

export interface CodexRpcClient {
  notify(method: string, params?: unknown): void;
  request(method: string, params?: unknown): Promise<unknown>;
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
  readonly #project: Project;

  public constructor(client: CodexRpcClient, project: Project) {
    this.#client = client;
    this.#project = project;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({ provider: "codex", tasks: { list: true, read: true } });
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
    return {
      data: response["data"].map((thread) =>
        mapAgentTask(expectRecord(thread, "Codex thread"), this.#project),
      ),
      nextCursor: nextCursor ?? null,
    };
  }

  public async readTask(taskId: string): Promise<AgentTaskSnapshot | undefined> {
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
    const task = mapAgentTask(thread, this.#project);
    if (!Array.isArray(thread["turns"])) {
      throw new CodexProtocolMappingError("thread/read turns must be an array");
    }
    return {
      ...task,
      status: mapThreadStatus(thread["status"]),
      turns: thread["turns"].map(mapAgentTurn),
    };
  }
}

export function createCodexAgentProvider(
  options: CreateCodexAgentProviderOptions,
): CodexAgentProvider {
  // App Server Runtime 已完成握手；Provider 只负责统一只读能力与字段映射。
  return new CodexAgentProvider(options.client, options.project);
}
