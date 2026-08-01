import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

import {
  MAX_AGENT_ATTACHMENT_BYTES,
  type AgentAttachment,
  type AgentAttachmentMediaType,
  type AgentAttachmentUploadRequest,
} from "@code-agent/protocol";

const DEFAULT_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const DATA_URL_PATTERN =
  /^data:(image\/(?:gif|jpeg|png|webp)|text\/plain);base64,([A-Za-z0-9+/]+={0,2})$/u;

export class AttachmentNotFoundError extends Error {
  public constructor() {
    super("Attachment was not found or has expired");
    this.name = "AttachmentNotFoundError";
  }
}

export interface AttachmentStoreOptions {
  clock?: () => number;
  createId?: () => string;
  maxBytes?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
}

interface StoredAttachment {
  attachment: AgentAttachment;
  expiresAt: number;
  payload: ResolvedAttachment;
  projectId: string;
}

export type ResolvedAttachment =
  | Readonly<{ mediaType: "text/plain"; name: string; text: string }>
  | Readonly<{ mediaType: Exclude<AgentAttachmentMediaType, "text/plain">; url: string }>;

function parseDataUrl(dataUrl: string): Readonly<{
  bytes: number;
  mediaType: AgentAttachmentMediaType;
  value: Buffer;
}> {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  const encoded = match?.[2];
  const mediaType = match?.[1];
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
  return {
    bytes: decoded.length,
    mediaType: mediaType as AgentAttachmentMediaType,
    value: decoded,
  };
}

export class AttachmentStore {
  readonly #clock: () => number;
  readonly #createId: () => string;
  readonly #entries = new Map<string, StoredAttachment>();
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #ttlMs: number;
  #totalBytes = 0;

  public constructor(options: AttachmentStoreOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#maxBytes = options.maxBytes ?? MAX_AGENT_ATTACHMENT_BYTES;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.#ttlMs = options.ttlMs ?? DEFAULT_ATTACHMENT_TTL_MS;
  }

  public add(projectId: string, input: AgentAttachmentUploadRequest): AgentAttachment {
    this.#pruneExpired();
    const parsed = parseDataUrl(input.dataUrl);
    if (parsed.bytes > this.#maxBytes) {
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
      mediaType: parsed.mediaType,
      name: input.name,
      size: parsed.bytes,
    } satisfies AgentAttachment;
    this.#entries.set(id, {
      attachment,
      expiresAt: this.#clock() + this.#ttlMs,
      payload:
        parsed.mediaType === "text/plain"
          ? {
              mediaType: "text/plain",
              name: input.name,
              // fatal 模式拒绝替换字符，避免损坏的粘贴内容静默进入 Prompt。
              text: new TextDecoder("utf-8", { fatal: true }).decode(parsed.value),
            }
          : { mediaType: parsed.mediaType, url: input.dataUrl },
      projectId,
    });
    this.#totalBytes += parsed.bytes;
    return attachment;
  }

  public resolve(projectId: string, ids: readonly string[]): readonly ResolvedAttachment[] {
    this.#pruneExpired();
    return ids.map((id) => {
      const entry = this.#entries.get(id);
      if (entry?.projectId !== projectId) {
        throw new AttachmentNotFoundError();
      }
      return entry.payload;
    });
  }

  public consume(projectId: string, ids: readonly string[]): void {
    for (const id of new Set(ids)) {
      if (this.#entries.get(id)?.projectId === projectId) {
        this.#delete(id);
      }
    }
  }

  public clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  #delete(id: string): void {
    const entry = this.#entries.get(id);
    if (entry !== undefined) {
      this.#entries.delete(id);
      this.#totalBytes -= entry.attachment.size;
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
