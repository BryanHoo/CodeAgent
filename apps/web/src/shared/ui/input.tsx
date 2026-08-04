import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      // Input 只统一结构与属性透传，避免默认尺寸影响 checkbox、hidden 和既有表单布局。
      className={cn(className)}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
