import { Box } from "lucide-react";
import type { HTMLAttributes } from "react";

export const skillTokenClassName =
  "inline-flex max-w-full items-center gap-1 rounded-control px-0.5 align-text-bottom text-sm leading-5 font-medium text-primary";

type SkillTokenProps = HTMLAttributes<HTMLSpanElement> &
  Readonly<{
    displayName?: string;
    name: string;
  }>;

export function SkillToken({ className = "", displayName, name, ...props }: SkillTokenProps) {
  return (
    <span className={`${skillTokenClassName} ${className}`} {...props}>
      <Box aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{displayName ?? `$${name}`}</span>
    </span>
  );
}
