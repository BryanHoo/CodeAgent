import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";

const tooltipGap = 8;
const viewportPadding = 8;

type TooltipPosition = Readonly<{
  left: number;
  top: number;
}>;

type IconButtonProps = Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    label: string;
    size?: "small" | "medium";
    tone?: "accent" | "neutral";
    tooltip?: ReactNode;
    tooltipTone?: "default" | "surface";
  }
>;

export function IconButton({
  children,
  className = "",
  label,
  size = "medium",
  tone = "neutral",
  tooltip,
  tooltipTone = "default",
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>();
  const sizeClass = size === "small" ? "size-7" : "size-9";
  const toneClass =
    tone === "accent"
      ? "bg-accent text-white hover:bg-accent-strong"
      : "bg-transparent text-muted-foreground hover:bg-control-hover hover:text-foreground";
  const tooltipClass =
    tooltipTone === "surface"
      ? "bg-raised text-foreground shadow-floating"
      : "bg-foreground text-raised shadow-floating";

  const updateTooltipPosition = useCallback(() => {
    const button = buttonRef.current;
    const tooltip = tooltipRef.current;
    if (button === null || tooltip === null) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maximumLeft = Math.max(
      viewportPadding,
      window.innerWidth - tooltipRect.width - viewportPadding,
    );
    const centeredLeft = buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(Math.max(centeredLeft, viewportPadding), maximumLeft);
    const fitsAbove = buttonRect.top - tooltipGap - tooltipRect.height >= viewportPadding;
    const preferredTop = fitsAbove
      ? buttonRect.top - tooltipRect.height - tooltipGap
      : buttonRect.bottom + tooltipGap;
    const maximumTop = Math.max(
      viewportPadding,
      window.innerHeight - tooltipRect.height - viewportPadding,
    );

    // Portal 避开面板裁剪，最终坐标再限制在当前视口的安全边距内。
    setTooltipPosition({
      left,
      top: Math.min(Math.max(preferredTop, viewportPadding), maximumTop),
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
    <span
      className="inline-flex shrink-0"
      onBlur={() => {
        setTooltipVisible(false);
      }}
      onFocus={() => {
        setTooltipVisible(true);
      }}
      onMouseEnter={() => {
        setTooltipVisible(true);
      }}
      onMouseLeave={() => {
        setTooltipVisible(false);
      }}
    >
      <button
        {...buttonProps}
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        aria-label={label}
        className={`${sizeClass} ${toneClass} inline-grid place-items-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
        ref={buttonRef}
        type={type}
      >
        {children}
      </button>
      {tooltipVisible && typeof document !== "undefined"
        ? createPortal(
            <span
              className={`pointer-events-none fixed z-50 max-w-[calc(100vw-1rem)] whitespace-normal rounded-control px-2 py-1 text-meta ${tooltipClass}`}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={
                tooltipPosition === undefined
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: tooltipPosition.left, top: tooltipPosition.top }
              }
            >
              {tooltip ?? label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
