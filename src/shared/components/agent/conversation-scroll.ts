const BOTTOM_PROXIMITY_THRESHOLD_PX = 24;

export type ConversationScrollTarget = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type AtBottomChangeHandler = (atBottom: boolean) => void;

type ConversationLayoutRecoveryOptions = Readonly<{
  cancelFrame: (frameId: number) => void;
  recover: () => void;
  requestFrame: (callback: () => void) => number;
  scrollTarget: ConversationScrollTarget;
}>;

type RecoveryEventTarget = Readonly<{
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}>;

type ConversationLayoutRecoveryObserverOptions = Readonly<{
  cancelFrame: (frameId: number) => void;
  documentTarget: RecoveryEventTarget & Readonly<{ visibilityState: DocumentVisibilityState }>;
  recover: () => void;
  requestFrame: (callback: () => void) => number;
  scrollTarget: ConversationScrollTarget;
  windowTarget: RecoveryEventTarget;
}>;

export function scheduleConversationLayoutRecovery({
  cancelFrame,
  recover,
  requestFrame,
  scrollTarget,
}: ConversationLayoutRecoveryOptions): () => void {
  const recovery = createConversationLayoutRecovery({
    cancelFrame,
    recover,
    requestFrame,
    scrollTarget,
  });
  recovery.run();
  return recovery.dispose;
}

function createConversationLayoutRecovery({
  cancelFrame,
  recover,
  requestFrame,
  scrollTarget,
}: ConversationLayoutRecoveryOptions) {
  let layoutFrameId = 0;
  let restoreFrameId = 0;
  let restoreScrollTop: number | undefined;
  const restoreScrollPosition = () => {
    if (restoreScrollTop === undefined) return;
    const maximumScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
    scrollTarget.scrollTo({
      behavior: "auto",
      top: Math.min(restoreScrollTop, maximumScrollTop),
    });
    restoreScrollTop = undefined;
  };
  const run = () => {
    cancelFrame(layoutFrameId);
    cancelFrame(restoreFrameId);
    restoreScrollPosition();
    recover();
    layoutFrameId = requestFrame(() => {
      recover();
      const maximumScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
      const currentScrollTop = Math.min(Math.max(0, scrollTarget.scrollTop), maximumScrollTop);
      const nextScrollTop = currentScrollTop > 0 ? currentScrollTop - 1 : Math.min(1, maximumScrollTop);
      if (nextScrollTop === currentScrollTop) return;

      // 真实滚动失效才能唤醒 WKWebView 已休眠的滚动合成层，下一帧恢复原位置避免可见跳动。
      restoreScrollTop = currentScrollTop;
      scrollTarget.scrollTo({ behavior: "auto", top: nextScrollTop });
      restoreFrameId = requestFrame(restoreScrollPosition);
    });
  };
  const dispose = () => {
    cancelFrame(layoutFrameId);
    cancelFrame(restoreFrameId);
    restoreScrollPosition();
  };
  return { dispose, run };
}

export function observeConversationLayoutRecovery({
  cancelFrame,
  documentTarget,
  recover,
  requestFrame,
  scrollTarget,
  windowTarget,
}: ConversationLayoutRecoveryObserverOptions): () => void {
  const recovery = createConversationLayoutRecovery({
    cancelFrame,
    recover,
    requestFrame,
    scrollTarget,
  });
  const recoverVisibleLayout = () => {
    if (documentTarget.visibilityState !== "visible") return;
    recovery.run();
  };

  documentTarget.addEventListener("visibilitychange", recoverVisibleLayout);
  windowTarget.addEventListener("focus", recoverVisibleLayout);
  return () => {
    recovery.dispose();
    documentTarget.removeEventListener("visibilitychange", recoverVisibleLayout);
    windowTarget.removeEventListener("focus", recoverVisibleLayout);
  };
}

export function createConversationAutoScrollController(onAtBottomChange: AtBottomChangeHandler) {
  let conversationRendering = false;
  let lastObservedClientHeight: number | undefined;
  let lastObservedScrollHeight: number | undefined;
  let shouldFollowNewContent = true;

  const updateFollowState = (atBottom: boolean) => {
    shouldFollowNewContent = atBottom;
    onAtBottomChange(atBottom);
  };

  const scrollToBottom = (scrollTarget: ConversationScrollTarget, behavior: ScrollBehavior) => {
    lastObservedClientHeight = scrollTarget.clientHeight;
    lastObservedScrollHeight = scrollTarget.scrollHeight;
    scrollTarget.scrollTo({ behavior, top: scrollTarget.scrollHeight });
    updateFollowState(true);
  };

  return {
    handleConversationChange(scrollTarget: ConversationScrollTarget) {
      // Task 消息完成分帧渲染前保持强制跟随，避免临时 scroll 事件关闭自动置底。
      conversationRendering = true;
      scrollToBottom(scrollTarget, "auto");
    },
    handleConversationRenderComplete(scrollTarget: ConversationScrollTarget) {
      // 使用当前布局高度继续置底；真实 scroll 到达底部后再结束切换保护。
      scrollToBottom(scrollTarget, "auto");
    },
    handleContentResize(scrollTarget: ConversationScrollTarget) {
      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;
      if (!shouldFollowNewContent) {
        return;
      }

      // 流式内容增长时直接跟随，避免连续 smooth 动画相互堆叠。
      scrollToBottom(scrollTarget, "auto");
    },
    handleLayoutRevision(scrollTarget: ConversationScrollTarget) {
      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;
      if (shouldFollowNewContent) {
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const maximumScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
      if (scrollTarget.scrollTop <= maximumScrollTop) {
        return;
      }

      // 用户离底时只夹紧已失效的位置，避免终态收缩后把有效阅读位置强制拉到底部。
      scrollTarget.scrollTo({ behavior: "auto", top: maximumScrollTop });
      updateFollowState(true);
    },
    handleScroll(scrollTarget: ConversationScrollTarget) {
      const distanceFromBottom =
        scrollTarget.scrollHeight - scrollTarget.scrollTop - scrollTarget.clientHeight;
      if (conversationRendering) {
        if (distanceFromBottom < BOTTOM_PROXIMITY_THRESHOLD_PX) {
          conversationRendering = false;
          updateFollowState(true);
        } else {
          // content-visibility 可能在后续帧修正高度，切换完成前持续夹紧到底部。
          scrollToBottom(scrollTarget, "auto");
        }
        return;
      }

      const viewportHeightChanged =
        lastObservedClientHeight !== undefined &&
        scrollTarget.clientHeight !== lastObservedClientHeight;
      const contentHeightIncreased =
        lastObservedScrollHeight !== undefined &&
        scrollTarget.scrollHeight > lastObservedScrollHeight;
      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;

      if (shouldFollowNewContent && (contentHeightIncreased || viewportHeightChanged)) {
        // 内容增长或中栏高度变化可能先触发 scroll；布局变化不应被当成用户离开底部。
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      updateFollowState(distanceFromBottom < BOTTOM_PROXIMITY_THRESHOLD_PX);
    },
    pauseFollowing() {
      // 历史导航前停用贴底，避免内容尺寸变化把用户重新带回最新消息。
      updateFollowState(false);
    },
    scrollToBottom(scrollTarget: ConversationScrollTarget) {
      scrollToBottom(scrollTarget, "smooth");
    },
  };
}
