import { createSignal } from "solid-js";
import type { ParentComponent } from "solid-js";
import Sidebar from "../components/layout/sidebar";
import TopBar from "../components/layout/top-bar";

const KatasBrowser: ParentComponent = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

  return (
    <div class="flex h-screen overflow-hidden" style={{ "background-color": "var(--bg-primary)" }}>
      <Sidebar collapsed={sidebarCollapsed()} />
      <div class="flex flex-col flex-1 min-w-0">
        <TopBar onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)} />
        <main class="flex flex-col flex-1 overflow-hidden">
          {props.children}
        </main>
      </div>
    </div>
  );
};

export default KatasBrowser;
