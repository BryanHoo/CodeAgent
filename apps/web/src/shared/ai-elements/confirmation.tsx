import { Check, CircleX, ShieldQuestion } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type ConfirmationState =
  | "approval-requested"
  | "approval-submitting"
  | "approval-resolved"
  | "approval-accepted"
  | "approval-rejected"
  | "approval-expired";

const ConfirmationContext = createContext<ConfirmationState>("approval-requested");

type ConfirmationProps = HTMLAttributes<HTMLElement> & {
  approval: Readonly<{ id: string }>;
  state: ConfirmationState;
};

function findTitle(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === ConfirmationTitle) {
      return typeof child.props.children === "string" ? child.props.children : "审批";
    }
  }
  return "审批";
}

export function Confirmation({
  approval,
  children,
  className = "",
  state,
  ...props
}: ConfirmationProps) {
  const title = findTitle(children);
  return (
    <ConfirmationContext.Provider value={state}>
      <section
        aria-label={`${title}请求`}
        className={`w-full rounded-surface bg-control px-3.5 py-3 shadow-sm ${className}`}
        data-approval-id={approval.id}
        data-state={state}
        {...props}
      >
        {children}
      </section>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationTitle({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`flex items-center gap-2 text-label font-semibold text-foreground ${className}`}
      {...props}
    >
      <ShieldQuestion className="size-4 text-muted-foreground" aria-hidden="true" />
      {children}
    </h3>
  );
}

export function ConfirmationRequest({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mt-2 break-words rounded-control bg-raised px-3 py-2 text-body-small leading-5 text-foreground shadow-sm ${className}`}
      {...props}
    />
  );
}

export function ConfirmationAccepted({
  children = "请求已允许",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const state = useContext(ConfirmationContext);
  if (state !== "approval-accepted") return null;
  return (
    <div
      className={`mt-2 flex items-center gap-1.5 text-label text-muted-foreground ${className}`}
      {...props}
    >
      <Check className="size-3.5" aria-hidden="true" />
      {children}
    </div>
  );
}

export function ConfirmationRejected({
  children = "请求已拒绝",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const state = useContext(ConfirmationContext);
  if (state !== "approval-rejected" && state !== "approval-expired") return null;
  return (
    <div
      className={`mt-2 flex items-center gap-1.5 text-label text-muted-foreground ${className}`}
      {...props}
    >
      <CircleX className="size-3.5" aria-hidden="true" />
      {children}
    </div>
  );
}

export function ConfirmationActions({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`mt-3 flex flex-wrap justify-end gap-2 ${className}`} {...props} />;
}

export function ConfirmationAction({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 items-center justify-center rounded-control bg-raised px-3 text-label font-medium text-foreground shadow-sm transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      type={type}
      {...props}
    />
  );
}
