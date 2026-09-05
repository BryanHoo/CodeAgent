import type { TextSnapshot } from "../../lib/append-only-text.js";

import {
  parseCodeCommentDirective,
  parseCodeComments,
  type CodeComment,
  type ParsedCodeComments,
} from "./code-comments.js";

const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const WHITESPACE_OR_TEXT_PATTERN = /\s+|\S+/gu;
const WHITESPACE_PATTERN = /^\s+$/u;
const EXCESSIVE_NEWLINES_PATTERN = /\n{3,}/g;

export const UNC_FILE_REFERENCE_PREFIX = "/__codeagent_unc__/";
export const RELATIVE_FILE_REFERENCE_PREFIX = "/__codeagent_relative__/";

export function normalizeMarkdownFileReferences(markdown: string): string {
  // 路径目标不会跨行；该约束允许流式处理只保留尚未结束的当前行。
  return markdown
    .replace(WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) => {
      const normalizedReference = reference.replaceAll("\\", "/");
      if (/^[a-z]:/i.test(normalizedReference)) {
        return `/${normalizedReference}`;
      }
      return `${UNC_FILE_REFERENCE_PREFIX}${normalizedReference.slice(2)}`;
    })
    .replace(
      RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN,
      (reference) => `${RELATIVE_FILE_REFERENCE_PREFIX}${reference}`,
    )
    .replace(LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) =>
      reference.replaceAll(" ", "%20").replaceAll("\t", "%09"),
    );
}

export function preprocessMessageResponse(markdown: string): ParsedCodeComments {
  const parsedResponse = parseCodeComments(markdown);
  return {
    comments: parsedResponse.comments,
    markdown: normalizeMarkdownFileReferences(parsedResponse.markdown),
  };
}

class IncrementalWhitespaceBuffer {
  private delta = "";
  private output: string;
  private trailingWhitespace: string;

  constructor(output = "", trailingWhitespace = "") {
    this.output = output;
    this.trailingWhitespace = trailingWhitespace;
  }

  append(value: string): void {
    const additions: string[] = [];
    let hasContent = this.output.length > 0;
    for (const match of value.matchAll(WHITESPACE_OR_TEXT_PATTERN)) {
      const token = match[0];
      if (WHITESPACE_PATTERN.test(token)) {
        this.trailingWhitespace += token;
        continue;
      }
      if (hasContent && this.trailingWhitespace.length > 0) {
        additions.push(this.trailingWhitespace.replace(EXCESSIVE_NEWLINES_PATTERN, "\n\n"));
      }
      this.trailingWhitespace = "";
      additions.push(token);
      hasContent = true;
    }
    if (additions.length > 0) {
      const addition = additions.join("");
      this.output += addition;
      this.delta += addition;
    }
  }

  clone(): IncrementalWhitespaceBuffer {
    return new IncrementalWhitespaceBuffer(this.output, this.trailingWhitespace);
  }

  materialize(): string {
    // 尾部空白由 trim() 语义丢弃，仅返回已经由后续正文确认的内容。
    return this.output;
  }

  takeDelta(): string {
    const delta = this.delta;
    this.delta = "";
    return delta;
  }
}

type ProcessingState = Readonly<{
  comments: CodeComment[];
  discardBlankLines: boolean;
  whitespace: IncrementalWhitespaceBuffer;
}>;

function processLine(source: string, hasLineFeed: boolean, state: ProcessingState): boolean {
  const comment = parseCodeCommentDirective(source);
  if (comment !== null) {
    state.comments.push(comment);
    if (hasLineFeed) {
      state.whitespace.append("\n");
    }
    return true;
  }

  if (state.discardBlankLines && source.trim().length === 0) {
    return true;
  }

  state.whitespace.append(`${normalizeMarkdownFileReferences(source)}${hasLineFeed ? "\n" : ""}`);
  return false;
}

export type ProcessedMessageResponse = ParsedCodeComments & Readonly<{
  replaceFrom: number;
  replacement: string;
}>;

