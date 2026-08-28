type RecoveryEventTarget = Readonly<{
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}>;

type ConversationViewportRecoveryScheduleOptions = Readonly<{
  cancelFrame: (frameId: number) => void;
  frameId: number;
  isFollowing: () => boolean;
  measure: () => void;
  requestFrame: (callback: () => void) => number;
  scrollToEnd: () => void;
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

export function scheduleConversationViewportRecovery({
  cancelFrame,
  frameId,
  isFollowing,
  measure,
  requestFrame,
  scrollToEnd,
}: ConversationViewportRecoveryScheduleOptions): number {
  cancelFrame(frameId);
  // 同步修正当前提交的尺寸，下一帧再覆盖 ResizeObserver 与 WebKit 合成延迟。
  measure();
  return requestFrame(() => {
    measure();
    if (isFollowing()) {
      scrollToEnd();
    }
  });
}

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

    frameId = scheduleConversationViewportRecovery({
      cancelFrame,
      frameId,
      isFollowing,
      measure,
      requestFrame,
      scrollToEnd,
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
