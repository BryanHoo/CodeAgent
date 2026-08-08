import { Buffer } from "node:buffer";

import { MAX_REALTIME_DIFF_BYTES, MAX_REALTIME_FILE_CHANGES } from "@code-agent/protocol";

import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-mapping-common.js";
import { mapFileChangeKind } from "./codex-tool-mapping.js";

export function boundRealtimeDiff(diff: string, maxBytes = MAX_REALTIME_DIFF_BYTES) {
  const originalByteLength = Buffer.byteLength(diff, "utf8");
  if (originalByteLength <= maxBytes) {
    return { diff, originalByteLength, truncated: false };
  }

  let sourceEnd = Math.min(diff.length, maxBytes);
  const trailingCodeUnit = diff.charCodeAt(sourceEnd - 1);
  if (
    trailingCodeUnit >= 0xd800 &&
    trailingCodeUnit <= 0xdbff &&
    diff.charCodeAt(sourceEnd) >= 0xdc00 &&
    diff.charCodeAt(sourceEnd) <= 0xdfff
  ) {
    sourceEnd -= 1;
  }
  // UTF-8 字节数不会少于 UTF-16 code unit 数，先限制源前缀可避免复制完整超大 diff。
  const encoded = Buffer.from(diff.slice(0, sourceEnd), "utf8");
  let end = Math.min(encoded.length, maxBytes);
  // 回退到当前 UTF-8 字符的起始位置，避免生成包含替换字符的半截文本。
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return {
    diff: encoded.subarray(0, end).toString("utf8"),
    originalByteLength,
    truncated: true,
  };
}

export function mapRealtimeFileChanges(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex file change update must be an array");
  }
  const changes: {
    diff: string;
    kind: "create" | "delete" | "update";
    path: string;
  }[] = [];
  let originalByteLength = 0;
  let remainingBytes = MAX_REALTIME_DIFF_BYTES;
  let truncated = value.length > MAX_REALTIME_FILE_CHANGES;

  for (const [index, entry] of value.entries()) {
    const change = expectRecord(entry, "Codex file change update");
    const diff = expectString(change["diff"], "Codex file change diff");
    const kind = mapFileChangeKind(change["kind"]);
    const path = expectString(change["path"], "Codex file change path");
    if (index >= MAX_REALTIME_FILE_CHANGES) {
      originalByteLength += Buffer.byteLength(diff, "utf8");
      continue;
    }
    const bounded = boundRealtimeDiff(diff, remainingBytes);
    originalByteLength += bounded.originalByteLength;
    changes.push({ diff: bounded.diff, kind, path });
    remainingBytes -= Buffer.byteLength(bounded.diff, "utf8");
    truncated ||= bounded.truncated;
  }

  return { changes, originalByteLength, truncated };
}
