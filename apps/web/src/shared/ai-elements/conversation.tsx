import { ArrowDown } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";

import { createConversationAutoScrollController } from "./conversation-scroll.js";

type ConversationProps = HTMLAttributes<HTMLDivElement>;

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  scrollToBottom: () => void;
}>;

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function Conversation({ children, className = "", onScroll, ...props }: ConversationProps) {
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

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const content = container.firstElementChild;

    // 初次打开及流式内容增长时跟随最新消息；用户离开底部后控制器会暂停跟随。
    autoScrollController.handleContentResize(container);
    const contentResizeObserver = new ResizeObserver(() => {
      autoScrollController.handleContentResize(container);
    });
    contentResizeObserver.observe(content ?? container);

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

export function ConversationContent({ className = "", ...props }: ConversationProps) {
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
