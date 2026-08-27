import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";

type MessageResponseProps = Omit<ComponentProps<typeof Streamdown>, "children"> & Readonly<{ children: string }>;

export const MessageResponse = memo(function MessageResponse({ children, className = "", ...props }: MessageResponseProps) {
  return <Streamdown className={`ai-message-response ${className}`} controls={{ code: { copy: true, download: false }, mermaid: false, table: false }} {...props}>{children}</Streamdown>;
});
