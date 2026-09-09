import type { AgentEvent, AgentItem } from "@/protocol/index.js";
import { createStore, type StoreApi } from "zustand/vanilla";

import { estimateRetainedBytes, getUtf8ByteLength } from "../../../shared/memory/byte-lru.js";
import { AppendOnlyTextBuffer, type TextSnapshot } from "../../../shared/lib/append-only-text.js";
import { CommandOutputBuffer, type CommandOutputView } from "./command-output-buffer.js";

export const RETAINED_COMMAND_OUTPUT_MARKER = "__CODEXLY_RETAINED_COMMAND_OUTPUT__";

export interface TaskItemStoreState {
  revision: number;
}

type DeltaEvent = Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
>;

export interface TaskItemStore extends StoreApi<TaskItemStoreState> {
  appendDelta: (event: DeltaEvent) => boolean;
  getRetainedBytes: () => number;
  hasReasoningSummary: () => boolean;
  peek: () => AgentItem;
  publish: () => void;
  read: () => AgentItem;
  readCommandOutput: () => CommandOutputView | undefined;
  readText: () => TextSnapshot | undefined;
  replace: (item: AgentItem) => void;
}

type StreamedTextField = "content" | "plan" | "summary" | "text";

function createBaseItem(item: AgentItem): AgentItem {
  if (item.type !== "command" || item.output === RETAINED_COMMAND_OUTPUT_MARKER) {
    return item;
  }
  const baseCommand = { ...item };
  delete baseCommand.output;
  return baseCommand;
}

export function createTaskItemStore(initialItem: AgentItem): TaskItemStore {
  let baseItem = createBaseItem(initialItem);
  // Delta 热路径只追加 Chunk；完整字符串仅在目标 Item 被读取时延迟物化并缓存。
  const chunksByField = new Map<StreamedTextField, AppendOnlyTextBuffer>();
  let contentGeneration = 0;
  let materializedGeneration = initialItem.type === "command" ? -1 : 0;
  let materializedItem = baseItem;
  let summarySectionIndex: number | undefined;
  let summaryLength = initialItem.type === "reasoning" ? initialItem.summary.length : 0;
  let hasSummary = initialItem.type === "reasoning" && initialItem.summary.trim().length > 0;
  let commandOutputBuffer =
    initialItem.type === "command"
      ? new CommandOutputBuffer(initialItem.output, initialItem.outputOmitted)
      : undefined;
  let retainedBytes =
    estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
  const store = createStore<TaskItemStoreState>()(() => ({ revision: 0 }));

  function textBuffer(field: StreamedTextField): AppendOnlyTextBuffer {
    let buffer = chunksByField.get(field);
    if (buffer === undefined) {
      const initialText = baseItem.type === "reasoning"
        ? (field === "summary" ? baseItem.summary : baseItem.content)
        : baseItem.type === "message" || baseItem.type === "plan" ? baseItem.text : "";
      buffer = new AppendOnlyTextBuffer(initialText);
      chunksByField.set(field, buffer);
    }
    return buffer;
  }

  function appendChunk(field: StreamedTextField, delta: string): void {
    textBuffer(field).append(delta);
    if (field === "summary") {
      summaryLength += delta.length;
      // 可见性只检查新增文本，首次出现内容后不再扫描历史摘要。
      hasSummary ||= delta.trim().length > 0;
    }
    retainedBytes += getUtf8ByteLength(delta);
    contentGeneration += 1;
  }

  return Object.assign(store, {
    appendDelta(event: DeltaEvent): boolean {
      if (event.type === "message.delta") {
        if (baseItem.type !== "message" || baseItem.role !== "assistant") {
          return false;
        }
        appendChunk("text", event.payload.delta);
        return true;
      }
      if (event.type === "reasoning.delta") {
        if (baseItem.type !== "reasoning") {
          return false;
        }
        if (event.payload.field === "summary" && event.payload.sectionIndex !== undefined) {
          const startsNewSection =
            summarySectionIndex === undefined
              ? event.payload.sectionIndex > 0
              : event.payload.sectionIndex !== summarySectionIndex;
          if (startsNewSection && summaryLength > 0) {
            // Codex 只传分段索引；用空行保留摘要段落边界，避免不同主题粘连。
            appendChunk("summary", "\n\n");
          }
          summarySectionIndex = event.payload.sectionIndex;
        }
        appendChunk(event.payload.field, event.payload.delta);
        return true;
      }
      if (event.type === "plan.delta") {
        if (baseItem.type !== "plan") {
          return false;
        }
        appendChunk("plan", event.payload.delta);
        return true;
      }
      if (baseItem.type !== "command") {
        return false;
      }
      const previousOutputBytes = commandOutputBuffer?.getView().outputBytes ?? 0;
      commandOutputBuffer?.append(event.payload.delta);
      retainedBytes += (commandOutputBuffer?.getView().outputBytes ?? 0) - previousOutputBytes;
      contentGeneration += 1;
      return true;
    },
    getRetainedBytes: (): number => retainedBytes,
    hasReasoningSummary: (): boolean => hasSummary,
    peek: (): AgentItem => baseItem,
    publish(): void {
      store.setState((state) => ({ revision: state.revision + 1 }));
    },
    read(): AgentItem {
      if (materializedGeneration === contentGeneration) {
        return materializedItem;
      }
      let nextItem = baseItem;
      if (baseItem.type === "message" || baseItem.type === "plan") {
        const chunks = chunksByField.get(baseItem.type === "plan" ? "plan" : "text");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: chunks.materialize() };
        }
      } else if (baseItem.type === "reasoning") {
        const contentChunks = chunksByField.get("content");
        const summaryChunks = chunksByField.get("summary");
        if (contentChunks !== undefined || summaryChunks !== undefined) {
          nextItem = {
            ...baseItem,
            content: contentChunks?.materialize() ?? baseItem.content,
            summary: summaryChunks?.materialize() ?? baseItem.summary,
          };
        }
      } else if (baseItem.type === "command") {
        const commandOutput = commandOutputBuffer?.getView();
        if (commandOutput !== undefined) {
          nextItem = {
            ...baseItem,
            ...(commandOutput.hasOutput ? { output: commandOutput.materialize() } : {}),
            outputOmitted: commandOutput.outputOmitted,
          };
        }
      }
      materializedItem = nextItem;
      materializedGeneration = contentGeneration;
      return materializedItem;
    },
    readCommandOutput(): CommandOutputView | undefined {
      return commandOutputBuffer?.getView();
    },
    readText(): TextSnapshot | undefined {
      if (baseItem.type === "reasoning") return textBuffer("summary").getSnapshot();
      if (baseItem.type === "plan") return textBuffer("plan").getSnapshot();
      if (baseItem.type === "message") return textBuffer("text").getSnapshot();
      return undefined;
    },
    replace(item: AgentItem): void {
      baseItem = createBaseItem(item);
      chunksByField.clear();
      summarySectionIndex = undefined;
      summaryLength = item.type === "reasoning" ? item.summary.length : 0;
      hasSummary = item.type === "reasoning" && item.summary.trim().length > 0;
      commandOutputBuffer =
        item.type === "command"
          ? new CommandOutputBuffer(item.output, item.outputOmitted)
          : undefined;
      retainedBytes =
        estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
      contentGeneration += 1;
    },
  });
}
