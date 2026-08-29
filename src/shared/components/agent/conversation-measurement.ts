export function measureConversationTurn(
  element: HTMLElement,
  entry?: ResizeObserverEntry,
): number {
  const borderBoxSize = entry?.borderBoxSize[0];
  if (borderBoxSize !== undefined) {
    // 流式阶段复用浏览器已计算的边框盒尺寸，避免 ResizeObserver 回调再次触发布局读取。
    return Math.round(borderBoxSize.blockSize);
  }

  // 完成态和前台恢复没有 ResizeObserverEntry，必须读取真实高度以覆盖虚拟列表旧缓存。
  return element.offsetHeight;
}

export function resizeConversationTurn(
  element: HTMLElement,
  resizeItem: (index: number, size: number) => void,
  entry?: ResizeObserverEntry,
): void {
  const index = Number.parseInt(element.dataset["index"] ?? "", 10);
  if (!Number.isSafeInteger(index) || index < 0) return;

  // 直接写入尺寸可绕过 measureElement 在滚动期间跳过同步测量的内部保护。
  resizeItem(index, measureConversationTurn(element, entry));
}

export function shouldAdjustConversationScrollPositionOnItemSizeChange(
  item: Readonly<{ start: number }>,
  _delta: number,
  virtualizer: Readonly<{
    scrollAdjustments: number;
    scrollOffset: number | null;
  }>,
): boolean {
  const viewportStart = (virtualizer.scrollOffset ?? 0) + virtualizer.scrollAdjustments;

  // 视口上方的修正必须同步补偿，避免反向滚动时新高度与旧 top 分帧提交。
  return item.start < viewportStart;
}

export function shouldDeferConversationTurnResize(
  item: Readonly<{ start: number }>,
  virtualizer: Readonly<{
    isScrolling: boolean;
    scrollAdjustments: number;
    scrollDirection: "backward" | "forward" | null;
    scrollOffset: number | null;
  }>,
): boolean {
  const viewportStart = (virtualizer.scrollOffset ?? 0) + virtualizer.scrollAdjustments;

  // 反向滚动时保持当前估算布局，待滚动结束再校准视口上方的真实高度。
  return (
    virtualizer.isScrolling &&
    virtualizer.scrollDirection === "backward" &&
    item.start < viewportStart
  );
}
