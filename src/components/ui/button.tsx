import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-default",
      ghost: "button-ghost",
      outline: "button-outline",
    },
    size: {
      default: "button-size-default",
      icon: "button-size-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, size, type = "button", variant, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      data-slot="button"
      type={type}
      {...props}
    />
  );
}
