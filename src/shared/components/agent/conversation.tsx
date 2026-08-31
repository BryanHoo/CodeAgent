import { ArrowDown } from "lucide-react";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import {
  createConversationAutoScrollController,
  createConversationVisualAnchorController,
  observeConversationLayoutRecovery,
  scheduleConversationLayoutRecovery,
  type ConversationVisualAnchor,
} from "./conversation-scroll.js";

type ConversationProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    conversationId: string;
    layoutRevision?: number;
    scrollToBottomSignal?: number;
  }>;

type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  pauseFollowing: () => void;
  scrollbarWidth: number;
  scrollToBottom: () => void;
}>;

const ConversationContext = createContext<ConversationContextValue | null>(null);
const COLD_TURN_INTRINSIC_BLOCK_SIZE_PX = 300;

function findConversationVisualAnchor(container: HTMLDivElement): ConversationVisualAnchor | undefined {
  const containerRect = container.getBoundingClientRect();
  const x = containerRect.left + container.clientWidth / 2;
  const sampleOffsets = [1, 32, 96];
  for (const offset of sampleOffsets) {
    const y = Math.min(containerRect.bottom - 1, containerRect.top + offset);
    for (const element of container.ownerDocument.elementsFromPoint(x, y)) {
      const turn = element.closest<HTMLElement>("[data-conversation-turn]");
      if (turn !== null && container.contains(turn)) return turn;
    }
  }

  // 顶部恰好落在 Turn 间距时，用有序自然流二分查找首个可见 Turn。
  const turns = container.querySelectorAll<HTMLElement>("[data-conversation-turn]");
  let low = 0;
  let high = turns.length - 1;
  let visible: HTMLElement | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const turn = turns.item(middle);
    if (turn.getBoundingClientRect().bottom > containerRect.top) {
      visible = turn;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return visible;
}

function useConversationContext(): ConversationContextValue {
  const context = useContext(ConversationContext);
  if (context === null) {
    throw new Error("Conversation components must be used within Conversation");
  }
  return context;
}

export function Conversation({
  children,
  className = "",
  conversationId,
  layoutRevision,
  onScroll,
  scrollToBottomSignal,
  style,
  ...props
}: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousScrollToBottomSignalRef = useRef(scrollToBottomSignal);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const autoScrollControllerRef = useRef<
    ReturnType<typeof createConversationAutoScrollController> | undefined
  >(undefined);
  const autoScrollController =
    autoScrollControllerRef.current ??
    (autoScrollControllerRef.current = createConversationAutoScrollController(setAtBottom));
  const visualAnchorControllerRef = useRef<
    ReturnType<typeof createConversationVisualAnchorController> | undefined
  >(undefined);
  const visualAnchorController =
    visualAnchorControllerRef.current ??
    (visualAnchorControllerRef.current = createConversationVisualAnchorController());

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container !== null) {
      autoScrollController.scrollToBottom(container);
    }
  }, [autoScrollController]);
  const pauseFollowing = useCallback(() => {
    autoScrollController.pauseFollowing();
  }, [autoScrollController]);
  const contextValue = useMemo(
    () => ({ atBottom, containerRef, pauseFollowing, scrollbarWidth, scrollToBottom }),
    [atBottom, pauseFollowing, scrollbarWidth, scrollToBottom],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // 切换会话后保持置底到下一帧，后续异步内容变化由 ResizeObserver 继续跟随。
    visualAnchorController.clear();
    autoScrollController.handleConversationChange(container);
    const animationFrameId = requestAnimationFrame(() => {
      autoScrollController.handleConversationRenderComplete(container);
    });
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [autoScrollController, conversationId, visualAnchorController]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || layoutRevision === undefined) {
      return;
    }

    return scheduleConversationLayoutRecovery({
      cancelFrame: cancelAnimationFrame,
      recover: () => {
        autoScrollController.handleLayoutRevision(container);
      },
      requestFrame: requestAnimationFrame,
      scrollTarget: container,
    });
  }, [autoScrollController, layoutRevision]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    return observeConversationLayoutRecovery({
      cancelFrame: cancelAnimationFrame,
      documentTarget: document,
      recover: () => {
        autoScrollController.handleLayoutRevision(container);
      },
      requestFrame: requestAnimationFrame,
      scrollTarget: container,
      windowTarget: window,
    });
  }, [autoScrollController]);

  useLayoutEffect(() => {
    if (
      scrollToBottomSignal === undefined ||
      scrollToBottomSignal === previousScrollToBottomSignalRef.current
    ) {
      return;
    }
    previousScrollToBottomSignalRef.current = scrollToBottomSignal;
    const container = containerRef.current;
    if (container !== null) {
      // 用户直接提交时恢复自动跟随，后续用户消息和流式回复继续保持在底部。
      autoScrollController.scrollToBottom(container);
    }
  }, [autoScrollController, scrollToBottomSignal]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const content =
      container.querySelector<HTMLElement>("[data-conversation-content]") ??
      container.firstElementChild;

    const syncScrollbarWidth = () => {
      const nextWidth = Math.max(0, container.offsetWidth - container.clientWidth);
      // 只在平台实际滚动条占位变化时更新，避免消息测量触发无意义重渲染。
      setScrollbarWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };
    const contentResizeObserver = new ResizeObserver(() => {
      if (!autoScrollController.isFollowing()) {
        visualAnchorController.recover(container);
      }
      syncScrollbarWidth();
      autoScrollController.handleContentResize(container);
    });
    syncScrollbarWidth();
    // Task 切换后消息内容与 Composer 可能分阶段完成布局，两侧尺寸变化都要重新校准到底部。
    contentResizeObserver.observe(container);
    if (content !== null) {
      contentResizeObserver.observe(content);
    }

    return () => {
      contentResizeObserver.disconnect();
    };
  }, [autoScrollController, visualAnchorController]);

  return (
    <ConversationContext.Provider value={contextValue}>
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
        onScroll={(event) => {
          const container = event.currentTarget;
          autoScrollController.handleScroll(container);
          if (autoScrollController.isFollowing()) {
            visualAnchorController.clear();
          } else {
            visualAnchorController.capture(findConversationVisualAnchor(container));
          }
          onScroll?.(event);
        }}
        ref={containerRef}
        role="log"
        aria-live="off"
        style={style}
        {...props}
      >
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({ className = "", ...props }: ConversationContentProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-content flex-col px-4 py-6 sm:px-6 sm:py-7 ${className}`}
      {...props}
    />
  );
}

export type ConversationItemRenderMode = "cold" | "hot";

export type ConversationListProps<TItem> = Omit<HTMLAttributes<HTMLDivElement>, "children"> &
  Readonly<{
    footer?: ReactNode;
    getItemKey: (item: TItem, index: number) => Key;
    getItemRenderMode?: (item: TItem, index: number) => ConversationItemRenderMode;
    items: readonly TItem[];
    renderNavigation?: (
      navigateToAnchor: (anchorId: string) => void,
      scrollbarWidth: number,
      scrollContainerRef: RefObject<HTMLDivElement | null>,
    ) => ReactNode;
    renderItem: (item: TItem, index: number) => ReactNode;
  }>;

export function ConversationList<TItem>({
  className = "",
  footer,
  getItemKey,
  getItemRenderMode,
  items,
  renderNavigation,
  renderItem,
  ...props
}: ConversationListProps<TItem>) {
  const { containerRef, pauseFollowing, scrollbarWidth } = useConversationContext();
  const navigateToAnchor = useCallback(
    (anchorId: string) => {
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const anchor = Array.from(
        container.querySelectorAll<HTMLElement>("[data-conversation-anchor]"),
      ).find((element) => element.dataset["conversationAnchor"] === anchorId);
      if (anchor === undefined) return;

      pauseFollowing();
      anchor.scrollIntoView({ block: "start" });
    },
    [containerRef, pauseFollowing],
  );

  return (
    <>
      {renderNavigation?.(navigateToAnchor, scrollbarWidth, containerRef)}
      <div
        className={`mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-6 sm:px-6 sm:py-7 ${className}`}
        data-conversation-content=""
        {...props}
      >
        {items.map((item, index) => {
          const renderMode = getItemRenderMode?.(item, index) ?? "hot";
          return (
            <div
              className="w-full"
              data-conversation-turn=""
              data-index={index}
              data-render-mode={renderMode}
              key={getItemKey(item, index)}
              style={
                renderMode === "cold"
                  ? {
                      containIntrinsicBlockSize: `auto ${String(COLD_TURN_INTRINSIC_BLOCK_SIZE_PX)}px`,
                      contentVisibility: "auto",
                    }
                  : undefined
              }
            >
              {renderItem(item, index)}
            </div>
          );
        })}
        {footer === undefined ? null : <div className="space-y-6">{footer}</div>}
      </div>
    </>
  );
}

type ConversationScrollButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function ConversationScrollButton({
  className = "",
  onClick,
  type = "button",
  ...props
}: ConversationScrollButtonProps) {
  const context = useContext(ConversationContext);
  const { t } = useTranslation("conversation");

  if (context?.atBottom !== false) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      className={`sticky bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-pill bg-raised text-muted-foreground shadow-floating transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      title={t("agentComponents.scrollToBottom")}
      type={type}
      {...props}
      onClick={(event) => {
        context.scrollToBottom();
        onClick?.(event);
      }}
    >
      <ArrowDown className="size-4" aria-hidden="true" />
      <span className="sr-only">{t("agentComponents.scrollToBottom")}</span>
    </Button>
  );
}
