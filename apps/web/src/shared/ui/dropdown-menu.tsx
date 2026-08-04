import * as DropdownMenuPrimitive from "radix-ui/dropdown-menu";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuPortal({
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  if (typeof document === "undefined") {
    // SSR 测试没有 document，直接渲染子节点；浏览器中仍由 Radix Portal 脱离裁剪容器。
    return <>{children}</>;
  }
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props}>
      {children}
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuContent({
  children,
  className,
  collisionPadding = 8,
  sideOffset = 2,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-50 min-w-32 overflow-hidden rounded-surface bg-raised p-1 text-foreground shadow-floating outline-none",
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-body-small outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-control-hover [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-item"
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
};
