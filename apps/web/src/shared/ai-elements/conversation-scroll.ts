const BOTTOM_PROXIMITY_THRESHOLD_PX = 24;

export type ConversationScrollTarget = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type AtBottomChangeHandler = (atBottom: boolean) => void;

export function createConversationAutoScrollController(onAtBottomChange: AtBottomChangeHandler) {
  let lastObservedScrollHeight: number | undefined;
  let shouldFollowNewContent = true;

  const updateFollowState = (atBottom: boolean) => {
    shouldFollowNewContent = atBottom;
    onAtBottomChange(atBottom);
  };

  const scrollToBottom = (scrollTarget: ConversationScrollTarget, behavior: ScrollBehavior) => {
    lastObservedScrollHeight = scrollTarget.scrollHeight;
    scrollTarget.scrollTo({ behavior, top: scrollTarget.scrollHeight });
    updateFollowState(true);
  };

  return {
    handleContentResize(scrollTarget: ConversationScrollTarget) {
      lastObservedScrollHeight = scrollTarget.scrollHeight;
      if (!shouldFollowNewContent) {
        return;
      }

      // 流式内容增长时直接跟随，避免连续 smooth 动画相互堆叠。
      scrollToBottom(scrollTarget, "auto");
    },
    handleScroll(scrollTarget: ConversationScrollTarget) {
      const contentHeightIncreased =
        lastObservedScrollHeight !== undefined &&
        scrollTarget.scrollHeight > lastObservedScrollHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;

      if (shouldFollowNewContent && contentHeightIncreased) {
        // 大段内容插入可能先触发 scroll；这是布局变化，不应被当成用户离开底部。
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const distanceFromBottom =
        scrollTarget.scrollHeight - scrollTarget.scrollTop - scrollTarget.clientHeight;
      updateFollowState(distanceFromBottom < BOTTOM_PROXIMITY_THRESHOLD_PX);
    },
    scrollToBottom(scrollTarget: ConversationScrollTarget) {
      scrollToBottom(scrollTarget, "smooth");
    },
  };
}
