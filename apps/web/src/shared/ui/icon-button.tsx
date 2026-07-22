import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    label: string;
    size?: "small" | "medium";
    tone?: "accent" | "neutral";
  }
>;

export function IconButton({
  children,
  className = "",
  label,
  size = "medium",
  tone = "neutral",
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const sizeClass = size === "small" ? "size-7" : "size-9";
  const toneClass =
    tone === "accent"
      ? "border-accent bg-accent text-white hover:bg-accent-strong"
      : "border-border bg-surface text-foreground hover:bg-surface-muted";

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        {...buttonProps}
        aria-label={label}
        className={`${sizeClass} ${toneClass} inline-grid place-items-center border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
        title={label}
        type={type}
      >
        {children}
      </button>
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap bg-foreground px-2 py-1 text-xs text-surface shadow-sm group-hover:block group-focus-within:block"
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}
