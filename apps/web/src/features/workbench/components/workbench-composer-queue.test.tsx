import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ComposerQueuedPrompts } from "./workbench-composer-queue.js";

const queuedPrompt = {
  acknowledgedUserMessageIds: [],
  deliveryState: "queued" as const,
  files: [],
  id: "queued-1",
  presentation: "queue" as const,
  skills: [],
  text: "可编辑的顺序消息",
};

describe("ComposerQueuedPrompts", () => {
  it("allows queued messages to be edited before dispatch", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerQueuedPrompts
          activeTurnId="turn-1"
          canEdit
          canSteer
          isSubmitting={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onSteer={vi.fn()}
          prompts={[queuedPrompt]}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="编辑排队消息：可编辑的顺序消息"');
    expect(markup).toContain('aria-label="立即引导：可编辑的顺序消息"');
  });

  it("shows waiting status without mutable actions after dispatch", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerQueuedPrompts
          activeTurnId="turn-1"
          canEdit
          canSteer
          isSubmitting={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onSteer={vi.fn()}
          prompts={[{ ...queuedPrompt, deliveryState: "awaiting_acknowledgement" }]}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("等待发送");
    expect(markup).not.toContain("编辑排队消息");
    expect(markup).not.toContain("取消排队");
    expect(markup).not.toContain("立即引导");
  });
});
