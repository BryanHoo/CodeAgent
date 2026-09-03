import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";

const DEFAULT_TURN_ESTIMATED_HEIGHT_PX = 900;
const HEADER_ESTIMATED_HEIGHT_PX = 48;
const FOOTER_ESTIMATED_HEIGHT_PX = 160;
const TURN_GAP_PX = 24;
const TURN_OVERSCAN = 2;
const SCROLL_END_THRESHOLD_PX = 80;
const VERTICAL_PADDING_PX = 28;

type ItemBoundary = Readonly<{
  firstKey: Key;
  lastKey: Key;
  length: number;
}>;

type PrependScrollSnapshot = Readonly<{
  nextLength: number;
  scrollHeight: number;
  scrollTop: number;
}>;

export type ConversationVirtualListProps<TItem> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> &
  Readonly<{
    conversationId: string;
    footer?: ReactNode;
    getItemKey: (item: TItem, index: number) => Key;
    header?: ReactNode;
    items: readonly TItem[];
    renderNavigation?: (
      navigateToItem: (index: number, anchorId: string) => void,
      scrollbarWidth: number,
      scrollContainerRef: RefObject<HTMLDivElement | null>,
    ) => ReactNode;
    renderItem: (item: TItem, index: number) => ReactNode;
    scrollToBottomSignal?: number;
  }>;

