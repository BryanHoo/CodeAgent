import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";

import type { AgentProviderAttachment } from "@code-agent/core";
import {
  MAX_AGENT_HISTORY_IMAGES,
  MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
  type AgentImageMediaType,
  type AgentMessageAttachment,
} from "@code-agent/protocol";

const DEFAULT_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = MAX_AGENT_HISTORY_IMAGES;
const DEFAULT_MAX_TOTAL_BYTES = MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES;
const DATA_URL_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

type HistoricalFileStats = Readonly<{ isFile: boolean; mtimeMs: number; size: number }>;

export interface CodexHistoricalAttachmentStoreOptions {
  clock?: () => number;
  createId?: () => string;
  maxBytes?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  readFile?: (path: string) => Buffer;
  readHeader?: (path: string) => Buffer;
  statFile?: (path: string) => HistoricalFileStats;
  ttlMs?: number;
}

type StoredAttachmentBase = Readonly<{
  attachment: AgentMessageAttachment;
  expiresAt: number;
  projectTaskId: string;
}>;

type StoredAttachment =
  | (StoredAttachmentBase & Readonly<{ content: Buffer; source: "inline" }>)
  | (StoredAttachmentBase & Readonly<{ mtimeMs: number; path: string; source: "local" }>);

const imageMediaTypesByExtension: Readonly<Record<string, AgentImageMediaType>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function detectImageMediaType(content: Uint8Array): AgentImageMediaType | undefined {
  const header = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  const gifHeader = header.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }
  if (
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function normalizeImageName(value: string | undefined, fallback: string): string {
  const trimmedName = value?.trim();
  return trimmedName === undefined || trimmedName.length === 0
    ? fallback
    : trimmedName.slice(0, 255);
}

function readFileHeader(path: string): Buffer {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(12);
    const bytesRead = readSync(file, header, 0, header.byteLength, 0);
    return header.subarray(0, bytesRead);
  } finally {
    closeSync(file);
  }
}

function readFileStats(path: string): HistoricalFileStats {
  const stats = statSync(path);
  return { isFile: stats.isFile(), mtimeMs: stats.mtimeMs, size: stats.size };
}

export class CodexHistoricalAttachmentStore {
  readonly #clock: () => number;
  readonly #createId: () => string;
  readonly #entries = new Map<string, StoredAttachment>();
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #readFile: (path: string) => Buffer;
  readonly #readHeader: (path: string) => Buffer;
  readonly #statFile: (path: string) => HistoricalFileStats;
  readonly #ttlMs: number;
  #totalBytes = 0;

  public constructor(options: CodexHistoricalAttachmentStoreOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#maxBytes = options.maxBytes ?? MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.#readFile = options.readFile ?? readFileSync;
    this.#readHeader = options.readHeader ?? readFileHeader;
    this.#statFile = options.statFile ?? readFileStats;
    this.#ttlMs = options.ttlMs ?? DEFAULT_ATTACHMENT_TTL_MS;
  }

