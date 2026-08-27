import {
  BotIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  Settings2Icon,
  SquareTerminalIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRuntimeStore } from "@/stores/runtime-store";

const CONNECTION_LABELS = {
  idle: "Offline",
  connecting: "Connecting",
  connected: "Ready",
  error: "Unavailable",
} as const;

export function AppShell() {
  const connection = useRuntimeStore((state) => state.connection);
  const provider = useRuntimeStore((state) => state.snapshot.provider);

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            CA
          </div>
          <div className="brand-copy">
            <strong>CodeAgent</strong>
            <span>Local workspace</span>
          </div>
          <Button aria-label="Collapse sidebar" size="icon" variant="ghost">
            <PanelLeftIcon aria-hidden="true" />
          </Button>
        </div>

        <Button className="new-thread-button" disabled variant="outline">
          <MessageSquarePlusIcon aria-hidden="true" />
          New thread
        </Button>

        <nav className="workspace-nav" aria-label="Workspace">
          <span className="nav-label">Workspace</span>
          <button className="nav-item nav-item-active" type="button">
            <SquareTerminalIcon aria-hidden="true" />
            Current session
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" type="button">
            <Settings2Icon aria-hidden="true" />
            Settings
          </button>
          <div className="runtime-line">
            <span className={`status-dot status-${connection}`} />
            <span>{provider ?? CONNECTION_LABELS[connection]}</span>
          </div>
        </div>
      </aside>

      <section className="workspace-panel">
        <header className="workspace-header">
          <div>
            <span className="header-kicker">Session</span>
            <h1>Untitled workspace</h1>
          </div>
          <div className="runtime-badge">
            <span className={`status-dot status-${connection}`} />
            {CONNECTION_LABELS[connection]}
          </div>
        </header>

        <main className="workspace-content">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              <BotIcon />
            </div>
            <h2>Ready for the runtime</h2>
            <p>The application shell is connected. Agent workflows will be added here.</p>
          </div>
        </main>

        <footer className="composer-shell">
          <textarea
            aria-label="Agent prompt"
            disabled
            placeholder="Start a task..."
            rows={2}
          />
          <span>Runtime commands are not enabled in the scaffold.</span>
        </footer>
      </section>
    </div>
  );
}
