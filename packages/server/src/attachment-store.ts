import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { TextDecoder } from "node:util";

import {
  AGENT_FILE_EXTENSIONS,
  AGENT_FILE_MEDIA_TYPES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type AgentAttachment,
  type AgentAttachmentMediaType,
  type AgentAttachmentUploadRequest,
  type AgentImageMediaType,
} from "@code-agent/protocol";

const DEFAULT_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_TOTAL_BYTES = MAX_AGENT_IMAGE_TOTAL_BYTES + MAX_AGENT_FILE_TOTAL_BYTES;
const DATA_URL_PATTERN =
  /^data:([A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]*);base64,([A-Za-z0-9+/]+={0,2})$/u;
const IMAGE_MEDIA_TYPES = new Set<AgentImageMediaType>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const FILE_EXTENSIONS = new Set<string>(AGENT_FILE_EXTENSIONS);
const FILE_MEDIA_TYPES = new Set<string>(AGENT_FILE_MEDIA_TYPES);

export class AttachmentNotFoundError extends Error {
  public constructor() {
    super("Attachment was not found or has expired");
    this.name = "AttachmentNotFoundError";
  }
}

export interface AttachmentStoreOptions {
  attachmentDirectory?: string;
  clock?: () => number;
  createId?: () => string;
  maxBytes?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
}

interface StoredAttachment {
  attachment: AgentAttachment;
  consumedTurnId?: string;
  expiresAt: number;
  payload: ResolvedAttachment;
  projectId: string;
}

export type ResolvedAttachment =
  | Readonly<{
      kind: "file";
      mediaType: AgentAttachmentMediaType;
      name: string;
      path: string;
      size: number;
    }>
  | Readonly<{
      kind: "image";
      mediaType: AgentImageMediaType;
      size: number;
      url: string;
    }>
  | Readonly<{ kind: "text"; mediaType: "text/plain"; name: string; size: number; text: string }>;

function parseDataUrl(dataUrl: string): Readonly<{
  bytes: number;
  mediaType: AgentAttachmentMediaType;
  value: Buffer;
}> {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  const mediaType = match?.[1];
  const encoded = match?.[2];
  if (encoded === undefined || mediaType === undefined) {
    throw new TypeError("Attachment data URL is invalid");
  }
  const decoded = Buffer.from(encoded, "base64");
  // Buffer 会忽略部分非法输入，因此回编码后再比较规范化内容。
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")
  ) {
    throw new TypeError("Attachment base64 data is invalid");
  }
  return { bytes: decoded.length, mediaType, value: decoded };
}

function isAnimatedGif(value: Buffer): boolean {
  if (value.length < 13) {
    return false;
  }
  let offset = 13;
  const packed = value[10] ?? 0;
  if ((packed & 0x80) !== 0) {
    offset += 3 * 2 ** ((packed & 0x07) + 1);
  }
  let frames = 0;
  while (offset < value.length) {
    const marker = value[offset++];
    if (marker === 0x3b) {
      return frames > 1;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (frames > 1 || offset + 9 > value.length) {
        return frames > 1;
      }
      const imagePacked = value[offset + 8] ?? 0;
      offset += 9;
      if ((imagePacked & 0x80) !== 0) {
        offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
      }
      offset += 1;
    } else if (marker === 0x21) {
      offset += 1;
    } else {
      return false;
    }
    while (offset < value.length) {
      const blockLength = value[offset++] ?? 0;
      if (blockLength === 0) {
        break;
      }
      offset += blockLength;
    }
  }
  return frames > 1;
}

