import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type HTMLAttributes, type Key, type ReactNode } from "react";

type ConversationContextValue = Readonly<{
  atBottom: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
}>;
const ConversationContext = createContext<ConversationContextValue | null>(null);
const DEFAULT_ESTIMATE_SIZE = () => 260;

export function Conversation({ className = "", onScroll, ...props }: HTMLAttributes<HTMLDivElement>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollToBottom = useCallback(() => containerRef.current?.scrollTo({ behavior: "smooth", top: containerRef.current.scrollHeight }), []);
  const context = useMemo(() => ({ atBottom, containerRef, scrollToBottom }), [atBottom, scrollToBottom]);
  return <ConversationContext.Provider value={context}><div aria-live="off" className={`ai-conversation ${className}`} data-ai-element="conversation" onScroll={(event) => { const element = event.currentTarget; setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 24); onScroll?.(event); }} ref={containerRef} role="log" {...props} /></ConversationContext.Provider>;
}

export function ConversationVirtualList<T>({
  estimateSize = DEFAULT_ESTIMATE_SIZE,
  footer,
  getItemKey,
  items,
  renderItem,
}: Readonly<{
  estimateSize?: (item: T, index: number) => number;
  footer?: ReactNode;
  getItemKey: (item: T, index: number) => Key;
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
}>) {
  const context = useContext(ConversationContext);
  if (context === null) throw new Error("ConversationVirtualList must be rendered inside Conversation");
  const getItem = (index: number) => {
    const item = items[index];
    if (item === undefined) throw new Error(`Conversation item ${String(index)} is missing`);
    return item;
  };
  // TanStack Virtual 返回不可稳定记忆化的方法，组件在此边界内直接消费。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    estimateSize: (index) => estimateSize(getItem(index), index),
    gap: 24,
    getItemKey: (index) => getItemKey(getItem(index), index),
    getScrollElement: () => context.containerRef.current,
    initialRect: { height: 768, width: 1024 },
    overscan: 3,
  });
  return <div className="ai-conversation-content" style={{ height: virtualizer.getTotalSize() + (footer === undefined ? 0 : 120) }}><div className="ai-conversation-virtual-layer">{virtualizer.getVirtualItems().map((virtualItem) => <div data-index={virtualItem.index} key={virtualItem.key} ref={virtualizer.measureElement} style={{ transform: `translateY(${String(virtualItem.start)}px)` }}>{renderItem(getItem(virtualItem.index), virtualItem.index)}</div>)}</div>{footer}</div>;
}

export function ConversationScrollButton() {
  const context = useContext(ConversationContext);
  if (context?.atBottom !== false) return null;
  return <button aria-label="滚动到底部" className="ai-conversation-scroll" onClick={context.scrollToBottom} type="button"><ArrowDownIcon aria-hidden="true" /></button>;
}
