import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation, ConversationList } from "./conversation.js";

describe("ConversationList rendering", () => {
  it("renders every loaded turn in natural document order", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Conversation,
        { conversationId: "task-a" },
        createElement(ConversationList, {
          getItemKey: (turnId: unknown) => String(turnId),
          items: Array.from({ length: 20 }, (_, index) => `turn-${String(index)}`),
          renderItem: (turnId: unknown) => createElement("p", null, String(turnId)),
        }),
      ),
    );

    expect(markup).toContain('data-index="0"');
    expect(markup).toContain('data-index="19"');
    expect(markup.indexOf("turn-0")).toBeLessThan(markup.indexOf("turn-19"));
    expect(markup).not.toContain("position:absolute");
    expect(markup).not.toContain("overflow-anchor:none");
  });

  it("uses browser-native rendering containment only for cold turns", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Conversation,
        { conversationId: "task-a" },
        createElement(ConversationList, {
          getItemKey: (turnId: unknown) => String(turnId),
          getItemRenderMode: (_turnId: unknown, index: number) =>
            index === 0 ? "cold" : "hot",
          items: ["turn-cold", "turn-hot"],
          renderItem: (turnId: unknown) => createElement("p", null, String(turnId)),
        }),
      ),
    );

    expect(markup).toContain('data-render-mode="cold" style="');
    expect(markup).toContain("contain-intrinsic-block-size:auto 300px");
    expect(markup).toContain("content-visibility:auto");
    expect(markup).toContain('data-render-mode="hot"');
    expect(markup).not.toContain('data-render-mode="hot" style=');
  });
});
