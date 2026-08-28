type RecoveryEventTarget = Readonly<{
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}>;

type ConversationViewportRecoveryOptions = Readonly<{
  cancelFrame: (frameId: number) => void;
  documentTarget: RecoveryEventTarget & Readonly<{ visibilityState: string }>;
  isFollowing: () => boolean;
  measure: () => void;
  requestFrame: (callback: () => void) => number;
  scrollToEnd: () => void;
  windowTarget: RecoveryEventTarget;
}>;

export function observeConversationViewportRecovery({
  cancelFrame,
  documentTarget,
  isFollowing,
  measure,
  requestFrame,
  scrollToEnd,
  windowTarget,
}: ConversationViewportRecoveryOptions): () => void {
  let frameId = 0;

  const recoverViewport = () => {
    if (documentTarget.visibilityState !== "visible") {
      return;
    }

    cancelFrame(frameId);
    // 后台期间 ResizeObserver 可能保留旧高度，恢复时先同步读取已挂载 Turn 的真实尺寸。
    measure();
    frameId = requestFrame(() => {
      measure();
      if (isFollowing()) {
        scrollToEnd();
      }
    });
  };

  documentTarget.addEventListener("visibilitychange", recoverViewport);
  windowTarget.addEventListener("focus", recoverViewport);

  return () => {
    cancelFrame(frameId);
    documentTarget.removeEventListener("visibilitychange", recoverViewport);
    windowTarget.removeEventListener("focus", recoverViewport);
  };
}
