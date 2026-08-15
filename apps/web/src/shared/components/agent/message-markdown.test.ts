import { describe, expect, it, vi } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";

import {
  createIncrementalMarkdownBlockParser,
  createIncrementalMarkdownProcessor,
  processMessageMarkdown,
} from "./message-markdown.js";

const STREAM_CHUNK_BYTES = 8 * 1024;
const STREAM_SOURCE_BYTES = 100 * 1024;

function createStreamingMarkdown(bytes: number): string {
  const unit = `## Result

Paragraph with **bold** and [source](/workspace/apps/web/src/file name.ts:12).

\`\`\`ts
const value = 1;
\`\`\`

`;
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

describe("incremental message Markdown", () => {
  it("只扫描新增的完整行并保持全量处理结果一致", () => {
    const source = `${createStreamingMarkdown(STREAM_SOURCE_BYTES)}
::code-comment{title="[P1] 修复缓存" body="只处理增量尾部。" file="/workspace/apps/web/src/file.ts" start=12 priority=1}`;
    const scannedLengths: number[] = [];
    const processor = createIncrementalMarkdownProcessor((fragment) => {
      scannedLengths.push(fragment.length);
    });
    processor.process("");

    for (let end = STREAM_CHUNK_BYTES; end < source.length; end += STREAM_CHUNK_BYTES) {
      processor.process(source.slice(0, end));
    }
    const result = processor.process(source);

    expect(result).toEqual(processMessageMarkdown(source));
    expect(scannedLengths.reduce((total, length) => total + length, 0)).toBeLessThan(
      source.length * 3,
    );
  });

  it("只重新分割不稳定尾块，并在非追加更新时失效缓存", () => {
    const source = createStreamingMarkdown(STREAM_SOURCE_BYTES);
    const parsedLengths: number[] = [];
    const baseParser = vi.fn((markdown: string) => {
      parsedLengths.push(markdown.length);
      return parseMarkdownIntoBlocks(markdown);
    });
    const parser = createIncrementalMarkdownBlockParser(baseParser);

    for (let end = STREAM_CHUNK_BYTES; end < source.length; end += STREAM_CHUNK_BYTES) {
      parser(source.slice(0, end));
    }
    const blocks = parser(source);

    expect(blocks.join("")).toBe(source);
    expect(blocks.length).toBeLessThan(12);
    expect(Math.max(...blocks.map((block) => block.length))).toBeLessThan(14 * 1024);
    expect(parsedLengths.reduce((total, length) => total + length, 0)).toBeLessThan(
      source.length * 3,
    );

    const replacement = `# Replaced\n\n${source.slice(0, STREAM_CHUNK_BYTES)}`;
    expect(parser(replacement).join("")).toBe(replacement);
    expect(baseParser).toHaveBeenLastCalledWith(replacement);
  });
});
