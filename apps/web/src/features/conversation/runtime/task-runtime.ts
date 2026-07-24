import type {
  AgentEvent,
  AgentItem,
  AgentTaskSnapshot,
  AgentTaskSnapshotResponse,
  AgentTurn,
  EventCheckpoint,
  PendingRequest,
} from "@code-agent/protocol";
import type { AgentEventConnectionState } from "@code-agent/client";

const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const MAX_COMMAND_OUTPUT_LINES = 10_000;
const MAX_BUFFERED_DELTA_BYTES = 1_048_576;
const MAX_BUFFERED_DELTA_EVENTS = 1_000;
const textEncoder = new TextEncoder();

export interface TaskRuntimeState {
  checkpoint: EventCheckpoint;
  connectionState: AgentEventConnectionState;
  snapshot: RuntimeTaskSnapshot;
}

// HTTP Snapshot 只含 pending；实时会话额外保留本次连接内的终态展示。
export type RuntimeTaskSnapshot = Omit<AgentTaskSnapshot, "pendingRequests"> &
  Readonly<{ pendingRequests: readonly PendingRequest[] }>;

export function hydrateTaskRuntime(response: AgentTaskSnapshotResponse): TaskRuntimeState {
  return {
    checkpoint: response.checkpoint,
    connectionState: "connecting",
    snapshot: response.snapshot,
  };
}

function updateTurn(
  snapshot: RuntimeTaskSnapshot,
  turnId: string,
  update: (turn: AgentTurn) => AgentTurn,
): RuntimeTaskSnapshot {
  const index = snapshot.turns.findIndex((turn) => turn.id === turnId);
  const turn = snapshot.turns[index];
  if (index < 0 || turn === undefined) {
    return snapshot;
  }
  const turns = [...snapshot.turns];
  turns[index] = update(turn);
  return { ...snapshot, turns };
}

function updateItem(
  turn: AgentTurn,
  itemId: string,
  create: () => AgentItem,
  update: (item: AgentItem) => AgentItem,
): AgentTurn {
  const index = turn.items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return { ...turn, items: [...turn.items, create()] };
  }
  const items = [...turn.items];
  const item = items[index];
  if (item !== undefined) {
    items[index] = update(item);
  }
  return { ...turn, items };
}

function replaceItem(turn: AgentTurn, item: AgentItem): AgentTurn {
  return updateItem(
    turn,
    item.id,
    () => item,
    () => item,
  );
}

