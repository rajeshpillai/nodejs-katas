import { spawn } from "child_process";

const TIMEOUT_MS = 10_000;
const MAX_MEMORY_MB = 64;

/**
 * Detect whether code requires ES module mode.
 *
 * We default to CommonJS because ESM wraps the top-level body in a microtask
 * continuation, which breaks the documented event-loop ordering for
 * `process.nextTick` vs Promise microtasks scheduled at the top level
 * (see kata phase-00/004-the-event-loop). CommonJS preserves the textbook
 * ordering. We only opt into module mode when the code actually uses ESM
 * syntax that CJS cannot run.
 */
function detectInputType(code) {
  // Strip line and block comments so commented examples don't trigger ESM.
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const esmPatterns = [
    /(^|\n)\s*import\s+[^()]/, // `import x from ...` (not `import(...)`)
    /(^|\n)\s*import\s*['"]/, // `import "side-effect"`
    /(^|\n)\s*export\s/,
    /(^|[^.\w$])await\s+(?!\s)/, // top-level await is ESM-only; conservative match
  ];
  return esmPatterns.some((re) => re.test(stripped)) ? "module" : "commonjs";
}

function nodeArgs(code) {
  return [
    `--max-old-space-size=${MAX_MEMORY_MB}`,
    `--input-type=${detectInputType(code)}`,
    "-",
  ];
}

/**
 * Execute code and return the full result as a promise (non-streaming).
 */
export function executeNodeCode(code) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;

    const child = spawn(process.execPath, nodeArgs(code), {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        NODE_PATH: "",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME || "/tmp",
      },
    });

    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      const elapsedMs = Date.now() - start;
      if (signal === "SIGTERM" || elapsedMs >= TIMEOUT_MS) {
        resolve({
          stdout,
          stderr,
          success: false,
          executionTimeMs: elapsedMs,
          error: "Execution timed out (10s limit)",
        });
      } else {
        resolve({
          stdout,
          stderr,
          success: exitCode === 0,
          executionTimeMs: elapsedMs,
          error: null,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      child.kill("SIGTERM");
      if (settled) return;
      settled = true;
      resolve({
        stdout: "",
        stderr: "",
        success: false,
        executionTimeMs: Date.now() - start,
        error: `Process error: ${err.message}`,
      });
    });

    child.stdin.write(code);
    child.stdin.end();
  });
}

/**
 * Execute code and stream output chunks via SSE.
 * Calls `onEvent(eventData)` for each SSE event to send.
 * Returns a promise that resolves when execution completes.
 */
export function executeNodeCodeStreaming(code, onEvent) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;

    function safeEmit(event) {
      try {
        onEvent(event);
      } catch {
        child.kill("SIGTERM");
      }
    }

    const child = spawn(process.execPath, nodeArgs(code), {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        NODE_PATH: "",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME || "/tmp",
      },
    });

    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      safeEmit({ type: "stdout", data: chunk.toString() });
    });

    child.stderr.on("data", (chunk) => {
      safeEmit({ type: "stderr", data: chunk.toString() });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      const elapsedMs = Date.now() - start;
      const timedOut = signal === "SIGTERM" || elapsedMs >= TIMEOUT_MS;
      safeEmit({
        type: "done",
        success: timedOut ? false : exitCode === 0,
        execution_time_ms: elapsedMs,
        error: timedOut ? "Execution timed out (10s limit)" : null,
      });
      resolve();
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      child.kill("SIGTERM");
      if (settled) return;
      settled = true;
      safeEmit({
        type: "done",
        success: false,
        execution_time_ms: Date.now() - start,
        error: `Process error: ${err.message}`,
      });
      resolve();
    });

    child.stdin.write(code);
    child.stdin.end();
  });
}
