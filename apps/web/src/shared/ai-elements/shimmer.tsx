import { memo, useMemo, type CSSProperties, type ElementType, type HTMLAttributes } from "react";

export type ShimmerProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: ElementType;
  children: string;
  duration?: number;
  spread?: number;
};

export const Shimmer = memo(function Shimmer({
  as: Component = "p",
  children,
  className = "",
  duration = 2,
  spread = 2,
  style,
  ...props
}: ShimmerProps) {
  // 按文本长度计算高光宽度，使短状态文案也保持均匀的扫光节奏。
  const shimmerStyle = useMemo(
    () =>
      ({
        "--ui-shimmer-duration": `${String(duration)}s`,
        "--ui-shimmer-spread": `${String(children.length * spread)}px`,
        ...style,
      }) as CSSProperties,
    [children.length, duration, spread, style],
  );

  return (
    <Component
      className={`ai-shimmer inline-block ${className}`}
      data-ai-shimmer=""
      style={shimmerStyle}
      {...props}
    >
      {children}
    </Component>
  );
});

Shimmer.displayName = "Shimmer";
