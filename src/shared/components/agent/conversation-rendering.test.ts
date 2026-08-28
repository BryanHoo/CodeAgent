import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Conversation, ConversationVirtualList } from "./conversation.js";

describe("ConversationVirtualList rendering", () => {
  it("does not place dynamic turns on transformed layers", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Conversation,
        { conversationId: "task-a" },
        createElement(ConversationVirtualList, {
          getItemKey: (turnId: unknown) => String(turnId),
          items: ["turn-a"],
          renderItem: (turnId: unknown) => createElement("p", null, String(turnId)),
        }),
      ),
    );

    expect(markup).toContain('data-index="0"');
    expect(markup).not.toContain("transform:translateY");
  });
});
