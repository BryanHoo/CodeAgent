import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Conversation, ConversationList } from "./conversation.js";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("Conversation visual anchor", () => {
  it("视口上方的冷 Turn 恢复真实高度后保持当前 Turn 位置", async () => {
    const screen = await render(
      <Conversation
        conversationId="task-with-long-history"
        style={{ height: 320, overflowAnchor: "none", overflowY: "auto" }}
      >
        <ConversationList
          getItemKey={(turnId) => turnId}
          items={["turn-0", "turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]}
          renderItem={(turnId) => <div style={{ height: 240 }}>{turnId}</div>}
        />
      </Conversation>,
    );
    const container = screen.getByRole("log").element();
    const turns = container.querySelectorAll<HTMLElement>("[data-conversation-turn]");
    const anchor = turns.item(4);

    // 先完成任务切换置底，再模拟用户向上阅读并记录当前视觉锚点。
    container.scrollTop = container.scrollHeight - container.clientHeight;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    container.scrollTop += anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - 80;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    const anchorTop = anchor.getBoundingClientRect().top;

    turns.item(0).style.height = "1,140px";
    await nextFrame();
    await nextFrame();

    expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(1);
  });
});