function sliceUtf8Tail(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  let start = Math.max(0, encoded.length - maxBytes);

  // 跳过 UTF-8 续字节，避免从多字节字符中间开始解码。
  while (start < encoded.length) {
    const byte = encoded[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    start += 1;
  }
  return new TextDecoder().decode(encoded.subarray(start));
}

function boundCommandOutput(value: string): { output: string; outputTruncated: boolean } {
  let output = value;
  let outputTruncated = false;
  let newlineCount = 0;

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

  if (new TextEncoder().encode(output).byteLength > MAX_COMMAND_OUTPUT_BYTES) {
    output = sliceUtf8Tail(output, MAX_COMMAND_OUTPUT_BYTES);
    outputTruncated = true;
  }
  return { output, outputTruncated };
}

function applyDelta(snapshot: RuntimeTaskSnapshot, event: AgentEvent): RuntimeTaskSnapshot {
  if (
    event.type !== "message.delta" &&
    event.type !== "reasoning.delta" &&
    event.type !== "command.output_delta"
  ) {
    return snapshot;
  }
  return updateTurn(snapshot, event.turnId, (turn) => {
    if (event.type === "message.delta") {
      return updateItem(
        turn,
        event.itemId,
        () => ({
          id: event.itemId,
          role: "assistant",
          text: event.payload.delta,
          type: "message",
        }),
        (item) =>
          item.type === "message" && item.role === "assistant"
            ? { ...item, text: `${item.text}${event.payload.delta}` }
            : item,
      );
    }
    if (event.type === "reasoning.delta") {
      return updateItem(
        turn,
        event.itemId,
        () => ({
          content: event.payload.field === "content" ? event.payload.delta : "",
          id: event.itemId,
          summary: event.payload.field === "summary" ? event.payload.delta : "",
          type: "reasoning",
        }),
        (item) =>
          item.type === "reasoning"
            ? {
                ...item,
                [event.payload.field]: `${item[event.payload.field]}${event.payload.delta}`,
              }
            : item,
      );
    }
    return updateItem(
      turn,
      event.itemId,
      () => {
        const bounded = boundCommandOutput(event.payload.delta);
        return {
          command: "正在执行命令",
          cwd: "",
          id: event.itemId,
          output: bounded.output,
          outputTruncated: bounded.outputTruncated,
          status: "running",
          type: "command",
        };
      },
      (item) => {
        if (item.type !== "command") {
          return item;
        }
        const bounded = boundCommandOutput(`${item.output ?? ""}${event.payload.delta}`);
        return {
          ...item,
          output: bounded.output,
          outputTruncated: item.outputTruncated || bounded.outputTruncated,
        };
      },
    );
  });
}

function upsertPendingRequest(
  snapshot: RuntimeTaskSnapshot,
  request: PendingRequest,
): RuntimeTaskSnapshot {
  const index = snapshot.pendingRequests.findIndex(
    (pendingRequest) => pendingRequest.requestId === request.requestId,
  );
  if (index < 0) {
    return { ...snapshot, pendingRequests: [...snapshot.pendingRequests, request] };
  }
  const pendingRequests = [...snapshot.pendingRequests];
  pendingRequests[index] = request;
  return { ...snapshot, pendingRequests };
}

export function reduceAgentEvent(state: TaskRuntimeState, event: AgentEvent): TaskRuntimeState {
  if (event.taskId !== state.snapshot.id || event.sessionId !== state.checkpoint.sessionId) {
    return state;
  }
  if (event.sequence <= state.checkpoint.sequence) {
    return state;
  }

  let snapshot = state.snapshot;
  switch (event.type) {
    case "turn.started":
      snapshot = {
        ...snapshot,
        status: "running",
        turns: [...snapshot.turns.filter((turn) => turn.id !== event.turnId), event.payload.turn],
        updatedAt: event.timestamp,
      };
      break;
    case "message.delta":
    case "reasoning.delta":
    case "command.output_delta":
      snapshot = { ...applyDelta(snapshot, event), updatedAt: event.timestamp };
      break;
    case "item.completed":
      snapshot = {
        ...updateTurn(snapshot, event.turnId, (turn) => replaceItem(turn, event.payload.item)),
        updatedAt: event.timestamp,
      };
      break;
    case "turn.completed":
      snapshot = {
        ...snapshot,
        status: event.payload.turn.status === "failed" ? "failed" : "idle",
        turns: snapshot.turns.map((turn) => (turn.id === event.turnId ? event.payload.turn : turn)),
        updatedAt: event.timestamp,
      };
      break;
    case "provider.error":
      snapshot = updateTurn(snapshot, event.turnId, (turn) => ({
        ...turn,
        error: event.payload.message,
        status: event.payload.willRetry ? turn.status : "failed",
      }));
      if (!event.payload.willRetry) {
        snapshot = { ...snapshot, status: "failed", updatedAt: event.timestamp };
      }
      break;
    case "pending_request.created":
    case "pending_request.resolved":
    case "pending_request.expired":
      // 生命周期事件共享完整请求载荷，按 requestId 保持原有展示顺序。
      snapshot = {
        ...upsertPendingRequest(snapshot, event.payload.request),
        updatedAt: event.timestamp,
      };
      break;
  }

  return {
    ...state,
    checkpoint: { sequence: event.sequence, sessionId: event.sessionId },
    snapshot,
  };
}

function isDeltaEvent(
  event: AgentEvent,
): event is Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "reasoning.delta" }
> {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

function deltaKey(event: Extract<AgentEvent, { itemId: string }>): string {
  const field = event.type === "reasoning.delta" ? event.payload.field : "value";
  return `${event.taskId}:${event.turnId}:${event.itemId}:${event.type}:${field}`;
}

export class AgentEventBuffer {
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  readonly #events: AgentEvent[] = [];
  #bufferedBytes = 0;

  public constructor(options: Readonly<{ maxBytes?: number; maxEvents?: number }> = {}) {
    this.#maxBytes = options.maxBytes ?? MAX_BUFFERED_DELTA_BYTES;
    this.#maxEvents = options.maxEvents ?? MAX_BUFFERED_DELTA_EVENTS;
    if (!Number.isInteger(this.#maxBytes) || this.#maxBytes <= 0) {
      throw new RangeError("Agent Event buffer maxBytes must be a positive integer");
    }
    if (!Number.isInteger(this.#maxEvents) || this.#maxEvents <= 0) {
      throw new RangeError("Agent Event buffer maxEvents must be a positive integer");
    }
  }

  public push(event: AgentEvent): boolean {
    if (!isDeltaEvent(event)) {
      throw new TypeError("Only Agent Event deltas can be buffered");
    }
    const key = deltaKey(event);
    const previous = this.#events.at(-1);
    const mergesPrevious =
      previous !== undefined && isDeltaEvent(previous) && deltaKey(previous) === key;
    const deltaBytes = textEncoder.encode(event.payload.delta).byteLength;
    const nextEventCount = this.#events.length + (mergesPrevious ? 0 : 1);
    if (nextEventCount > this.#maxEvents || this.#bufferedBytes + deltaBytes > this.#maxBytes) {
      // 溢出后丢弃未确认 Delta，由调用方取消订阅并通过 Snapshot 恢复。
      this.#events.length = 0;
      this.#bufferedBytes = 0;
      return false;
    }
    this.#bufferedBytes += deltaBytes;
    if (!mergesPrevious) {
      this.#events.push(event);
      return true;
    }
    // 仅合并相邻 Delta，避免跨 Item 覆盖较早事件并改变 Timeline 顺序。
    this.#events[this.#events.length - 1] = {
      ...event,
      payload: { ...event.payload, delta: `${previous.payload.delta}${event.payload.delta}` },
    } as AgentEvent;
    return true;
  }

  public drain(): AgentEvent[] {
    return this.flushThrough(Number.POSITIVE_INFINITY);
  }

  public flushThrough(sequence: number): AgentEvent[] {
    const retainedIndex = this.#events.findIndex((event) => event.sequence >= sequence);
    const flushCount = retainedIndex < 0 ? this.#events.length : retainedIndex;
    const flushed = this.#events.splice(0, flushCount);
    for (const event of flushed) {
      if (isDeltaEvent(event)) {
        this.#bufferedBytes -= textEncoder.encode(event.payload.delta).byteLength;
      }
    }
    return flushed;
  }
}
