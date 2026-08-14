const BOTTOM_PROXIMITY_THRESHOLD_PX = 24;

export type ConversationScrollTarget = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type AtBottomChangeHandler = (atBottom: boolean) => void;

export function createConversationAutoScrollController(onAtBottomChange: AtBottomChangeHandler) {
  let conversationRendering = false;
  let lastObservedClientHeight: number | undefined;
  let lastObservedScrollHeight: number | undefined;
  let programmaticScrollPending = false;
  let shouldFollowNewContent = true;

  const updateFollowState = (atBottom: boolean) => {
    shouldFollowNewContent = atBottom;
    onAtBottomChange(atBottom);
  };

  const scrollToBottom = (scrollTarget: ConversationScrollTarget, behavior: ScrollBehavior) => {
    const clientHeight = scrollTarget.clientHeight;
    const scrollHeight = scrollTarget.scrollHeight;
    lastObservedClientHeight = clientHeight;
    lastObservedScrollHeight = scrollHeight;
    programmaticScrollPending = true;
    scrollTarget.scrollTo({ behavior, top: scrollHeight });
    updateFollowState(true);
  };

  return {
    handleConversationChange(scrollTarget: ConversationScrollTarget) {
      // Task 消息完成分帧渲染前保持强制跟随，避免临时 scroll 事件关闭自动置底。
      conversationRendering = true;
      scrollToBottom(scrollTarget, "auto");
    },
    handleConversationRenderComplete(scrollTarget: ConversationScrollTarget) {
      // 使用最终布局高度完成最后一次置底，随后恢复正常的用户滚动判断。
      scrollToBottom(scrollTarget, "auto");
      conversationRendering = false;
    },
    handleContentResize(scrollTarget: ConversationScrollTarget) {
      if (shouldFollowNewContent) {
        // 流式内容增长时直接跟随，避免连续 smooth 动画相互堆叠。
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;
    },
    handleScroll(scrollTarget: ConversationScrollTarget, userInitiated = true) {
      if (programmaticScrollPending && !userInitiated) {
        programmaticScrollPending = false;
        return;
      }
      programmaticScrollPending = false;

      if (conversationRendering) {
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const clientHeight = scrollTarget.clientHeight;
      const scrollHeight = scrollTarget.scrollHeight;
      const viewportHeightChanged =
        lastObservedClientHeight !== undefined && clientHeight !== lastObservedClientHeight;
      const contentHeightIncreased =
        lastObservedScrollHeight !== undefined && scrollHeight > lastObservedScrollHeight;
      lastObservedClientHeight = clientHeight;
      lastObservedScrollHeight = scrollHeight;

      if (shouldFollowNewContent && (contentHeightIncreased || viewportHeightChanged)) {
        // 内容增长或中栏高度变化可能先触发 scroll；布局变化不应被当成用户离开底部。
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const distanceFromBottom = scrollHeight - scrollTarget.scrollTop - clientHeight;
      updateFollowState(distanceFromBottom < BOTTOM_PROXIMITY_THRESHOLD_PX);
    },
    scrollToBottom(scrollTarget: ConversationScrollTarget) {
      scrollToBottom(scrollTarget, "smooth");
    },
  };
}
