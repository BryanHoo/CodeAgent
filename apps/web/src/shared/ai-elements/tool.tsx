import {
  CheckCircle,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleX,
  Clock,
  Wrench,
} from "lucide-react";
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "../../i18n/i18n.js";
import { CodeBlock } from "./code-block.js";

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

type ToolProps = HTMLAttributes<HTMLDetailsElement> & {
  defaultOpen?: boolean;
};

const ToolOpenContext = createContext<boolean | null>(null);

export function Tool({ className = "", defaultOpen = false, onToggle, ...props }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <ToolOpenContext.Provider value={isOpen}>
      <details
        className={`group/tool w-full rounded-surface bg-control px-3 py-1 ${className}`}
        onToggle={(event) => {
          onToggle?.(event);
          if (!event.defaultPrevented) {
            setIsOpen(event.currentTarget.open);
          }
        }}
        open={isOpen}
        {...props}
      />
    </ToolOpenContext.Provider>
  );
}

const statusPresentation: Record<ToolState, { icon: ReactNode; labelKey: string }> = {
  "approval-requested": {
    icon: <Clock className="size-3.5 text-warning" aria-hidden="true" />,
    labelKey: "aiElements.status.waitingApproval",
  },
  "approval-responded": {
    icon: <CheckCircle className="size-3.5 text-primary" aria-hidden="true" />,
    labelKey: "aiElements.status.responded",
  },
  "input-available": {
    icon: <CircleDashed className="size-3.5 animate-spin" aria-hidden="true" />,
    labelKey: "aiElements.status.running",
  },
  "input-streaming": {
    icon: <Circle className="size-3.5" aria-hidden="true" />,
    labelKey: "aiElements.status.pending",
  },
  "output-available": {
    icon: <CheckCircle className="size-3.5" aria-hidden="true" />,
    labelKey: "aiElements.status.completed",
  },
  "output-denied": {
    icon: <CircleX className="size-3.5 text-warning" aria-hidden="true" />,
    labelKey: "aiElements.status.denied",
  },
  "output-error": {
    icon: <CircleX className="size-3.5 text-danger" aria-hidden="true" />,
    labelKey: "aiElements.status.error",
  },
};

type ToolHeaderProps = HTMLAttributes<HTMLElement> & {
  state: ToolState;
  title: string;
};

const toolTitleTooltipGap = 8;
const toolTitleTooltipViewportPadding = 8;

type ToolTitleTooltipPosition = Readonly<{
  left: number;
  top: number;
}>;

