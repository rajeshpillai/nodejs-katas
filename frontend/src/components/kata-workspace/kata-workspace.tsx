import { createSignal, createEffect, Show } from "solid-js";
import Resizable from "@corvu/resizable";
import CodePanel from "./code-panel";
import OutputPanel from "./output-panel";
import { apiPostStream, type ExecutionResult } from "../../lib/api-client";
import "./kata-workspace.css";

interface KataWorkspaceProps {
  defaultCode: string;
  kataId: string;
}

type MaximizedPanel = "code" | "output" | null;

export default function KataWorkspace(props: KataWorkspaceProps) {
  const [code, setCode] = createSignal(props.defaultCode);
  const [output, setOutput] = createSignal<ExecutionResult | null>(null);
  const [running, setRunning] = createSignal(false);
  const [maximized, setMaximized] = createSignal<MaximizedPanel>(null);
  const [sizes, setSizes] = createSignal([0.5, 0.5]);

  // Reset when kata changes
  createEffect(() => {
    const _ = props.defaultCode;
    setCode(props.defaultCode);
    setOutput(null);
  });

  const handleReset = () => {
    setCode(props.defaultCode);
    setOutput(null);
  };

  const handleRun = async () => {
    setRunning(true);
    setOutput({ stdout: "", stderr: "", success: true, execution_time_ms: 0, error: null });
    try {
      await apiPostStream("/playground/run-stream", { code: code() }, (event) => {
        if (event.type === "stdout") {
          setOutput((prev) => prev ? { ...prev, stdout: prev.stdout + event.data } : prev);
        } else if (event.type === "stderr") {
          setOutput((prev) => prev ? { ...prev, stderr: prev.stderr + event.data } : prev);
        } else if (event.type === "done") {
          setOutput((prev) => prev ? {
            ...prev,
            success: event.success ?? false,
            execution_time_ms: event.execution_time_ms ?? 0,
            error: event.error ?? null,
          } : prev);
        }
      });
    } catch (e) {
      setOutput({
        stdout: "",
        stderr: "",
        success: false,
        execution_time_ms: 0,
        error: e instanceof Error ? e.message : "Failed to connect to server.",
      });
    } finally {
      setRunning(false);
    }
  };

  const toggleMaximize = (panel: "code" | "output") => {
    if (maximized() === panel) {
      setMaximized(null);
      setSizes([0.5, 0.5]);
    } else {
      setMaximized(panel);
      setSizes(panel === "code" ? [1, 0] : [0, 1]);
    }
  };

  return (
    <Resizable
      class="kata-workspace"
      sizes={sizes()}
      onSizesChange={setSizes}
    >
      <Resizable.Panel
        class="kata-workspace-panel"
        minSize={maximized() === "output" ? 0 : 0.2}
      >
        <Show when={maximized() !== "output"}>
          <CodePanel
            code={code()}
            onCodeChange={setCode}
            onRun={handleRun}
            onReset={handleReset}
            running={running()}
            maximized={maximized() === "code"}
            onToggleMaximize={() => toggleMaximize("code")}
          />
        </Show>
      </Resizable.Panel>
      <Show when={!maximized()}>
        <Resizable.Handle class="kata-workspace-handle" />
      </Show>
      <Resizable.Panel
        class="kata-workspace-panel"
        minSize={maximized() === "code" ? 0 : 0.2}
      >
        <Show when={maximized() !== "code"}>
          <OutputPanel
            result={output()}
            running={running()}
            maximized={maximized() === "output"}
            onToggleMaximize={() => toggleMaximize("output")}
          />
        </Show>
      </Resizable.Panel>
    </Resizable>
  );
}
