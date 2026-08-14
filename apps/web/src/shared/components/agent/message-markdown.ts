import { parseMarkdownIntoBlocks } from "streamdown";

import {
  parseCodeCommentFragment,
  type CodeComment,
  type ParsedCodeComments,
} from "./code-comments.js";

export const UNC_FILE_REFERENCE_PREFIX = "/__code_agent_unc__/";
export const RELATIVE_FILE_REFERENCE_PREFIX = "/__code_agent_relative__/";

const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const MARKDOWN_BLOCK_BATCH_BYTES = 8 * 1024;
const CACHE_GUARD_CHARACTERS = 64;

type MarkdownBlockParser = (markdown: string) => string[];
type MarkdownScanObserver = (fragment: string) => void;

type StablePrefixGuard = Readonly<{
  head: string;
  length: number;
  tail: string;
}>;

function createStablePrefixGuard(source: string, length: number): StablePrefixGuard {
  return {
    head: source.slice(0, Math.min(length, CACHE_GUARD_CHARACTERS)),
    length,
    tail: source.slice(Math.max(0, length - CACHE_GUARD_CHARACTERS), length),
  };
}

function matchesStablePrefix(source: string, guard: StablePrefixGuard): boolean {
  // message.delta 只追加文本；首尾常量校验可识别重置，又不会重新扫描完整稳定前缀。
  return (
    source.length >= guard.length &&
    source.startsWith(guard.head) &&
    source.slice(guard.length - guard.tail.length, guard.length) === guard.tail
  );
}

function normalizeMarkdownFileReferences(markdown: string): string {
  // 路径规则按单行匹配，因此完整行一旦稳定就不需要再次扫描。
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

function transformMessageMarkdownFragment(markdown: string): ParsedCodeComments {
  const parsed = parseCodeCommentFragment(markdown);
  return {
    comments: parsed.comments,
    markdown: normalizeMarkdownFileReferences(parsed.markdown),
  };
}

function countLeadingNewlines(value: string): number {
  let count = 0;
  while (value[count] === "\n") count += 1;
  return count;
}

function countTrailingNewlines(value: string): number {
  let count = 0;
  while (value[value.length - count - 1] === "\n") count += 1;
  return count;
}

function appendMarkdown(stableMarkdown: string, fragment: string): string {
  const collapsedFragment = fragment.replace(/\n{3,}/g, "\n\n");
  const boundaryNewlines =
    countTrailingNewlines(stableMarkdown) + countLeadingNewlines(collapsedFragment);
  const overflow = Math.max(0, boundaryNewlines - 2);
  return `${stableMarkdown}${collapsedFragment.slice(overflow)}`;
}

export function processMessageMarkdown(markdown: string): ParsedCodeComments {
  const parsed = transformMessageMarkdownFragment(markdown);
  return {
    comments: parsed.comments,
    markdown: parsed.markdown.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function createIncrementalMarkdownProcessor(onScan?: MarkdownScanObserver) {
  let stableComments: CodeComment[] = [];
  let stableGuard = createStablePrefixGuard("", 0);
  let stableMarkdown = "";
  let previousSourceLength = 0;

  const scan = (fragment: string) => {
    onScan?.(fragment);
    return transformMessageMarkdownFragment(fragment);
  };

  return {
    process(source: string): ParsedCodeComments {
      const stableBoundary = source.lastIndexOf("\n") + 1;
      if (
        (source.length <= previousSourceLength && source.length !== 0) ||
        stableBoundary < stableGuard.length ||
        !matchesStablePrefix(source, stableGuard)
      ) {
        stableComments = [];
        stableGuard = createStablePrefixGuard("", 0);
        stableMarkdown = "";
      }
      previousSourceLength = source.length;

      if (stableBoundary > stableGuard.length) {
        const parsedStableDelta = scan(source.slice(stableGuard.length, stableBoundary));
        stableComments.push(...parsedStableDelta.comments);
        stableMarkdown = appendMarkdown(stableMarkdown, parsedStableDelta.markdown);
        stableGuard = createStablePrefixGuard(source, stableBoundary);
      }

      // 当前行仍可能继续形成路径或 code-comment，仅重算这一小段尾部。
      const parsedTail = scan(source.slice(stableBoundary));
      return {
        comments: [...stableComments, ...parsedTail.comments],
        markdown: appendMarkdown(stableMarkdown, parsedTail.markdown).trim(),
      };
    },
  };
}

export function createIncrementalMarkdownBlockParser(
  baseParser: MarkdownBlockParser = parseMarkdownIntoBlocks,
): MarkdownBlockParser {
  let stableBlocks: string[] = [];
  let stableGuard = createStablePrefixGuard("", 0);
  let previousMarkdownLength = 0;

  return (markdown) => {
    const canReuseStablePrefix =
      stableGuard.length > 0 &&
      markdown.length > previousMarkdownLength &&
      matchesStablePrefix(markdown, stableGuard);
    previousMarkdownLength = markdown.length;
    const parsedTailBlocks = baseParser(
      canReuseStablePrefix ? markdown.slice(stableGuard.length) : markdown,
    );
    const tailBlocks: string[] = [];
    let batch = "";
    for (const block of parsedTailBlocks) {
      if (batch.length > 0 && batch.length + block.length > MARKDOWN_BLOCK_BATCH_BYTES) {
        tailBlocks.push(batch);
        batch = "";
      }
      batch += block;
    }
    if (batch.length > 0) tailBlocks.push(batch);
    const blocks = canReuseStablePrefix ? [...stableBlocks, ...tailBlocks] : tailBlocks;

    // 最后一个 Markdown 块可能被下一次 delta 改写，始终留在增量尾部。
    stableBlocks = blocks.slice(0, -1);
    const stableLength = stableBlocks.reduce((length, block) => length + block.length, 0);
    stableGuard = createStablePrefixGuard(markdown, stableLength);
    return blocks;
  };
}