export function ToolHeader({
  className = "",
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  state,
  title,
  ...props
}: ToolHeaderProps) {
  const presentation = statusPresentation[state];
  const { t } = useTranslation("conversation");
  const summaryRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<ToolTitleTooltipPosition>();

  const showTooltipWhenTruncated = useCallback(() => {
    const titleElement = titleRef.current;
    setTooltipVisible(titleElement !== null && titleElement.scrollWidth > titleElement.clientWidth);
  }, []);

  const updateTooltipPosition = useCallback(() => {
    const summary = summaryRef.current;
    const tooltip = tooltipRef.current;
    if (summary === null || tooltip === null) {
      return;
    }

    const summaryRect = summary.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maximumLeft = Math.max(
      toolTitleTooltipViewportPadding,
      window.innerWidth - tooltipRect.width - toolTitleTooltipViewportPadding,
    );
    const centeredLeft = summaryRect.left + summaryRect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(Math.max(centeredLeft, toolTitleTooltipViewportPadding), maximumLeft);
    const fitsAbove =
      summaryRect.top - toolTitleTooltipGap - tooltipRect.height >= toolTitleTooltipViewportPadding;
    const preferredTop = fitsAbove
      ? summaryRect.top - tooltipRect.height - toolTitleTooltipGap
      : summaryRect.bottom + toolTitleTooltipGap;
    const maximumTop = Math.max(
      toolTitleTooltipViewportPadding,
      window.innerHeight - tooltipRect.height - toolTitleTooltipViewportPadding,
    );

    // Portal 避开 Timeline 裁剪，坐标限制确保长命令在窄视口内仍完整可读。
    setTooltipPosition({
      left,
      top: Math.min(Math.max(preferredTop, toolTitleTooltipViewportPadding), maximumTop),
    });
  }, []);

  useLayoutEffect(() => {
    if (!tooltipVisible) {
      setTooltipPosition(undefined);
      return;
    }

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [tooltipVisible, updateTooltipPosition]);

  return (
    <summary
      aria-describedby={tooltipVisible ? tooltipId : undefined}
      className={`flex min-h-9 cursor-pointer list-none items-center gap-2 text-label text-foreground [&::-webkit-details-marker]:hidden ${className}`}
      onBlur={(event) => {
        onBlur?.(event);
        setTooltipVisible(false);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        showTooltipWhenTruncated();
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        showTooltipWhenTruncated();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setTooltipVisible(false);
      }}
      ref={summaryRef}
      {...props}
    >
      <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium" ref={titleRef}>
        {title}
      </span>
      <span
        className={`inline-flex items-center gap-1 ${
          state === "output-error" ? "text-danger" : "text-muted-foreground"
        }`}
      >
        {presentation.icon}
        {t(presentation.labelKey)}
      </span>
      <ChevronRight
        className="size-3.5 text-muted-foreground transition-transform group-open/tool:rotate-90"
        aria-hidden="true"
      />
      {tooltipVisible && typeof document !== "undefined"
        ? createPortal(
            <span
              className="pointer-events-none fixed z-50 max-w-[calc(100vw-1rem)] whitespace-pre-wrap break-all rounded-control bg-foreground px-2 py-1 font-mono text-meta text-raised shadow-floating"
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={
                tooltipPosition === undefined
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: tooltipPosition.left, top: tooltipPosition.top }
              }
            >
              {title}
            </span>,
            document.body,
          )
        : null}
    </summary>
  );
}

type ToolContentProps = HTMLAttributes<HTMLDivElement>;

export function ToolBody({ children }: Readonly<{ children: ReactNode }>) {
  const isOpen = useContext(ToolOpenContext);

  // 原生 details 只隐藏内容，不会减少 DOM；关闭时直接卸载大型 Tool 输出。
  return isOpen === false ? null : children;
}

export function ToolContent({ className = "", ...props }: ToolContentProps) {
  return (
    <ToolBody>
      <div
        className={`mb-2 space-y-4 rounded-control bg-raised px-3 py-3 text-muted-foreground shadow-sm ${className}`}
        {...props}
      />
    </ToolBody>
  );
}

function formatJsonValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // 工具边界允许 unknown；不可序列化时仍保留可读的兜底文本。
    return String(value);
  }
}

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
  input: unknown;
};

export function ToolInput({ className = "", input, ...props }: ToolInputProps) {
  const { t } = useTranslation("conversation");
  return (
    <div className={`space-y-2 overflow-hidden ${className}`} {...props}>
      <h4 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
        {t("aiElements.toolInput")}
      </h4>
      <CodeBlock code={formatJsonValue(input)} language="json" />
    </div>
  );
}

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
  errorText: string | undefined;
  output: unknown;
};

export function ToolOutput({ className = "", errorText, output, ...props }: ToolOutputProps) {
  const { t } = useTranslation("conversation");
  if (output === undefined && errorText === undefined) {
    return null;
  }

  const renderedOutput = isValidElement(output) ? (
    output
  ) : output === undefined ? null : (
    <CodeBlock code={formatJsonValue(output)} language="json" />
  );

  return (
    <div className={`space-y-2 ${className}`} {...props}>
      <h4
        className={`text-meta font-medium uppercase tracking-wide ${
          errorText === undefined ? "text-muted-foreground" : "text-danger"
        }`}
      >
        {errorText === undefined ? t("aiElements.toolResult") : t("aiElements.toolError")}
      </h4>
      <div
        className={`overflow-x-auto rounded-surface text-meta [&_table]:w-full ${
          errorText === undefined ? "text-foreground" : "bg-danger/10 p-3 text-danger"
        }`}
      >
        {errorText === undefined ? null : <div className="whitespace-pre-wrap">{errorText}</div>}
        {renderedOutput}
      </div>
    </div>
  );
}
