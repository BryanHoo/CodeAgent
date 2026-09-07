import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { terminalStore } from "../terminal-store.js";
import { initializeTerminalLayout, terminalActionError } from "../terminal-layout.js";
import { isTerminalShortcut } from "../terminal-shortcut.js";
import { TerminalContext } from "./terminal-context.js";

const TerminalPanel = lazy(() => import("./terminal-panel.js").then((module) => ({ default: module.TerminalPanel })));

export function TerminalWorkbench({ children, enabled, projectId, rootId, label }: { children: ReactNode; enabled: boolean; projectId: string; rootId: string | undefined; label: string }) {
  const state = useSyncExternalStore(useCallback((listener) => enabled ? terminalStore.subscribe(projectId, listener) : () => undefined, [enabled, projectId]), useCallback(() => terminalStore.get(projectId), [projectId]));
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const captureFocus = useCallback(() => {
    const active = document.activeElement;
    if (!terminalStore.get(projectId).visible && active instanceof HTMLElement && active.closest("[data-project-terminal]") === null) previousFocus.current = active;
  }, [projectId]);
  const toggle = useCallback(() => {
    if (previousFocus.current === null) captureFocus();
    void import("../terminal-actions.js").then(({ toggleTerminal }) => toggleTerminal(projectId, rootId)).catch((error: unknown) => terminalActionError(projectId, error));
  }, [captureFocus, projectId, rootId]);

  useEffect(() => { if (enabled) void initializeTerminalLayout(projectId).catch((error: unknown) => terminalActionError(projectId, error)); }, [enabled, projectId]);
  useEffect(() => {
    if (wasVisible.current && !state.visible) { if (previousFocus.current?.isConnected) previousFocus.current.focus(); previousFocus.current = null; }
    wasVisible.current = enabled && state.visible;
  }, [enabled, state.visible]);
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event, /mac/i.test(navigator.platform), true)) return;
      const modal = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some((element) => element.getClientRects().length > 0);
      if (modal) return;
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) { captureFocus(); toggle(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [captureFocus, enabled, toggle]);

  if (!enabled) return <main aria-label={label} className="flex min-h-0 min-w-0 flex-col bg-content">{children}</main>;
  return <main aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col bg-content">
    <TerminalContext.Provider value={{ projectId, rootId, footer, toggle, captureFocus }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {state.visible ? <Suspense fallback={null}><TerminalPanel projectId={projectId} rootId={rootId} /></Suspense> : null}
      <div data-terminal-footer="" className="shrink-0 bg-content px-1 pb-2 sm:px-5" ref={setFooter} />
    </TerminalContext.Provider>
  </main>;
}
