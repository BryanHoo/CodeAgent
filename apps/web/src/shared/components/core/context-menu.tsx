import * as ContextMenuPrimitive from "radix-ui/context-menu";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

function ContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(props: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuPortal({
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  if (typeof document === "undefined") {
    // SSR 测试直接渲染内容；浏览器中仍由 Radix Portal 脱离文件树滚动容器。
    return <>{children}</>;
  }
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props}>
      {children}
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuContent({
  children,
  className,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-32 overflow-x-hidden overflow-y-auto rounded-surface border border-separator-strong bg-raised p-1.5 text-foreground shadow-floating outline-none",
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="context-menu-content"
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPortal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-control px-2 py-1.5 text-body-small outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-control-hover [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="context-menu-item"
      {...props}
    />
  );
}

function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn("px-2 py-1 text-label font-medium text-foreground", className)}
      data-slot="context-menu-label"
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("-mx-1.5 my-1 h-px bg-separator", className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
};
