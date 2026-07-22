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

type ConversationProps = HTMLAttributes<HTMLDivElement>;

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  scrollToBottom: () => void;
}>;

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function Conversation({ children, className = "", onScroll, ...props }: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ behavior: "smooth", top: containerRef.current.scrollHeight });
    setAtBottom(true);
  };

  useEffect(() => {
    // 首次打开 Task 时定位到最新内容，后续仅在用户主动回到底部时滚动。
    const container = containerRef.current;
    if (container !== null) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  return (
    <ConversationContext.Provider value={{ atBottom, scrollToBottom }}>
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
        onScroll={(event) => {
          const container = event.currentTarget;
          setAtBottom(container.scrollHeight - container.scrollTop - container.clientHeight < 24);
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