export function ConversationVirtualList<TItem>({
  className = "",
  conversationId,
  footer,
  getItemKey,
  header,
  items,
  onScroll,
  renderNavigation,
  renderItem,
  scrollToBottomSignal,
  style,
  ...props
}: ConversationVirtualListProps<TItem>) {
  const { t } = useTranslation("conversation");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const navigationFrameRef = useRef(0);
  const lastObservedScrollTopRef = useRef(0);
  const committedItemBoundaryRef = useRef<ItemBoundary | null>(null);
  const prependScrollSnapshotRef = useRef<PrependScrollSnapshot | null>(null);
  const previousScrollToBottomSignalRef = useRef(scrollToBottomSignal);
  const [, commitColdJump] = useReducer((revision: number) => revision + 1, 0);
  const [atBottom, setAtBottom] = useState(true);
  const [initialScrolledConversationId, setInitialScrolledConversationId] = useState<string | null>(
    null,
  );
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const headerOffset = header === undefined ? 0 : 1;
  const footerOffset = footer === undefined ? 0 : 1;
  const count = headerOffset + items.length + footerOffset;
  const previousBoundary = committedItemBoundaryRef.current;
  const addedItemCount = previousBoundary === null ? 0 : items.length - previousBoundary.length;
  const scrollElementBeforeCommit = scrollContainerRef.current;
  if (
    previousBoundary !== null &&
    addedItemCount > 0 &&
    scrollElementBeforeCommit !== null &&
    Object.is(
      getItemKey(items[addedItemCount] as TItem, addedItemCount),
      previousBoundary.firstKey,
    ) &&
    Object.is(getItemKey(items[items.length - 1] as TItem, items.length - 1), previousBoundary.lastKey)
  ) {
    // React render 仍对应旧 DOM，此时记录 prepend 前的稳定视口位置。
    prependScrollSnapshotRef.current = {
      nextLength: items.length,
      scrollHeight: scrollElementBeforeCommit.scrollHeight,
      scrollTop: scrollElementBeforeCommit.scrollTop,
    };
  }
  const getVirtualKey = useCallback(
    (virtualIndex: number): string => {
      if (header !== undefined && virtualIndex === 0) return `${conversationId}:header`;
      const itemIndex = virtualIndex - headerOffset;
      if (itemIndex >= items.length) {
        const lastItemIndex = items.length - 1;
        const lastItemKey =
          lastItemIndex < 0 ? "empty" : getItemKey(items[lastItemIndex] as TItem, lastItemIndex);
        return `${conversationId}:footer:${typeof lastItemKey}:${String(lastItemKey)}`;
      }
      const itemKey = getItemKey(items[itemIndex] as TItem, itemIndex);
      return `${conversationId}:item:${typeof itemKey}:${String(itemKey)}`;
    },
    [conversationId, getItemKey, header, headerOffset, items],
  );
  const estimateSize = useCallback(
    (virtualIndex: number): number => {
      if (header !== undefined && virtualIndex === 0) return HEADER_ESTIMATED_HEIGHT_PX;
      return virtualIndex - headerOffset >= items.length
        ? FOOTER_ESTIMATED_HEIGHT_PX
        : DEFAULT_TURN_ESTIMATED_HEIGHT_PX;
    },
    [header, headerOffset, items.length],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    anchorTo: "end",
    count,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    estimateSize,
    followOnAppend: true,
    gap: TURN_GAP_PX,
    getItemKey: getVirtualKey,
    getScrollElement: () => scrollContainerRef.current,
    overscan: TURN_OVERSCAN,
    paddingStart: VERTICAL_PADDING_PX,
    scrollEndThreshold: SCROLL_END_THRESHOLD_PX,
    useFlushSync: false,
    onChange: (instance) => {
      const nextAtBottom = instance.isAtEnd();
      setAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom));
    },
  });

  useLayoutEffect(() => {
    const scrollElement = scrollContainerRef.current;
    const snapshot = prependScrollSnapshotRef.current;
    if (scrollElement !== null && snapshot?.nextLength === items.length) {
      const addedHeight = scrollElement.scrollHeight - snapshot.scrollHeight;
      scrollElement.scrollTop = snapshot.scrollTop + addedHeight;
      lastObservedScrollTopRef.current = scrollElement.scrollTop;
      prependScrollSnapshotRef.current = null;
    }
    committedItemBoundaryRef.current =
      items.length === 0
        ? null
        : {
            firstKey: getItemKey(items[0] as TItem, 0),
            lastKey: getItemKey(items[items.length - 1] as TItem, items.length - 1),
            length: items.length,
          };
  }, [getItemKey, items]);

  useLayoutEffect(() => {
    // 会话首次呈现时从最新 Turn 开始，后续追加和流式增长交给 end anchor。
    if (initialScrolledConversationId === conversationId) return;
    virtualizer.scrollToEnd({ behavior: "auto" });
    setInitialScrolledConversationId(conversationId);
    setAtBottom(true);
  }, [conversationId, initialScrolledConversationId, virtualizer]);
  useLayoutEffect(() => {
    if (
      scrollToBottomSignal === undefined ||
      scrollToBottomSignal === previousScrollToBottomSignalRef.current
    ) {
      return;
    }
    previousScrollToBottomSignalRef.current = scrollToBottomSignal;
    virtualizer.scrollToEnd({ behavior: "auto" });
  }, [scrollToBottomSignal, virtualizer]);
  useEffect(() => {
    const scrollElement = scrollContainerRef.current;
    if (scrollElement === null) return;
    const syncScrollbarWidth = () => {
      const nextWidth = Math.max(0, scrollElement.offsetWidth - scrollElement.clientWidth);
      setScrollbarWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    const observer = new ResizeObserver(syncScrollbarWidth);
    const commitWebKitColdJump = () => {
      const previousScrollTop = lastObservedScrollTopRef.current;
      lastObservedScrollTopRef.current = scrollElement.scrollTop;
      if (Math.abs(scrollElement.scrollTop - previousScrollTop) <= scrollElement.clientHeight * 2) {
        return;
      }
      const containerRect = scrollElement.getBoundingClientRect();
      const hasMountedRowInViewport = Array.from(
        scrollElement.querySelectorAll<HTMLElement>("[data-virtual-row]"),
      ).some((row) => {
        const rowRect = row.getBoundingClientRect();
        return rowRect.bottom > containerRect.top && rowRect.top < containerRect.bottom;
      });
      if (!hasMountedRowInViewport) {
        // TanStack 已在先注册的原生 listener 中计算新窗口，此处仅同步 WebKit 冷跳提交。
        flushSync(() => {
          commitColdJump();
        });
      }
    };
    syncScrollbarWidth();
    observer.observe(scrollElement);
    scrollElement.addEventListener("scroll", commitWebKitColdJump, { passive: true });
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", commitWebKitColdJump);
    };
  }, [commitColdJump]);

  const navigateToItem = useCallback(
    (index: number, anchorId: string) => {
      if (index < 0 || index >= items.length) return;
      cancelAnimationFrame(navigationFrameRef.current);
      virtualizer.scrollToIndex(index + headerOffset, { align: "start", behavior: "auto" });
      navigationFrameRef.current = requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        const anchor = container
          ? Array.from(
              container.querySelectorAll<HTMLElement>("[data-conversation-anchor]"),
            ).find((element) => element.dataset["conversationAnchor"] === anchorId)
          : undefined;
        anchor?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    },
    [headerOffset, items.length, virtualizer],
  );
  useLayoutEffect(
    () => () => {
      cancelAnimationFrame(navigationFrameRef.current);
    },
    [],
  );

  return (
    <div
      className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
      onScroll={onScroll}
      ref={scrollContainerRef}
      role="log"
      // 禁用浏览器原生锚定，避免与 Virtualizer 的 end anchor 重复修正滚动位置。
      style={{ ...style, overflowAnchor: "none" }}
      aria-live="off"
      {...props}
    >
      {renderNavigation?.(navigateToItem, scrollbarWidth, scrollContainerRef)}
      <div
        className="mx-auto w-full max-w-content px-4 sm:px-6"
        data-conversation-content=""
      >
        <div
          className="relative w-full"
          ref={virtualizer.containerRef}
          style={{ position: "relative", width: "100%" }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const itemIndex = virtualItem.index - headerOffset;
            const isHeader = header !== undefined && virtualItem.index === 0;
            const isFooter = itemIndex >= items.length;
            const isLastRow = virtualItem.index === count - 1;
            return (
              <div
                className="absolute left-0 w-full"
                data-conversation-turn={isHeader || isFooter ? undefined : ""}
                data-index={virtualItem.index}
                data-virtual-row={isHeader ? "header" : isFooter ? "footer" : "turn"}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{ left: 0, position: "absolute", width: "100%" }}
              >
                {isHeader
                  ? header
                  : isFooter
                    ? <div className="space-y-6">{footer}</div>
                    : renderItem(items[itemIndex] as TItem, itemIndex)}
                {isLastRow ? <div aria-hidden="true" style={{ height: VERTICAL_PADDING_PX }} /> : null}
              </div>
            );
          })}
        </div>
      </div>
      {atBottom ? null : (
        <Button
          variant="ghost"
          className="sticky bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-pill bg-raised text-muted-foreground shadow-floating transition-colors hover:bg-control-hover hover:text-foreground"
          onClick={() => {
            virtualizer.scrollToEnd({ behavior: "smooth" });
          }}
          title={t("agentComponents.scrollToBottom")}
          type="button"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("agentComponents.scrollToBottom")}</span>
        </Button>
      )}
    </div>
  );
}
