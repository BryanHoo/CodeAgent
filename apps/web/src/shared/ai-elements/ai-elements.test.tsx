import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation, ConversationContent } from "./conversation.js";
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
import { Message, MessageContent, MessageResponse } from "./message.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "./prompt-input.js";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning.js";
import { Tool, ToolContent, ToolHeader } from "./tool.js";

describe("AI Elements primitives", () => {
  it("renders a structured agent activity timeline", () => {
    const markup = renderToStaticMarkup(
      <Conversation aria-label="会话">
        <ConversationContent>
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>完成工作台结构分析。</MessageResponse>
            </MessageContent>
          </Message>
          <Reasoning defaultOpen>
            <ReasoningTrigger>分析界面约束</ReasoningTrigger>
            <ReasoningContent>保持三区域稳定。</ReasoningContent>
          </Reasoning>
          <Tool defaultOpen>
            <ToolHeader status="completed">读取设计文档</ToolHeader>
            <ToolContent>docs/web-design.md</ToolContent>
          </Tool>
        </ConversationContent>
      </Conversation>,
    );

    expect(markup).toContain('role="log"');
    expect(markup).toContain("完成工作台结构分析。");
    expect(markup).toContain("分析界面约束");
    expect(markup).toContain("已完成");
    expect(markup).toContain("bg-control");
    expect(markup).toContain("rounded-surface");
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
    expect(markup).toContain("text-accent");
    expect(markup).toContain("agent-provider.ts");
    expect(markup).toContain("(line 948)");
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
    expect(markup).toContain("3 comments");
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
      <PromptInput accept="image/png,image/jpeg" disabled maxFiles={4} multiple>
        <PromptInputBody>
          <PromptInputTextarea aria-label="任务输入" disabled />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionAddAttachments label="添加图片" />
          </PromptInputTools>
          <PromptInputSubmit aria-label="提交" disabled status="idle" />
        </PromptInputFooter>
      </PromptInput>,
    );

    expect(markup).toContain('aria-label="任务输入"');
    expect(markup).toContain('aria-label="提交"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("shadow-floating");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="image/png,image/jpeg"');
    expect(markup).toContain('aria-label="添加图片"');
    expect(markup).toContain('aria-disabled="true"');
  });

  it("renders attachment previews and removal controls", () => {
    const markup = renderToStaticMarkup(
      <Attachments>
        <Attachment
          data={{
            id: "attachment-1",
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
