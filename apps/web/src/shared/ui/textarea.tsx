import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(className)} data-slot="textarea" {...props} />;
}

export { Textarea };
