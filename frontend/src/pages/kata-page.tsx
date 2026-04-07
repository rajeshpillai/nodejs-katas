import {
  createResource,
  createSignal,
  createEffect,
  onCleanup,
  Show,
} from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { apiGet, type Kata, type KataNeighbor } from "../lib/api-client";
import MarkdownContent from "../components/common/markdown-content";
import KataWorkspace from "../components/kata-workspace/kata-workspace";

function NeighborLink(props: {
  direction: "prev" | "next";
  neighbor: KataNeighbor | null;
}) {
  const label = props.direction === "prev" ? "← Prev" : "Next →";
  if (!props.neighbor) {
    return (
      <span
        class="px-2 py-1 text-xs rounded opacity-40 cursor-not-allowed"
        style={{ color: "var(--text-muted)" }}
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  const n = props.neighbor;
  return (
    <A
      href={`/katas/${n.phase}/${n.id}`}
      class="px-2 py-1 text-xs rounded hover:underline focus:outline-none focus:ring-2"
      style={{ color: "var(--accent)" }}
      title={`Phase ${n.phase} · ${n.sequence}. ${n.title}`}
    >
      {label}
    </A>
  );
}

export default function KataPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = createSignal<"description" | "experiment">(
    "description"
  );

  // Reset to description tab when navigating to a different kata
  createEffect(() => {
    const _ = params.kataId;
    setActiveTab("description");
  });

  const [kata] = createResource(
    () => params.kataId,
    (id) => apiGet<Kata>(`/katas/${id}`)
  );

  // Alt+Left / Alt+Right walk the linear progression. Alt avoids stealing
  // arrow keys from the editor and from screen-reader navigation.
  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const k = kata();
    if (!k) return;
    if (e.key === "ArrowLeft" && k.prev) {
      e.preventDefault();
      navigate(`/katas/${k.prev.phase}/${k.prev.id}`);
    } else if (e.key === "ArrowRight" && k.next) {
      e.preventDefault();
      navigate(`/katas/${k.next.phase}/${k.next.id}`);
    }
  }
  window.addEventListener("keydown", onKeydown);
  onCleanup(() => window.removeEventListener("keydown", onKeydown));

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      active ? "border-current" : "border-transparent"
    }`;

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      <Show when={kata.loading}>
        <div class="flex-1 flex items-center justify-center">
          <span style={{ color: "var(--text-muted)" }}>Loading kata...</span>
        </div>
      </Show>

      <Show when={kata.error}>
        <div class="flex-1 flex items-center justify-center">
          <span style={{ color: "var(--error)" }}>Failed to load kata.</span>
        </div>
      </Show>

      <Show when={kata()}>
        {(k) => (
          <>
            {/* Kata header with tabs */}
            <div
              class="flex items-center justify-between px-4 border-b shrink-0"
              style={{
                "border-color": "var(--border)",
                "background-color": "var(--bg-secondary)",
              }}
            >
              <div class="flex items-center gap-4">
                <span
                  class="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Phase {k().phase}
                </span>
                <span
                  class="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {k().sequence}. {k().title}
                </span>
                <span
                  class="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    "background-color": "var(--badge-bg)",
                    color: "var(--badge-text)",
                  }}
                >
                  {k().difficulty}
                </span>
                <span
                  class="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  ~{k().estimatedMinutes}min
                </span>
              </div>
              <div class="flex items-center gap-2">
                <NeighborLink direction="prev" neighbor={k().prev} />
                <NeighborLink direction="next" neighbor={k().next} />
                <span
                  class="mx-1 h-5 w-px"
                  style={{ "background-color": "var(--border)" }}
                  aria-hidden="true"
                />
                <button
                  class={tabClass(activeTab() === "description")}
                  style={{
                    color:
                      activeTab() === "description"
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                  onClick={() => setActiveTab("description")}
                >
                  Description
                </button>
                <button
                  class={tabClass(activeTab() === "experiment")}
                  style={{
                    color:
                      activeTab() === "experiment"
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                  onClick={() => setActiveTab("experiment")}
                >
                  Experiment
                </button>
              </div>
            </div>

            {/* Tab content */}
            <Show when={activeTab() === "description"}>
              <div
                class="flex-1 overflow-y-auto p-6"
                style={{ "background-color": "var(--bg-primary)" }}
              >
                <MarkdownContent content={k().description} />
              </div>
            </Show>

            <Show when={activeTab() === "experiment"}>
              <KataWorkspace
                defaultCode={
                  k().experimentCode ||
                  "// No starter code found for this kata\n"
                }
                kataId={k().id}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
