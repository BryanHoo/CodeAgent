import { useEffect, useRef } from "react";
import { toast } from "sonner";

const reportedErrors = new WeakSet<object>();

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as Readonly<{ message?: unknown }>).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(getErrorMessage(error), { cause: error });
}

export function showErrorToast(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
  }
  toast.error(getErrorMessage(error));
}

export function useErrorToast(error: unknown): void {
  useEffect(() => {
    if (error !== null && error !== undefined) showErrorToast(error);
  }, [error]);
}

export function useErrorToasts(errors: readonly unknown[]): void {
  const previousErrorsRef = useRef<ReadonlySet<unknown>>(new Set());
  useEffect(() => {
    const currentErrors = new Set(errors.filter((error) => error !== null && error !== undefined));
    for (const error of currentErrors) {
      if (!previousErrorsRef.current.has(error)) showErrorToast(error);
    }
    previousErrorsRef.current = currentErrors;
  }, [errors]);
}
