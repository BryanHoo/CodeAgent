const BOTTOM_PROXIMITY_THRESHOLD_PX = 24;

export type ConversationScrollTarget = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type AtBottomChangeHandler = (atBottom: boolean) => void;

type ConversationLayoutRecoveryOptions = Readonly<{
  cancelFrame: (frameId: number) => void;
  frameId: number;
  recover: () => void;
  requestFrame: (callback: () => void) => number;
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
  windowTarget: RecoveryEventTarget;
}>;

export function scheduleConversationLayoutRecovery({
  cancelFrame,
  frameId,
  recover,
  requestFrame,
}: ConversationLayoutRecoveryOptions): number {
  cancelFrame(frameId);
  // 当前提交先同步校正，下一帧再覆盖 WKWebView 延迟更新滚动范围的情况。
  recover();
  return requestFrame(recover);
}

export function observeConversationLayoutRecovery({
  cancelFrame,
  documentTarget,
  recover,
  requestFrame,
  windowTarget,
}: ConversationLayoutRecoveryObserverOptions): () => void {
  let frameId = 0;
  const recoverVisibleLayout = () => {
    if (documentTarget.visibilityState !== "visible") return;
    // WebKit 回到前台后会延迟重建滚动范围，因此激活时重新执行双阶段校准。
    frameId = scheduleConversationLayoutRecovery({
      cancelFrame,
      frameId,
      recover,
      requestFrame,
    });
  };

  documentTarget.addEventListener("visibilitychange", recoverVisibleLayout);
  windowTarget.addEventListener("focus", recoverVisibleLayout);
  return () => {
    cancelFrame(frameId);
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
      // 使用最终布局高度完成最后一次置底，随后恢复正常的用户滚动判断。
      scrollToBottom(scrollTarget, "auto");
      conversationRendering = false;
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
      if (conversationRendering) {
        scrollToBottom(scrollTarget, "auto");
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

      const distanceFromBottom =
        scrollTarget.scrollHeight - scrollTarget.scrollTop - scrollTarget.clientHeight;
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
