import { onMount, onCleanup, createEffect } from "solid-js";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { indentUnit } from "@codemirror/language";
import {
  defaultKeymap,
  historyKeymap,
  history,
  indentWithTab,
} from "@codemirror/commands";
import { useTheme } from "../../context/theme-context";
import {
  editorTheme,
  lightSyntaxHighlighting,
  darkSyntaxHighlighting,
} from "./editor-theme";

interface CodePanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  onRun: () => void;
  onReset: () => void;
  running: boolean;
  maximized: boolean;
  onToggleMaximize: () => void;
}

export default function CodePanel(props: CodePanelProps) {
  let editorEl!: HTMLDivElement;
  let view: EditorView;
  const highlightCompartment = new Compartment();
  const { theme } = useTheme();

  onMount(() => {
    const state = EditorState.create({
      doc: props.code,
      extensions: [
        javascript(),
        history(),
        lineNumbers(),
        highlightActiveLine(),
        indentUnit.of("  "),
        keymap.of([
          {
            key: "Ctrl-Enter",
            mac: "Cmd-Enter",
            run: () => {
              props.onRun();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        editorTheme,
        highlightCompartment.of(
          theme() === "dark" ? darkSyntaxHighlighting : lightSyntaxHighlighting
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            props.onCodeChange(update.state.doc.toString());
          }
        }),
      ],
    });
    view = new EditorView({ state, parent: editorEl });
  });

  // Sync external code changes (Reset button)
  createEffect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== props.code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.code },
      });
    }
  });

  // Reactive theme switching
  createEffect(() => {
    if (!view) return;
    const t = theme();
    view.dispatch({
      effects: highlightCompartment.reconfigure(
        t === "dark" ? darkSyntaxHighlighting : lightSyntaxHighlighting
      ),
    });
  });

  onCleanup(() => view?.destroy());

  return (
    <div class="flex flex-col h-full" style={{ "background-color": "var(--bg-secondary)" }}>
      <div
        class="flex items-center gap-2 px-3 py-2 border-b shrink-0"
        style={{ "border-color": "var(--border)" }}
      >
        <button
          class="px-3 py-1 text-xs font-medium rounded-md text-white transition-colors"
          style={{
            "background-color": props.running ? "var(--text-muted)" : "var(--accent)",
          }}
          onClick={props.onRun}
          disabled={props.running}
        >
          {props.running ? "Running..." : "Run"}
        </button>
        <button
          class="px-2.5 py-1 text-xs rounded-md border transition-colors"
          style={{ "border-color": "var(--border)", color: "var(--text-muted)" }}
          onClick={props.onReset}
        >
          Reset
        </button>
        <span class="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          Ctrl+Enter to run
        </span>
        <button
          class="w-7 h-7 flex items-center justify-center rounded-md border text-xs"
          style={{ "border-color": "var(--border)", color: "var(--text-muted)" }}
          onClick={props.onToggleMaximize}
          title={props.maximized ? "Restore" : "Maximize"}
        >
          {props.maximized ? "\u29C9" : "\u2922"}
        </button>
      </div>
      <div ref={editorEl!} class="flex-1 overflow-hidden code-panel-editor" />
    </div>
  );
}
