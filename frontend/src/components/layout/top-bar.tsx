import { A } from "@solidjs/router";
import ThemeToggle from "./theme-toggle";

interface TopBarProps {
  onToggleSidebar: () => void;
}

export default function TopBar(props: TopBarProps) {
  return (
    <header
      class="flex items-center justify-between px-4 py-2 border-b shrink-0"
      style={{
        "background-color": "var(--bg-secondary)",
        "border-color": "var(--border)",
      }}
    >
      <div class="flex items-center gap-3">
        <button
          onClick={props.onToggleSidebar}
          class="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
          style={{ color: "var(--text-secondary)" }}
          title="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <A
          href="/"
          class="text-sm font-semibold no-underline"
          style={{ color: "var(--text-primary)" }}
        >
          Node.js Katas
        </A>
      </div>
      <ThemeToggle />
    </header>
  );
}
