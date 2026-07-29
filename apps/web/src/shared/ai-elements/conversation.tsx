import { ArrowDown } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";

import { createConversationAutoScrollController } from "./conversation-scroll.js";

type ConversationProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    conversationId: string;
  }>;

type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  scrollToBottom: () => void;
}>;

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function Conversation({
  children,
  className = "",
  conversationId,
  onScroll,
  ...props
}: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const autoScrollControllerRef = useRef<
    ReturnType<typeof createConversationAutoScrollController> | undefined
  >(undefined);
  const autoScrollController =
    autoScrollControllerRef.current ??
    (autoScrollControllerRef.current = createConversationAutoScrollController(setAtBottom));

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (container !== null) {
      autoScrollController.scrollToBottom(container);
    }
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // 先开启强制跟随，再等待长 Timeline 的延迟布局连续稳定后执行最终置底。
    autoScrollController.handleConversationChange(container);
    let previousScrollHeight = -1;
    let stableFrameCount = 0;
    let observedFrameCount = 0;
    let animationFrameId = 0;

    const settleConversationAtBottom = () => {
      autoScrollController.handleContentResize(container);
      const currentScrollHeight = container.scrollHeight;
      stableFrameCount = currentScrollHeight === previousScrollHeight ? stableFrameCount + 1 : 0;
      previousScrollHeight = currentScrollHeight;
      observedFrameCount += 1;

      // 连续两帧高度稳定即可视为消息布局完成；上限避免持续流式内容无限占用动画帧。
      if (stableFrameCount >= 2 || observedFrameCount >= 60) {
        autoScrollController.handleConversationRenderComplete(container);
        return;
      }
      animationFrameId = requestAnimationFrame(settleConversationAtBottom);
    };

    animationFrameId = requestAnimationFrame(settleConversationAtBottom);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [autoScrollController, conversationId]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const content = container.firstElementChild;

    const contentResizeObserver = new ResizeObserver(() => {
      autoScrollController.handleContentResize(container);
    });
    // Task 切换后消息内容与 Composer 可能分阶段完成布局，两侧尺寸变化都要重新校准到底部。
    contentResizeObserver.observe(container);
    if (content !== null) {
      contentResizeObserver.observe(content);
    }

    return () => {
      contentResizeObserver.disconnect();
    };
  }, [autoScrollController]);

  return (
    <ConversationContext.Provider value={{ atBottom, scrollToBottom }}>
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
        onScroll={(event) => {
          const container = event.currentTarget;
          autoScrollController.handleScroll(container);
          onScroll?.(event);
        }}
        ref={containerRef}
        role="log"
        aria-live="off"
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

type ConversationScrollButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function ConversationScrollButton({
  className = "",
  onClick,
  type = "button",
  ...props
}: ConversationScrollButtonProps) {
  const context = useContext(ConversationContext);

  if (context?.atBottom !== false) {
    return null;
  }

  return (
    <button
      className={`sticky bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-pill bg-raised text-muted-foreground shadow-floating transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      title="回到底部"
      type={type}
      {...props}
      onClick={(event) => {
        context.scrollToBottom();
        onClick?.(event);
      }}
    >
      <ArrowDown className="size-4" aria-hidden="true" />
      <span className="sr-only">回到底部</span>
    </button>
  );
}
