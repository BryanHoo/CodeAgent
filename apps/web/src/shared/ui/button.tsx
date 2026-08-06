import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui/slot";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

const buttonVariants = cva(
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    compoundVariants: [
      {
        className:
          "bg-transparent text-muted-foreground hover:bg-control-hover hover:text-foreground",
        size: ["icon", "icon-sm", "icon-lg"],
        variant: "ghost",
      },
    ],
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "",
        sm: "",
        lg: "",
        icon: "inline-grid size-9 place-items-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-45 max-workbench:size-11",
        "icon-sm":
          "inline-grid size-7 place-items-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-45 max-workbench:size-11 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg":
          "inline-grid size-10 place-items-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-45 max-workbench:size-11",
      },
      variant: {
        default:
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-body-small font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50",
        destructive:
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-control bg-danger px-3 text-body-small font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        ghost: "",
        link: "inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline [&_svg:not([class*='size-'])]:size-3.5",
        outline:
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-separator-strong bg-panel px-3 text-body-small text-foreground hover:bg-control-hover",
        secondary:
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-control bg-raised px-3 text-body-small text-foreground shadow-sm transition-colors hover:bg-control-hover",
      },
    },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  asChild = false,
  className,
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  // 普通业务按钮由调用方持有视觉样式，基础层只为显式 variant/size 提供项目既有契约。
  return (
    <Component
      className={cn(buttonVariants({ className, size, variant }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
