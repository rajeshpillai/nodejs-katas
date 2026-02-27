import { spawn } from "child_process";

const TIMEOUT_MS = 10_000;
const MAX_MEMORY_MB = 64;

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
