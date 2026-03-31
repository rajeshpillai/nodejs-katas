import { spawn } from "child_process";

const TIMEOUT_MS = 10_000;
const MAX_MEMORY_MB = 64;

/**
 * Execute code and return the full result as a promise (non-streaming).
 */
export function executeNodeCode(code) {
  return new Promise((resolve) => {
    const start = Date.now();

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${MAX_MEMORY_MB}`, "--input-type=module", "-"],
      {
        timeout: TIMEOUT_MS,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          NODE_PATH: "",
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME || "/tmp",
        },
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("close", (exitCode, signal) => {
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

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${MAX_MEMORY_MB}`, "--input-type=module", "-"],
      {
        timeout: TIMEOUT_MS,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          NODE_PATH: "",
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME || "/tmp",
        },
      }
    );

    child.stdout.on("data", (chunk) => {
      onEvent({ type: "stdout", data: chunk.toString() });
    });

    child.stderr.on("data", (chunk) => {
      onEvent({ type: "stderr", data: chunk.toString() });
    });

    child.on("close", (exitCode, signal) => {
      const elapsedMs = Date.now() - start;
      const timedOut = signal === "SIGTERM" || elapsedMs >= TIMEOUT_MS;
      onEvent({
        type: "done",
        success: timedOut ? false : exitCode === 0,
        execution_time_ms: elapsedMs,
        error: timedOut ? "Execution timed out (10s limit)" : null,
      });
      resolve();
    });

    child.on("error", (err) => {
      onEvent({
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