  public addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    const match = DATA_URL_PATTERN.exec(input.url);
    const encoded = match?.[2];
    const declaredMediaType = match?.[1] as AgentImageMediaType | undefined;
    if (
      encoded === undefined ||
      declaredMediaType === undefined ||
      encoded.length > Math.ceil((this.#maxBytes * 4) / 3) + 4
    ) {
      return undefined;
    }
    const content = Buffer.from(encoded, "base64");
    if (
      content.byteLength === 0 ||
      content.byteLength > this.#maxBytes ||
      content.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "") ||
      detectImageMediaType(content) !== declaredMediaType
    ) {
      return undefined;
    }
    const name = normalizeImageName(input.name, `图片-${String(imageIndex + 1)}`);
    for (const entry of this.#entries.values()) {
      if (
        entry.source === "inline" &&
        entry.projectTaskId === taskId &&
        entry.attachment.mediaType === declaredMediaType &&
        entry.attachment.name === name &&
        entry.content.equals(content)
      ) {
        // 重复 Snapshot 继续使用同一随机授权 ID，避免旧页面引用被后续读取立即作废。
        return this.#refresh(entry);
      }
    }
    const attachment = this.#createAttachment(declaredMediaType, name, content.byteLength);
    if (attachment === undefined) {
      return undefined;
    }
    this.#entries.set(attachment.id, {
      attachment,
      content,
      expiresAt: this.#clock() + this.#ttlMs,
      projectTaskId: taskId,
      source: "inline",
    });
    this.#totalBytes += attachment.size;
    return attachment;
  }

  public addLocalImage(
    taskId: string,
    path: string,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    if (!isAbsolute(path)) {
      return undefined;
    }
    try {
      const stats = this.#statFile(path);
      if (!stats.isFile || stats.size <= 0 || stats.size > this.#maxBytes) {
        return undefined;
      }
      const mediaType = detectImageMediaType(this.#readHeader(path));
      if (mediaType === undefined) {
        return undefined;
      }
      const nativeName = basename(path);
      const expectedMediaType = imageMediaTypesByExtension[extname(nativeName).toLowerCase()];
      const name = normalizeImageName(
        expectedMediaType === mediaType ? nativeName : undefined,
        `图片-${String(imageIndex + 1)}`,
      );
      for (const entry of this.#entries.values()) {
        if (
          entry.source === "local" &&
          entry.projectTaskId === taskId &&
          entry.attachment.mediaType === mediaType &&
          entry.attachment.name === name &&
          entry.attachment.size === stats.size &&
          entry.mtimeMs === stats.mtimeMs &&
          entry.path === path
        ) {
          return this.#refresh(entry);
        }
      }
      const attachment = this.#createAttachment(mediaType, name, stats.size);
      if (attachment === undefined) {
        return undefined;
      }
      this.#entries.set(attachment.id, {
        attachment,
        expiresAt: this.#clock() + this.#ttlMs,
        mtimeMs: stats.mtimeMs,
        path,
        projectTaskId: taskId,
        source: "local",
      });
      this.#totalBytes += attachment.size;
      return attachment;
    } catch {
      // Codex 临时文件可能已被清理，单张图片不可用不应中断历史读取。
      return undefined;
    }
  }

  public read(taskId: string, attachmentId: string): AgentProviderAttachment | undefined {
    this.#pruneExpired();
    const entry = this.#entries.get(attachmentId);
    if (entry?.projectTaskId !== taskId) {
      return undefined;
    }
    if (entry.source === "inline") {
      return { ...entry.attachment, content: entry.content };
    }
    try {
      const stats = this.#statFile(entry.path);
      if (
        !stats.isFile ||
        stats.size !== entry.attachment.size ||
        stats.mtimeMs !== entry.mtimeMs
      ) {
        this.#delete(attachmentId);
        return undefined;
      }
      const content = this.#readFile(entry.path);
      if (
        content.byteLength !== entry.attachment.size ||
        detectImageMediaType(content) !== entry.attachment.mediaType
      ) {
        this.#delete(attachmentId);
        return undefined;
      }
      return { ...entry.attachment, content };
    } catch {
      this.#delete(attachmentId);
      return undefined;
    }
  }

  public clearTask(taskId: string): void {
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.projectTaskId === taskId) {
        this.#delete(attachmentId);
      }
    }
  }

  public clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  #refresh(entry: StoredAttachment): AgentMessageAttachment {
    this.#entries.set(entry.attachment.id, {
      ...entry,
      expiresAt: this.#clock() + this.#ttlMs,
    });
    return entry.attachment;
  }

  #createAttachment(
    mediaType: AgentImageMediaType,
    name: string,
    size: number,
  ): AgentMessageAttachment | undefined {
    if (this.#entries.size >= this.#maxEntries || this.#totalBytes + size > this.#maxTotalBytes) {
      return undefined;
    }
    const id = this.#createId();
    if (id.length === 0 || this.#entries.has(id)) {
      return undefined;
    }
    return { id, mediaType, name, size };
  }

  #delete(attachmentId: string): void {
    const entry = this.#entries.get(attachmentId);
    if (entry !== undefined) {
      this.#entries.delete(attachmentId);
      this.#totalBytes -= entry.attachment.size;
    }
  }

  #pruneExpired(): void {
    const now = this.#clock();
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#delete(attachmentId);
      }
    }
  }
}
