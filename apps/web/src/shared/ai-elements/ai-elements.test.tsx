import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation, ConversationContent } from "./conversation.js";
import { Message, MessageContent, MessageResponse } from "./message.js";
import {
  PromptInput,
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
  });

  it("renders an accessible prompt input composition", () => {
    const markup = renderToStaticMarkup(
      <PromptInput>
        <PromptInputBody>
          <PromptInputTextarea aria-label="任务输入" disabled />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>本地</PromptInputTools>
          <PromptInputSubmit aria-label="提交" disabled status="ready" />
        </PromptInputFooter>
      </PromptInput>,
    );

    expect(markup).toContain('aria-label="任务输入"');
    expect(markup).toContain('aria-label="提交"');
    expect(markup).toContain("disabled");
  });
});
