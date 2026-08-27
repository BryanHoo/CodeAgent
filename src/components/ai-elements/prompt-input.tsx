import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function PromptInputTextarea({ className, onKeyDown, ...props }, ref) {
  return (
    <textarea
      aria-label="任务描述"
      className={cn("prompt-input-textarea", className)}
      data-slot="prompt-input-textarea"
      onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      ref={ref}
      {...props}
    />
  );
});

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
