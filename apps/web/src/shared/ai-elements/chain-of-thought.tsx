import { Brain, ChevronDown, Dot, type LucideIcon } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";

type ChainOfThoughtContextValue = Readonly<{
  isCollapsible: boolean;
  isOpen: boolean;
}>;

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null);

export type ChainOfThoughtProps = HTMLAttributes<HTMLDetailsElement> & {
  collapsible?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export const ChainOfThought = memo(function ChainOfThought({
  children,
  className = "",
  collapsible = true,
  defaultOpen = false,
  onOpenChange,
  open,
  ...props
}: ChainOfThoughtProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const contextValue = useMemo(
    () => ({ isCollapsible: collapsible, isOpen }),
    [collapsible, isOpen],
  );

  if (!collapsible) {
    return (
      <ChainOfThoughtContext.Provider value={contextValue}>
        <div className={`not-prose w-full ${className}`} data-ai-chain-of-thought="">
          {children}
        </div>
      </ChainOfThoughtContext.Provider>
    );
  }

  return (
    <ChainOfThoughtContext.Provider value={contextValue}>
      {/* 原生 details 会保留已完成思考的 DOM，收起后仍可随时查看。 */}
      <details
        className={`group/chain-of-thought not-prose w-full ${className}`}
        data-ai-chain-of-thought=""
        data-state={isOpen ? "open" : "closed"}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          if (open === undefined) {
            setUncontrolledOpen(nextOpen);
          }
          onOpenChange?.(nextOpen);
        }}
        open={isOpen}
        {...props}
      >
        {children}
      </details>
    </ChainOfThoughtContext.Provider>
  );
});

export type ChainOfThoughtHeaderProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

export function ChainOfThoughtHeader({
  children = "思考过程",
  className = "",
  ...props
}: ChainOfThoughtHeaderProps) {
  const context = useContext(ChainOfThoughtContext);
  const content = (
    <>
      <Brain className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {context?.isCollapsible === true ? (
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-open/chain-of-thought:rotate-180"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  if (context?.isCollapsible !== true) {
    return (
      <div
        className={`flex min-h-8 items-center gap-2 text-body-small text-muted-foreground ${className}`}
        {...props}
      >
        {content}
      </div>
    );
  }

  return (
    <summary
      className={`flex min-h-8 cursor-pointer list-none items-center gap-2 text-body-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      {...props}
    >
      {content}
    </summary>
  );
}

export type ChainOfThoughtContentProps = HTMLAttributes<HTMLDivElement>;

export const ChainOfThoughtContent = memo(function ChainOfThoughtContent({
  children,
  className = "",
  ...props
}: ChainOfThoughtContentProps) {
  return (
    <div className={`mt-1 space-y-3 pl-1.5 ${className}`} {...props}>
      {children}
    </div>
  );
});

export type ChainOfThoughtStepProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  description?: string;
  icon?: LucideIcon;
  label: ReactNode;
  status?: "active" | "complete" | "pending";
};

const stepStatusClasses = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-subtle-foreground",
} as const;

export const ChainOfThoughtStep = memo(function ChainOfThoughtStep({
  className = "",
  description,
  icon: Icon = Dot,
  label,
  status = "complete",
  ...props
}: ChainOfThoughtStepProps) {
  return (
    <div
      className={`flex gap-2 text-body-small ${stepStatusClasses[status]} ${className}`}
      data-status={status}
      {...props}
    >
      <div className="relative mt-1 shrink-0">
        <Icon className="size-3.5" aria-hidden="true" />
        <div className="absolute bottom-0 left-1/2 top-5 w-px -translate-x-1/2 bg-separator" />
      </div>
      <div className="min-w-0 flex-1 space-y-1 overflow-hidden pb-1">
        <div>{label}</div>
        {description === undefined || description.trim().length === 0 ? null : (
          <div className="text-label leading-5 text-muted-foreground">
            <Streamdown controls={false}>{description}</Streamdown>
          </div>
        )}
      </div>
    </div>
  );
});

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
