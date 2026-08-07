import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Conversation, ConversationContent, ConversationVirtualList } from "./conversation.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "./attachments.js";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "./confirmation.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block.js";
import { Context, ContextTrigger, formatContextUsage } from "./context.js";
import { FileTree, FileTreeFile, FileTreeFolder } from "./file-tree.js";
import { Message, MessageAction, MessageContent } from "./message.js";
import { MessageResponse } from "./message-response.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  createPastedTextFile,
  isPromptInputNewlineShortcut,
} from "./prompt-input.js";
import { Shimmer } from "./shimmer.js";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./tool.js";
import { TooltipProvider } from "../ui/tooltip.js";

function renderWithTooltipProvider(children: ReactNode) {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

function resolveStreamdownMermaidVersion(): string {
  // 从 streamdown 的真实安装位置解析生产依赖，避免测试误读根目录中的其他 Mermaid 版本。
  const streamdownPackagePath = realpathSync(
    new URL("../../../node_modules/streamdown/package.json", import.meta.url),
  );
  const requireFromStreamdown = createRequire(streamdownPackagePath);
  const mermaidPackage = JSON.parse(
    readFileSync(requireFromStreamdown.resolve("mermaid/package.json"), "utf8"),
  ) as { version?: unknown };

  if (typeof mermaidPackage.version !== "string") {
    throw new TypeError("streamdown Mermaid package version is missing");
  }

  return mermaidPackage.version;
}

describe("AI Elements primitives", () => {
  it("renders an accessible file tree with folders collapsed by default", () => {
    const markup = renderToStaticMarkup(
      <FileTree aria-label="项目文件" selectedPath="README.md">
        <FileTreeFolder name="src" path="src">
          <FileTreeFile name="main.tsx" path="src/main.tsx" />
        </FileTreeFolder>
        <FileTreeFile name="README.md" path="README.md" />
      </FileTree>,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="展开文件夹 src"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain("main.tsx");
    expect(markup).toContain("README.md");
  });

  it("renders a code block with line numbers and a highlighted line", () => {
    const markup = renderToStaticMarkup(
      <CodeBlock
        code={"const first = 1;\nconst second = 2;"}
        highlightedLine={2}
        language="typescript"
        showLineNumbers
      >
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>example.ts</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>,
    );

    expect(markup).toContain("example.ts");
    expect(markup).toContain('data-code-line="1"');
    expect(markup).toContain('data-code-line="2"');
    expect(markup).toContain('data-highlighted="true"');
    expect(markup).toContain("const second = 2;");
    expect(markup).toContain('aria-label="复制代码"');
  });

  it("renders an accessible context usage trigger", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <Context maxTokens={200_000} usedTokens={25_000}>
          <ContextTrigger />
        </Context>
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="上下文已使用 13%"');
    expect(markup.match(/<circle/g)).toHaveLength(2);
    expect(formatContextUsage({ maxTokens: 200_000, usedTokens: 25_000 })).toEqual({
      accessibleLabel: "上下文已使用 13%",
      percentage: 13,
      summary: "13% 上下文已使用",
      tokenCount: "25K / 200K tokens",
    });
    expect(formatContextUsage({ maxTokens: undefined, usedTokens: undefined })).toEqual({
      accessibleLabel: "上下文用量未知",
      percentage: null,
      summary: "等待模型返回上下文用量",
      tokenCount: null,
    });
  });

  it("renders a structured agent message and tool timeline", () => {
    const markup = renderWithTooltipProvider(
      <Conversation aria-label="会话" conversationId="test-conversation">
        <ConversationContent>
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>完成工作台结构分析。</MessageResponse>
            </MessageContent>
          </Message>
          <Tool defaultOpen>
            <ToolHeader state="output-available" title="读取设计文档" />
            <ToolContent>docs/web-design.md</ToolContent>
          </Tool>
        </ConversationContent>
      </Conversation>,
    );

    expect(markup).toContain('role="log"');
    expect(markup).toContain("完成工作台结构分析。");
    expect(markup).toContain("已完成");
    expect(markup).toContain("bg-control");
    expect(markup).toContain("rounded-surface");
  });

  it("composes message actions with the shared tooltip", () => {
    const markup = renderWithTooltipProvider(
      <MessageAction tooltip="复制消息">复制图标</MessageAction>,
    );

    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toContain('aria-label="复制消息"');
    expect(markup).not.toContain('title="复制消息"');
  });

  it("composes the tool header with the shared tooltip trigger", () => {
    const markup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-available" title="读取完整命令" />
      </Tool>,
    );

    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup.match(/<summary/gu)).toHaveLength(1);
  });

  it("only renders the visible Turn range in a long conversation", () => {
    const turns = Array.from({ length: 100 }, (_, index) => `turn-${String(index + 1)}`);
    const markup = renderToStaticMarkup(
      <Conversation aria-label="长会话" conversationId="long-conversation">
        <ConversationVirtualList
          getItemKey={(turnId) => turnId}
          items={turns}
          renderItem={(turnId, turnIndex) => (
            <section aria-label={`Turn ${String(turnIndex + 1)}`}>{turnId}</section>
          )}
        />
      </Conversation>,
    );

    expect(markup).toContain("turn-1");
    expect(markup).not.toContain("turn-100");
    expect(markup.match(/aria-label="Turn /g)?.length).toBeLessThan(turns.length);
  });

  it("renders a polymorphic running Shimmer with an accessible status", () => {
    const markup = renderToStaticMarkup(
      <Shimmer aria-label="AI 回复正在运行" as="span" role="status">
        正在运行
      </Shimmer>,
    );

    expect(markup).toContain('<span class="ai-shimmer inline-block ');
    expect(markup).toContain('data-ai-shimmer=""');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("正在运行");
  });

  it("renders localized tool states with structured JSON input and output", () => {
    const markup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-available" title="读取文件" />
        <ToolContent>
          <ToolInput input={{ path: "src/index.ts", range: [1, 20] }} />
          <ToolOutput errorText={undefined} output={{ lines: 20, truncated: false }} />
        </ToolContent>
      </Tool>,
    );

    expect(markup).toContain("读取文件");
    expect(markup).toContain("已完成");
    expect(markup).toContain(">参数<");
    expect(markup).toContain(">结果<");
    expect(markup).toContain("&quot;path&quot;: &quot;src/index.ts&quot;");
    expect(markup).toContain("&quot;lines&quot;: 20");
    expect(markup).toContain('data-language="json"');
  });

  it("does not render tool details until the tool is opened", () => {
    const collapsedMarkup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-available" title="读取大型结果" />
        <ToolContent>仅展开后渲染的大型内容</ToolContent>
      </Tool>,
    );
    const expandedMarkup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-available" title="读取大型结果" />
        <ToolContent>仅展开后渲染的大型内容</ToolContent>
      </Tool>,
    );

    expect(collapsedMarkup).toContain("读取大型结果");
    expect(collapsedMarkup).not.toContain("仅展开后渲染的大型内容");
    expect(expandedMarkup).toContain("仅展开后渲染的大型内容");
  });

  it("renders denied and failed tools as distinct error states", () => {
    const deniedMarkup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-denied" title="执行命令" />
      </Tool>,
    );
    const failedMarkup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-error" title="读取文件" />
        <ToolContent>
          <ToolOutput errorText="文件不存在" output={undefined} />
        </ToolContent>
      </Tool>,
    );

    expect(deniedMarkup).toContain("已拒绝");
    expect(failedMarkup).toContain("失败");
    expect(failedMarkup).toContain(">错误<");
    expect(failedMarkup).toContain("文件不存在");
  });

  it("renders assistant Markdown as semantic HTML", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{"## 结果\n\n- 支持 **Markdown**\n- 支持 `code`"}</MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toMatch(/<h2[^>]*>结果<\/h2>/);
    expect(markup).toContain('data-streamdown="unordered-list"');
    expect(markup).toContain('data-streamdown="strong">Markdown</span>');
    expect(markup).toContain('data-streamdown="inline-code">code</code>');
    expect(markup).not.toContain("## 结果");
  });

  it("uses the patched Mermaid release for untrusted Agent Markdown", () => {
    expect(resolveStreamdownMermaidVersion()).toBe("11.16.1");
  });

  it.each([
    [
      "CSS sibling injection",
      `---
config:
  themeCSS: |-
    & + * { background:red !important; position:fixed !important; inset:0 !important; }
---
info`,
    ],
    [
      "architecture prototype pollution",
      `architecture-beta
  group mermaidPrototypePollutionMarker(cloud)[Marker]
  service a(server)[A] in __proto__
  service b(server)[B] in mermaidPrototypePollutionMarker
  a:R -- L:b`,
    ],
    [
      "XY chart infinite loop",
      `xychart
  x-axis 1 --> 1
  line [1, 2]`,
    ],
    [
      "radar chart resource exhaustion",
      `radar-beta
  axis a, b
  curve c {1, 1}
  ticks 1000000000`,
    ],
  ])("keeps malicious Mermaid input inert: %s", (_name, diagram) => {
    const markup = renderToStaticMarkup(
      <MessageResponse>{`\`\`\`mermaid\n${diagram}\n\`\`\``}</MessageResponse>,
    );

    // Agent 产出的 Mermaid 未配置受信任插件时只能作为代码显示，不能进入图表执行路径。
    expect(markup).toContain('data-streamdown="code-block"');
    expect(markup).toContain('data-language="mermaid"');
    expect(markup).not.toContain('data-streamdown="mermaid-block"');
    expect(markup).not.toContain("<style");
  });

  it("opens safe external links in a new tab and rejects dangerous protocols", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>
            {"[OpenAI](https://openai.com)\n\n[unsafe](javascript:alert('x'))"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('href="https://openai.com/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('href="javascript:');
  });

  it("renders Markdown file references with the official accent treatment", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>
            {
              "- 修复并发冲突。[agent-provider.ts](/workspace/packages/agent-provider.ts:948)\n- 更新规范。[runtime-lifecycle.md](/workspace/.superwork/runtime-lifecycle.md:16)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-file-reference="true"');
    expect(markup).not.toContain("data-file-extension");
    expect(markup).toContain("text-primary");
    expect(markup).toContain("agent-provider.ts");
    expect(markup).toContain("(line 948)");
  });

  it("renders local Markdown file references as source preview buttons when enabled", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[architecture-design.md](/workspace/docs/architecture-design.md:716)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain("hover:decoration-current");
    expect(markup).toContain('data-file-reference="true"');
    expect(markup).toContain("architecture-design.md");
    expect(markup).toContain("(line 716)");
    expect(markup).not.toContain('href="/workspace/docs/architecture-design.md:716"');
  });

  it("decodes URL-encoded UTF-8 local file references before preview", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[后续工作交接.pptx](/home/taoye/%E4%B8%8B%E8%BD%BD/AI%E9%A2%86%E8%88%AA%C2%B7%E6%99%BA%E8%A7%81%E6%9C%AA%E6%9D%A5/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/下载/AI领航·智见未来/后续工作交接.pptx"');
    expect(markup).not.toContain("%E4%B8%8B%E8%BD%BD");
  });

  it("renders local file references containing unencoded spaces", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[后续工作交接.pptx](/home/taoye/下载/AI 领航/后续 工作交接.pptx)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/下载/AI 领航/后续 工作交接.pptx"');
    expect(markup).toContain('data-file-reference="true"');
  });

  it("decodes UTF-8 byte runs without rewriting literal percent signs", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[后续工作交接.pptx](/home/taoye/100%完成/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/100%完成/后续工作交接.pptx"');
    expect(markup).not.toContain("%E5%90%8E%E7%BB%AD");
  });

  it("renders Windows Markdown file references as source preview buttons", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[app.ts](C:/workspace/CodeAgent/src/app.ts:12)\n\n[server.ts](C:\\workspace\\CodeAgent\\src\\server.ts:24)\n\n[share.ts](\\\\server\\share\\share.ts:3)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('data-file-reference="true"');
    expect(markup).toContain("(line 12)");
    expect(markup).toContain("(line 24)");
    expect(markup).toContain("(line 3)");
    expect(markup.match(/data-file-reference="true"/g)).toHaveLength(3);
    expect(markup).toContain('title="C:/workspace/CodeAgent/src/app.ts"');
    expect(markup).toContain('title="C:/workspace/CodeAgent/src/server.ts"');
    expect(markup).toContain('title="//server/share/share.ts"');
    expect(markup).not.toContain('href="C:/workspace/CodeAgent/src/app.ts:12"');
  });

  it("renders relative Markdown file references as preview buttons", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[guide.md](docs/guide.md:8)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain("(line 8)");
    expect(markup).toContain('title="docs/guide.md"');
  });

  it("extracts code review directives into a dedicated comments summary", () => {
    const reviewMarkdown = `发现 3 个需要修复的问题：

1. **[P1] 第一个问题**

::code-comment{title="[P1] 不要复用冲突的审批决策" body="冲突决策不能共享结果。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=939 end=941 priority=1}

2. **[P1] 第二个问题**

::code-comment{title="[P1] 落实 autoResolutionMs 的到期行为" body="请求到期后必须进入终态。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=261 end=267 priority=1}

3. **[P2] 第三个问题**

::code-comment{title="[P2] 同时清理读取期间暂存的请求" body="终态时同步清理请求。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=980 end=985 priority=2}`;

    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{reviewMarkdown}</MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-code-comments="true"');
    expect(markup).toContain('class="my-4 overflow-hidden');
    expect(markup).toContain("3 个代码评论");
    expect(markup).toContain("不要复用冲突的审批决策");
    expect(markup).toContain("packages/provider-codex/src/agent-provider.ts:939-941");
    expect(markup).toContain(">P1</span>");
    expect(markup).toContain(">P2</span>");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).not.toContain("::code-comment");
    expect(markup).not.toContain(">冲突决策不能共享结果。<");
  });

  it("renders an accessible prompt input composition", () => {
    const markup = renderToStaticMarkup(
      <PromptInput
        disabled
        fileAccept=".pdf,.docx,.xlsx,.txt,.md"
        imageAccept=".png,.jpg,.jpeg,.webp,.gif"
        multiple
      >
        <PromptInputBody>
          <PromptInputTextarea aria-label="任务输入" disabled />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionAddAttachments onSelectKind={vi.fn()} />
          </PromptInputTools>
          <PromptInputSubmit aria-label="提交" disabled status="idle" />
        </PromptInputFooter>
      </PromptInput>,
    );

    expect(markup).toContain('aria-label="任务输入"');
    expect(markup).toContain('aria-label="提交"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("shadow-floating");
    expect(markup).not.toContain('type="file"');
    expect(markup).toContain('aria-label="添加图片或文件"');
    expect(markup).toContain("添加图片");
    expect(markup).toContain("添加文件");
    expect(markup).not.toContain("aria-disabled");
    expect(markup).toContain('data-prompt-input=""');
  });

  it("识别多平台输入框换行快捷键", () => {
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: true,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isPromptInputNewlineShortcut({ ctrlKey: true, key: "a", metaKey: false, shiftKey: false }),
    ).toBe(false);
  });

  it("creates a text file only when pasted text exceeds the configured threshold", () => {
    expect(createPastedTextFile("x".repeat(1_000), 1_000, "Pasted text.txt")).toBeUndefined();

    const attachment = createPastedTextFile("你".repeat(1_001), 1_000, "Pasted text.txt");

    expect(attachment).toMatchObject({
      name: "Pasted text.txt",
      size: 3_003,
      type: "text/plain",
    });
  });

  it("renders attachment previews and removal controls", () => {
    const markup = renderToStaticMarkup(
      <Attachments>
        <Attachment
          data={{
            id: "attachment-1",
            kind: "image",
            mediaType: "image/png",
            name: "screen.png",
            previewUrl: "data:image/png;base64,aW1hZ2U=",
            size: 5,
          }}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove aria-label="移除 screen.png" />
        </Attachment>
      </Attachments>,
    );

    expect(markup).toContain("screen.png");
    expect(markup).toContain('src="data:image/png;base64,aW1hZ2U="');
    expect(markup).toContain('aria-label="移除 screen.png"');
  });

  it("renders pasted text attachments as files", () => {
    const markup = renderToStaticMarkup(
      <Attachments>
        <Attachment
          data={{
            id: "attachment-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            previewUrl: "blob:text",
            size: 1_001,
          }}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      </Attachments>,
    );

    expect(markup).toContain('data-attachment-preview="file"');
    expect(markup).toContain("Pasted text.txt");
    expect(markup).not.toContain("<img");
  });

  it("renders an accessible prompt command composition", () => {
    const markup = renderToStaticMarkup(
      <PromptInputCommand aria-label="输入命令">
        <PromptInputCommandList>
          <PromptInputCommandGroup label="命令">
            <PromptInputCommandItem active selected>
              选择项目
            </PromptInputCommandItem>
          </PromptInputCommandGroup>
          <PromptInputCommandEmpty hidden>没有匹配的命令</PromptInputCommandEmpty>
        </PromptInputCommandList>
      </PromptInputCommand>,
    );

    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('aria-label="输入命令"');
    expect(markup).toContain('role="option"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("选择项目");
    expect(markup).toContain('data-prompt-input-command=""');
    expect(markup).toContain("h-auto min-h-8");
  });

  it("renders an accessible confirmation composition", () => {
    const markup = renderToStaticMarkup(
      <Confirmation approval={{ id: "request-1" }} state="approval-requested">
        <ConfirmationTitle>命令审批</ConfirmationTitle>
        <ConfirmationRequest>pnpm check</ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction>拒绝</ConfirmationAction>
          <ConfirmationAction>允许</ConfirmationAction>
        </ConfirmationActions>
      </Confirmation>,
    );

    expect(markup).toContain('aria-label="命令审批请求"');
    expect(markup).toContain('data-state="approval-requested"');
    expect(markup).toContain("pnpm check");
    expect(markup).toContain("拒绝");
    expect(markup).toContain("允许");
  });
});
