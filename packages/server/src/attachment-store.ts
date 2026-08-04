import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TextDecoder } from "node:util";

import {
  AGENT_FILE_EXTENSIONS,
  AGENT_FILE_MEDIA_TYPES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachment,
  type AgentAttachmentKind,
  type AgentAttachmentMediaType,
  type AgentImageMediaType,
} from "@code-agent/protocol";

const DEFAULT_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_TOTAL_BYTES = MAX_AGENT_IMAGE_TOTAL_BYTES + MAX_AGENT_FILE_TOTAL_BYTES;
const IMAGE_EXTENSIONS = new Map<AgentImageMediaType, string>([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
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

export type AttachmentUploadInput = Readonly<{
  content: Readable;
  kind: AgentAttachmentKind;
  mediaType: AgentAttachmentMediaType;
  name: string;
}>;

export type StoredAttachmentUpload = Readonly<{
  attachment: AgentAttachment;
  contentDigest: string;
}>;

export type StoredAttachmentContent = Readonly<{
  attachment: AgentAttachment;
  content: Buffer;
}>;

interface StoredAttachment {
  attachment: AgentAttachment;
  consumedTurnId?: string;
  expiresAt: number;
  path: string;
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

function maximumBytesFor(kind: AgentAttachmentKind): number {
  if (kind === "image") {
    return MAX_AGENT_IMAGE_BYTES;
  }
  return kind === "text" ? MAX_AGENT_TEXT_BYTES : MAX_AGENT_FILE_BYTES;
}

function validateUploadMetadata(input: AttachmentUploadInput): string {
  if (input.name.length === 0 || input.name.length > 255 || input.mediaType.length > 255) {
    throw new TypeError("Attachment metadata is invalid");
  }
  if (input.kind === "image") {
    const extension = IMAGE_EXTENSIONS.get(input.mediaType as AgentImageMediaType);
    if (extension === undefined) {
      throw new TypeError("Attachment image type is unsupported");
    }
    return extension;
  }
  if (input.kind === "text") {
    if (input.mediaType !== "text/plain") {
      throw new TypeError("Generated text attachment must use text/plain");
    }
    return ".txt";
  }
  const extension = extname(input.name).toLowerCase();
  if (!FILE_EXTENSIONS.has(extension) && !FILE_MEDIA_TYPES.has(input.mediaType)) {
    throw new TypeError("Attachment file type is unsupported");
  }
  return extension;
}

async function readHeader(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const value = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(value, 0, bytes, 0);
    return value.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function isAnimatedGif(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  let position = 13;
  let frames = 0;
  const readAt = async (length: number): Promise<Buffer | undefined> => {
    const value = Buffer.alloc(length);
    const { bytesRead } = await handle.read(value, 0, length, position);
    if (bytesRead !== length) {
      return undefined;
    }
    position += length;
    return value;
  };
  const skipBlocks = async (): Promise<boolean> => {
    for (;;) {
      const length = (await readAt(1))?.[0];
      if (length === undefined) {
        return false;
      }
      if (length === 0) {
        return true;
      }
      if ((await readAt(length)) === undefined) {
        return false;
      }
    }
  };

  try {
    const header = await readHeader(path, 13);
    const packed = header[10];
    if (header.length < 13 || packed === undefined) {
      return false;
    }
    if ((packed & 0x80) !== 0) {
      position += 3 * 2 ** ((packed & 0x07) + 1);
    }
    for (;;) {
      const marker = (await readAt(1))?.[0];
      if (marker === undefined || marker === 0x3b) {
        return frames > 1;
      }
      if (marker === 0x21) {
        if ((await readAt(1)) === undefined || !(await skipBlocks())) {
          return false;
        }
        continue;
      }
      if (marker !== 0x2c) {
        return false;
      }
      frames += 1;
      if (frames > 1) {
        return true;
      }
      const descriptor = await readAt(9);
      if (descriptor === undefined) {
        return false;
      }
      const imagePacked = descriptor[8] ?? 0;
      if ((imagePacked & 0x80) !== 0) {
        position += 3 * 2 ** ((imagePacked & 0x07) + 1);
      }
      if ((await readAt(1)) === undefined || !(await skipBlocks())) {
        return false;
      }
    }
  } finally {
    await handle.close();
  }
}

async function validateImage(path: string, mediaType: AgentAttachmentMediaType): Promise<void> {
  const value = await readHeader(path, 12);
  const valid =
    (mediaType === "image/png" &&
      value.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (mediaType === "image/jpeg" && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) ||
    (mediaType === "image/webp" &&
      value.subarray(0, 4).toString("ascii") === "RIFF" &&
      value.subarray(8, 12).toString("ascii") === "WEBP") ||
    (mediaType === "image/gif" && /^GIF8[79]a$/u.test(value.subarray(0, 6).toString("ascii")));
  if (!valid || (mediaType === "image/gif" && (await isAnimatedGif(path)))) {
    throw new TypeError("Attachment image content is invalid or animated");
  }
}

async function validateText(path: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of createReadStream(path)) {
    decoder.decode(chunk as Buffer, { stream: true });
  }
  decoder.decode();
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
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
  }

  public async add(
    projectId: string,
    input: AttachmentUploadInput,
  ): Promise<StoredAttachmentUpload> {
    await this.#pruneExpired();
    const extension = validateUploadMetadata(input);
    const maximumBytes = this.#maxBytes ?? maximumBytesFor(input.kind);
    if (this.#entries.size >= this.#maxEntries) {
      throw new RangeError("Attachment store capacity exceeded");
    }

    const id = this.#createId();
    const filePath = join(
      this.#attachmentDirectory,
      `${Buffer.from(id).toString("base64url")}${extension}`,
    );
    const digest = createHash("sha256");
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.byteLength;
        if (bytes > maximumBytes) {
          callback(new RangeError("Attachment exceeds the maximum size"));
          return;
        }
        digest.update(value);
        callback(null, value);
      },
    });

    await mkdir(this.#attachmentDirectory, { recursive: true });
    try {
      await pipeline(input.content, limiter, createWriteStream(filePath, { flags: "wx" }));
      if (bytes === 0) {
        throw new RangeError("Attachment must not be empty");
      }
      if (input.kind === "image") {
        await validateImage(filePath, input.mediaType);
      } else if (input.kind === "text") {
        await validateText(filePath);
      }
      if (this.#totalBytes + bytes > this.#maxTotalBytes) {
        throw new RangeError("Attachment store capacity exceeded");
      }
    } catch (error) {
      await removeFile(filePath);
      throw error;
    }

    const attachment = {
      id,
      kind: input.kind,
      mediaType: input.mediaType,
      name: input.name,
      size: bytes,
    } satisfies AgentAttachment;
    this.#entries.set(id, {
      attachment,
      expiresAt: this.#clock() + this.#ttlMs,
      path: filePath,
      projectId,
    });
    this.#totalBytes += bytes;
    return { attachment, contentDigest: digest.digest("hex") };
  }

  public async resolve(
    projectId: string,
    ids: readonly string[],
  ): Promise<readonly ResolvedAttachment[]> {
    await this.#pruneExpired();
    const entries = ids.map((id) => {
      const entry = this.#entries.get(id);
      if (entry?.projectId !== projectId || entry.consumedTurnId !== undefined) {
        throw new AttachmentNotFoundError();
      }
      return entry;
    });
    const resolved: ResolvedAttachment[] = [];
    for (const entry of entries) {
      const { attachment, path } = entry;
      if (attachment.kind === "file") {
        resolved.push({
          kind: "file",
          mediaType: attachment.mediaType,
          name: attachment.name,
          path,
          size: attachment.size,
        });
      } else if (attachment.kind === "image") {
        const mediaType = attachment.mediaType as AgentImageMediaType;
        const content = await readFile(path);
        resolved.push({
          kind: "image",
          mediaType,
          size: attachment.size,
          url: `data:${mediaType};base64,${content.toString("base64")}`,
        });
      } else {
        const content = await readFile(path);
        resolved.push({
          kind: "text",
          mediaType: "text/plain",
          name: attachment.name,
          size: attachment.size,
          text: new TextDecoder("utf-8", { fatal: true }).decode(content),
        });
      }
    }
    return resolved;
  }

  public async read(projectId: string, id: string): Promise<StoredAttachmentContent> {
    await this.#pruneExpired();
    const entry = this.#entries.get(id);
    if (entry?.projectId !== projectId || entry.consumedTurnId !== undefined) {
      throw new AttachmentNotFoundError();
    }
    // 预览只通过随机附件 ID 读取已导入副本，不向浏览器暴露宿主文件路径。
    return { attachment: entry.attachment, content: await readFile(entry.path) };
  }

  public async consume(projectId: string, ids: readonly string[], turnId?: string): Promise<void> {
    for (const id of new Set(ids)) {
      const entry = this.#entries.get(id);
      if (entry?.projectId !== projectId) {
        continue;
      }
      if (entry.attachment.kind === "file" && turnId !== undefined) {
        // Mention 路径要保留到 Turn 结束，Codex 才能在后续工具调用中读取文件。
        entry.consumedTurnId = turnId;
        entry.expiresAt = this.#clock() + this.#ttlMs;
      } else {
        await this.#delete(id);
      }
    }
  }

  public async discard(id: string): Promise<void> {
    await this.#delete(id);
  }

  public async releaseTurn(projectId: string, turnId: string): Promise<void> {
    for (const [id, entry] of this.#entries) {
      if (entry.projectId === projectId && entry.consumedTurnId === turnId) {
        await this.#delete(id);
      }
    }
  }

  public async releaseProject(projectId: string): Promise<void> {
    const attachmentIds = [...this.#entries]
      .filter(([, entry]) => entry.projectId === projectId)
      .map(([attachmentId]) => attachmentId);
    await Promise.all(attachmentIds.map((attachmentId) => this.#delete(attachmentId)));
  }

  public async clear(): Promise<void> {
    await Promise.all([...this.#entries.keys()].map((id) => this.#delete(id)));
  }

  public async dispose(): Promise<void> {
    await this.clear();
    await rm(this.#attachmentDirectory, { force: true, recursive: true });
  }

  async #delete(id: string): Promise<void> {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return;
    }
    this.#entries.delete(id);
    this.#totalBytes -= entry.attachment.size;
    await removeFile(entry.path);
  }

  async #pruneExpired(): Promise<void> {
    const now = this.#clock();
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        await this.#delete(id);
      }
    }
  }
}