function validateImage(mediaType: AgentAttachmentMediaType, value: Buffer): AgentImageMediaType {
  if (!IMAGE_MEDIA_TYPES.has(mediaType as AgentImageMediaType)) {
    throw new TypeError("Attachment image type is unsupported");
  }
  const valid =
    (mediaType === "image/png" &&
      value.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (mediaType === "image/jpeg" && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) ||
    (mediaType === "image/webp" &&
      value.subarray(0, 4).toString("ascii") === "RIFF" &&
      value.subarray(8, 12).toString("ascii") === "WEBP") ||
    (mediaType === "image/gif" && /^GIF8[79]a$/u.test(value.subarray(0, 6).toString("ascii")));
  if (!valid || (mediaType === "image/gif" && isAnimatedGif(value))) {
    throw new TypeError("Attachment image content is invalid or animated");
  }
  return mediaType;
}

function validateFile(name: string, mediaType: AgentAttachmentMediaType): string {
  const extension = extname(name).toLowerCase();
  if (!FILE_EXTENSIONS.has(extension) && !FILE_MEDIA_TYPES.has(mediaType)) {
    throw new TypeError("Attachment file type is unsupported");
  }
  return extension;
}

export class AttachmentStore {
  readonly #attachmentDirectory: string;
  readonly #clock: () => number;
  readonly #createId: () => string;
  readonly #entries = new Map<string, StoredAttachment>();
  readonly #maxBytes: number | undefined;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #ttlMs: number;
  #totalBytes = 0;

  public constructor(options: AttachmentStoreOptions = {}) {
    this.#attachmentDirectory =
      options.attachmentDirectory ?? join(tmpdir(), `code-agent-attachments-${randomUUID()}`);
    this.#clock = options.clock ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#maxBytes = options.maxBytes;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.#ttlMs = options.ttlMs ?? DEFAULT_ATTACHMENT_TTL_MS;
    mkdirSync(this.#attachmentDirectory, { recursive: true });
  }

  public add(projectId: string, input: AgentAttachmentUploadRequest): AgentAttachment {
    this.#pruneExpired();
    const parsed = parseDataUrl(input.dataUrl);
    const maximumBytes =
      this.#maxBytes ??
      (input.kind === "image" ? MAX_AGENT_IMAGE_TOTAL_BYTES : MAX_AGENT_FILE_BYTES);
    if (parsed.bytes > maximumBytes) {
      throw new RangeError("Attachment exceeds the maximum size");
    }
    if (
      this.#entries.size >= this.#maxEntries ||
      this.#totalBytes + parsed.bytes > this.#maxTotalBytes
    ) {
      throw new RangeError("Attachment store capacity exceeded");
    }
    const id = this.#createId();
    const attachment = {
      id,
      kind: input.kind,
      mediaType: parsed.mediaType,
      name: input.name,
      size: parsed.bytes,
    } satisfies AgentAttachment;
    let payload: ResolvedAttachment;
    if (input.kind === "image") {
      const mediaType = validateImage(parsed.mediaType, parsed.value);
      payload = { kind: "image", mediaType, size: parsed.bytes, url: input.dataUrl };
    } else if (input.kind === "text") {
      if (parsed.mediaType !== "text/plain") {
        throw new TypeError("Generated text attachment must use text/plain");
      }
      payload = {
        kind: "text",
        mediaType: "text/plain",
        name: input.name,
        size: parsed.bytes,
        // fatal 模式拒绝替换字符，避免损坏的粘贴内容静默进入 Prompt。
        text: new TextDecoder("utf-8", { fatal: true }).decode(parsed.value),
      };
    } else {
      const extension = validateFile(input.name, parsed.mediaType);
      const filePath = join(
        this.#attachmentDirectory,
        `${Buffer.from(id).toString("base64url")}${extension}`,
      );
      writeFileSync(filePath, parsed.value, { flag: "wx" });
      payload = {
        kind: "file",
        mediaType: parsed.mediaType,
        name: input.name,
        path: filePath,
        size: parsed.bytes,
      };
    }
    this.#entries.set(id, {
      attachment,
      expiresAt: this.#clock() + this.#ttlMs,
      payload,
      projectId,
    });
    this.#totalBytes += parsed.bytes;
    return attachment;
  }

  public resolve(projectId: string, ids: readonly string[]): readonly ResolvedAttachment[] {
    this.#pruneExpired();
    return ids.map((id) => {
      const entry = this.#entries.get(id);
      if (entry?.projectId !== projectId || entry.consumedTurnId !== undefined) {
        throw new AttachmentNotFoundError();
      }
      return entry.payload;
    });
  }

  public consume(projectId: string, ids: readonly string[], turnId?: string): void {
    for (const id of new Set(ids)) {
      const entry = this.#entries.get(id);
      if (entry?.projectId !== projectId) {
        continue;
      }
      if (entry.payload.kind === "file" && turnId !== undefined) {
        // Mention 路径要保留到 Turn 结束，Codex 才能在后续工具调用中读取文件。
        entry.consumedTurnId = turnId;
        entry.expiresAt = this.#clock() + this.#ttlMs;
      } else {
        this.#delete(id);
      }
    }
  }

  public releaseTurn(projectId: string, turnId: string): void {
    for (const [id, entry] of this.#entries) {
      if (entry.projectId === projectId && entry.consumedTurnId === turnId) {
        this.#delete(id);
      }
    }
  }

  public clear(): void {
    for (const id of [...this.#entries.keys()]) {
      this.#delete(id);
    }
  }

  public dispose(): void {
    this.clear();
    rmSync(this.#attachmentDirectory, { force: true, recursive: true });
  }

  #delete(id: string): void {
    const entry = this.#entries.get(id);
    if (entry !== undefined) {
      this.#entries.delete(id);
      this.#totalBytes -= entry.attachment.size;
      if (entry.payload.kind === "file" && existsSync(entry.payload.path)) {
        unlinkSync(entry.payload.path);
      }
    }
  }

  #pruneExpired(): void {
    const now = this.#clock();
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#delete(id);
      }
    }
  }
}
