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
  measuredSize = measureConversationTurn(element, entry),
): void {
  const index = Number.parseInt(element.dataset["index"] ?? "", 10);
  if (!Number.isSafeInteger(index) || index < 0) return;

  // 直接写入尺寸可绕过 measureElement 在滚动期间跳过同步测量的内部保护。
  resizeItem(index, measuredSize);
}

export function shouldAdjustConversationScrollPositionOnItemSizeChange(
  item: Readonly<{ end: number }>,
  _delta: number,
  virtualizer: Readonly<{
    scrollAdjustments: number;
    scrollOffset: number | null;
  }>,
): boolean {
  const viewportStart = (virtualizer.scrollOffset ?? 0) + virtualizer.scrollAdjustments;

  // 只补偿完整位于视口上方的 Turn；覆盖视口的完成态收缩由浏览器夹到有效范围。
  return item.end <= viewportStart;
}

export function shouldDeferConversationTurnResize(
  item: Readonly<{ end: number; start: number }>,
  nextSize: number,
  virtualizer: Readonly<{
    isScrolling: boolean;
    scrollAdjustments: number;
    scrollDirection: "backward" | "forward" | null;
    scrollOffset: number | null;
  }>,
): boolean {
  const viewportStart = (virtualizer.scrollOffset ?? 0) + virtualizer.scrollAdjustments;
  const collapseRemovesViewportContent =
    item.end > viewportStart && item.start + nextSize <= viewportStart;

  // 收缩后不再覆盖视口时必须立即校准，否则旧 sizer 与新 DOM 之间会形成空白区域。
  return (
    virtualizer.isScrolling &&
    virtualizer.scrollDirection === "backward" &&
    item.start < viewportStart &&
    !collapseRemovesViewportContent
  );
}