export class IncrementalMessageResponseProcessor {
  private cachedResult: ProcessedMessageResponse = { comments: [], markdown: "", replaceFrom: 0, replacement: "" };
  private committedComments: CodeComment[] = [];
  private discardBlankLines = false;
  private pendingLine = "";
  private lineStarted = false;
  private previousSource: string | TextSnapshot = "";
  private whitespace = new IncrementalWhitespaceBuffer();

  process(source: string | TextSnapshot): ProcessedMessageResponse {
    const previous = this.previousSource;
    if (source === previous || (typeof source !== "string" && typeof previous !== "string" &&
      source.chunks === previous.chunks && source.chunkCount === previous.chunkCount)) {
      return this.cachedResult;
    }
    let addition: string;
    if (typeof source === "string") {
      // 普通字符串没有追加契约；替换时完整重置，流式输入统一使用 Chunk 快照。
      this.reset();
      addition = source;
    } else {
      const continuing = typeof previous !== "string" && previous.chunks === source.chunks &&
        previous.chunkCount <= source.chunkCount;
      if (!continuing) this.reset();
      const start = continuing ? previous.chunkCount : 0;
      addition = source.chunks.slice(start, source.chunkCount).join("");
    }

    const replaceFrom = this.whitespace.materialize().length;
    this.pendingLine += addition;
    this.previousSource = source;
    let lineFeedIndex = this.pendingLine.indexOf("\n");
    while (lineFeedIndex >= 0) {
      const line = this.pendingLine.slice(0, lineFeedIndex);
      this.pendingLine = this.pendingLine.slice(lineFeedIndex + 1);
      this.commitLine(line, true);
      this.lineStarted = false;
      lineFeedIndex = this.pendingLine.indexOf("\n");
    }

    // 普通行无需等换行；只保留可能成为评论指令或文件链接目标的后缀。
    const directive = "::code-comment{";
    const mayBeDirective = !this.lineStarted &&
      (directive.startsWith(this.pendingLine) || this.pendingLine.startsWith(directive));
    const mayBeDiscardedBlankLine = this.discardBlankLines && !this.lineStarted && this.pendingLine.trim().length === 0;
    if (!mayBeDirective && !mayBeDiscardedBlankLine) {
      const targetStart = this.pendingLine.indexOf("]");
      const committedLength = targetStart < 0 ? this.pendingLine.length : targetStart;
      if (committedLength > 0) {
        this.commitLine(this.pendingLine.slice(0, committedLength), false);
        this.pendingLine = this.pendingLine.slice(committedLength);
        this.lineStarted = true;
      }
    }

    // 当前行仍可能继续增长，基于已提交状态制作轻量预览，不能污染后续 Chunk。
    const previewComments = [...this.committedComments];
    const previewWhitespace = this.whitespace.clone();
    if (this.pendingLine.length > 0) {
      if (this.lineStarted) previewWhitespace.append(normalizeMarkdownFileReferences(this.pendingLine));
      else processLine(this.pendingLine, false, {
        comments: previewComments,
        discardBlankLines: this.discardBlankLines,
        whitespace: previewWhitespace,
      });
    }
    this.cachedResult = {
      comments: previewComments,
      markdown: previewWhitespace.materialize(),
      // 已提交正文不变，只替换上一次的未结束行；分块器直接使用边界，无需比较前缀。
      replaceFrom,
      replacement: this.whitespace.takeDelta() + previewWhitespace.takeDelta(),
    };
    return this.cachedResult;
  }

  private commitLine(line: string, hasLineFeed: boolean): void {
    if (this.lineStarted) {
      this.whitespace.append(`${normalizeMarkdownFileReferences(line)}${hasLineFeed ? "\n" : ""}`);
      return;
    }
    this.discardBlankLines = processLine(line, hasLineFeed, {
      comments: this.committedComments,
      discardBlankLines: this.discardBlankLines,
      whitespace: this.whitespace,
    });
  }

  private reset(): void {
    this.cachedResult = { comments: [], markdown: "", replaceFrom: 0, replacement: "" };
    this.committedComments = [];
    this.discardBlankLines = false;
    this.pendingLine = "";
    this.lineStarted = false;
    this.previousSource = "";
    this.whitespace = new IncrementalWhitespaceBuffer();
  }
}
