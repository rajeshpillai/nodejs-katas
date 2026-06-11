import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { apiGet, type KataListResponse } from "../../lib/api-client";

interface SidebarProps {
  collapsed: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const params = useParams();
  const [data] = createResource(() => apiGet<KataListResponse>("/katas"));
  const [expandedPhases, setExpandedPhases] = createSignal<Set<number>>(new Set([0]));

  let asideRef: HTMLElement | undefined;

  // Keep the sidebar in sync with the current kata: whenever the active kata
  // changes (e.g. via the Next/Prev buttons), auto-expand the phase that
  // contains it so the highlighted item is actually visible — otherwise
  // navigating into a collapsed phase leaves the active kata hidden.
  createEffect(() => {
    const d = data();
    const kid = params.kataId;
    if (!d || !kid) return;
    const phase = d.phases.find((p) => p.katas.some((k) => k.id === kid));
    if (!phase) return;
    setExpandedPhases((prev) =>
      prev.has(phase.phase) ? prev : new Set(prev).add(phase.phase)
    );
  });

  // Once the active link is mounted (after its phase expands), scroll it into
  // view so it's never stuck off-screen in a long list.
  createEffect(() => {
    const kid = params.kataId;
    expandedPhases(); // re-run after the containing phase expands
    if (!kid || !asideRef) return;
    const active = asideRef.querySelector<HTMLElement>(`a[href$="/${kid}"]`);
    active?.scrollIntoView({ block: "nearest" });
  });

  const togglePhase = (phase: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  return (
    <aside
      ref={asideRef}
      class="flex flex-col border-r overflow-y-auto overflow-x-hidden transition-all duration-200 shrink-0"
      style={{
        width: props.collapsed ? "0px" : "280px",
        "min-width": props.collapsed ? "0px" : "280px",
        "background-color": "var(--sidebar-bg)",
        "border-color": "var(--border)",
      }}
    >
      <Show when={!props.collapsed}>
        <div class="p-3">
          <Show when={data.loading}>
            <p class="text-xs px-2 py-4" style={{ color: "var(--text-muted)" }}>
              Loading katas...
            </p>
          </Show>

          <Show when={data()}>
            <For each={data()!.phases}>
              {(phase) => (
                <div class="mb-1">
                  <button
                    onClick={() => togglePhase(phase.phase)}
                    class="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-xs font-semibold transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="shrink-0 transition-transform duration-150"
                      style={{
                        transform: expandedPhases().has(phase.phase)
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span>
                      Phase {phase.phase} — {phase.title}
                    </span>
                  </button>

                  <Show when={expandedPhases().has(phase.phase)}>
                    <div class="ml-4 mt-0.5">
                      <For each={phase.katas}>
                        {(kata) => {
                          const isActive = () => params.kataId === kata.id;
                          return (
                            <A
                              href={`/katas/${phase.phase}/${kata.id}`}
                              class="block px-2 py-1.5 rounded-md text-xs no-underline transition-colors"
                              style={{
                                "background-color": isActive()
                                  ? "var(--accent-light)"
                                  : "transparent",
                                color: isActive()
                                  ? "var(--accent)"
                                  : "var(--text-secondary)",
                                "font-weight": isActive() ? "600" : "400",
                              }}
                            >
                              {kata.sequence}. {kata.title}
                            </A>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </aside>
  );
}
