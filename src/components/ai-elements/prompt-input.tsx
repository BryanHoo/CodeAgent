import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function PromptInput({ className, onSubmit, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      className={cn("prompt-input", className)}
      data-slot="prompt-input"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(event);
      }}
      {...props}
    />
  );
}

export function PromptInputBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("prompt-input-body", className)} data-slot="prompt-input-body" {...props} />;
}

export function PromptInputTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      aria-label="任务描述"
      className={cn("prompt-input-textarea", className)}
      data-slot="prompt-input-textarea"
      {...props}
    />
  );
}

export function PromptInputFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("prompt-input-footer", className)} data-slot="prompt-input-footer" {...props} />;
}

export function PromptInputTools({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("prompt-input-tools", className)} data-slot="prompt-input-tools" {...props} />;
}

type PromptInputButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip?: string;
};

export function PromptInputButton({ className, tooltip, title, ...props }: PromptInputButtonProps) {
  return (
    <Button
      className={cn("prompt-input-button", className)}
      data-slot="prompt-input-button"
      size="icon"
      title={title ?? tooltip}
      variant="ghost"
      {...props}
    />
  );
}

export function PromptInputSubmit({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      className={cn("prompt-input-submit", className)}
      data-slot="prompt-input-submit"
      size="icon"
      {...props}
    />
  );
}
