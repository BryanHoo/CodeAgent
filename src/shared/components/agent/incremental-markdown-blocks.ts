import { parseMarkdownIntoBlocks } from "streamdown";
import { replaceSequenceTail, type SequenceNode } from "../../lib/persistent-sequence.js";
import { createMarkdownBlock, appendMarkdownBlock, type MarkdownBlock } from "./streaming-markdown-block.js";
import type { ProcessedMessageResponse } from "./message-response-processing.js";

const FOOTNOTE_PATTERN = /\[\^[\w-]{1,200}\]/;
type MarkdownBlockParser = (markdown: string) => string[];
export type MarkdownBlockTree = SequenceNode<MarkdownBlock> | null;

export function createIncrementalMarkdownBlockParser(
  parseBlocks: MarkdownBlockParser = parseMarkdownIntoBlocks,
): (response: ProcessedMessageResponse) => MarkdownBlockTree {
  let previous: ProcessedMessageResponse | undefined;
  let tree: MarkdownBlockTree = null;
  const blocks: MarkdownBlock[] = [];
  const blockEnds: number[] = [];

  return (response) => {
    if (response === previous) return tree;
    const { replaceFrom, replacement } = response;
    const last = blocks.at(-1);
    const appended = replaceFrom > 0 && replaceFrom === previous?.markdown.length && last !== undefined
      ? appendMarkdownBlock(last, replacement) : null;
    if (appended !== null) {
      blocks[blocks.length - 1] = appended;
      blockEnds[blockEnds.length - 1] = response.markdown.length;
      tree = replaceSequenceTail(tree, blocks.length - 1, [appended]);
      previous = response;
      return tree;
    }

    // 二分定位变更边界，再回退一块以处理 Setext 标题、列表等跨块语法。
    let low = 0;
    let high = blockEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (blockEnds[middle]! <= replaceFrom) low = middle + 1;
      else high = middle;
    }
    const stableCount = Math.max(0, low - 1);
    const stableLength = blockEnds[stableCount - 1] ?? 0;
    let retainedTail = "";
    let remaining = replaceFrom - stableLength;
    for (let index = stableCount; remaining > 0 && index < blocks.length; index += 1) {
      const block = blocks[index]!.source;
      retainedTail += block.slice(0, remaining);
      remaining -= block.length;
    }
    const tail = retainedTail + replacement;
    if (FOOTNOTE_PATTERN.test(tail)) {
      // 脚注保留全文作用域，只有普通块进入独立渲染路径。
      blocks.length = 0;
      blocks.push({ kind: "markdown", content: response.markdown, source: response.markdown });
      blockEnds.length = 0;
      blockEnds.push(response.markdown.length);
      tree = replaceSequenceTail(tree, 0, blocks);
    } else {
      const tailBlocks = parseBlocks(tail);
      const tailSources = tail.includes("\r\n") ? restoreSourceBlocks(tail, tailBlocks) : tailBlocks;
      const additions = tailBlocks.map((content, index) => createMarkdownBlock(content, tailSources[index]!));
      // 私有目录原位截断；React 只接收不可变的共享树，不复制历史数组。
      blocks.length = stableCount;
      blockEnds.length = stableCount;
      let end = stableLength;
      for (const block of additions) {
        blocks.push(block);
        end += block.source.length;
        blockEnds.push(end);
      }
      tree = replaceSequenceTail(tree, stableCount, additions);
    }
    previous = response;
    return tree;
  };
}

function restoreSourceBlocks(source: string, blocks: readonly string[]): string[] {
  let offset = 0;
  return blocks.map((block) => {
    const start = offset;
    for (let index = 0; index < block.length; index += 1) {
      if (source[offset] === "\r" && source[offset + 1] === "\n") offset += 1;
      offset += 1;
    }
    return source.slice(start, offset);
  });
}
