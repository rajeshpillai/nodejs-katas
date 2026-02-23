---
id: crash-handling
phase: 12
phase_title: Observability & Reliability
sequence: 4
title: Crash Handling and Recovery
difficulty: intermediate
tags: [errors, uncaught, unhandled, crash, recovery, process]
prerequisites: [metrics]
estimated_minutes: 12
---

## Concept

Node.js processes can crash from:

1. **Uncaught exceptions** — a thrown error with no try/catch
2. **Unhandled promise rejections** — a rejected promise with no `.catch()`
3. **Out of memory** — V8 heap exhausted
4. **Segmentation faults** — native addon bugs
5. **SIGKILL** — OS or orchestrator forcefully kills the process

**The correct response to a crash:**

```js
// Log the error, clean up, then EXIT
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  // Attempt cleanup (close server, flush logs)
  process.exit(1);  // EXIT — the process is in an unknown state
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled rejection');
  process.exit(1);
});
```

**Why you must exit after uncaughtException:**
After an uncaught exception, the process is in an **undefined state**. In-flight requests may be partially completed, shared state may be corrupted, resources may be leaked. The safest response is to log the error, stop accepting new requests, finish in-flight requests (if possible), and exit. A process manager (systemd, PM2, Kubernetes) should then restart the process.

## Key Insight

> Do NOT use `uncaughtException` to "keep the server running." After an uncaught exception, you don't know what state the process is in — database connections may be half-open, transactions may be uncommitted, file handles may be leaked. The process must exit. The real fix for uncaught exceptions is to add proper error handling (try/catch, .catch()) so they never reach the process level in the first place.

## Experiment

```js
console.log("=== Crash Handling and Recovery ===\n");

// --- Simulated process lifecycle ---

class ProcessSimulator {
  constructor() {
    this.state = "starting";
    this.inFlightRequests = 0;
    this.logs = [];
    this.exitCode = null;
  }

  log(level, msg, extra = {}) {
    this.logs.push({ level, msg, ...extra, time: Date.now() });
  }

  simulateUncaughtException(err) {
    this.log("fatal", "Uncaught exception", {
      error: err.message,
      stack: err.stack?.split("\n").slice(0, 2).join(" | "),
    });

    // Step 1: Stop accepting new requests
    this.state = "shutting-down";
    this.log("info", "Stopped accepting new requests");

    // Step 2: Wait for in-flight requests (with timeout)
    if (this.inFlightRequests > 0) {
      this.log("info", `Waiting for ${this.inFlightRequests} in-flight requests`);
    }

    // Step 3: Close resources
    this.log("info", "Closing database connections");
    this.log("info", "Flushing log buffer");

    // Step 4: Exit
    this.exitCode = 1;
    this.state = "exited";
    this.log("info", `Process exiting with code ${this.exitCode}`);
  }

  simulateUnhandledRejection(reason) {
    this.log("fatal", "Unhandled promise rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    this.exitCode = 1;
    this.state = "exited";
    this.log("info", `Process exiting with code ${this.exitCode}`);
  }

  printLogs() {
    for (const log of this.logs) {
      const { level, msg, time, ...rest } = log;
      const extra = Object.keys(rest).length > 0
        ? " " + JSON.stringify(rest)
        : "";
      console.log(`    [${level.toUpperCase().padEnd(5)}] ${msg}${extra}`);
    }
  }
}

// --- Demo 1: Uncaught exception handling ---

console.log("--- Scenario 1: Uncaught exception ---\n");

const sim1 = new ProcessSimulator();
sim1.state = "running";
sim1.inFlightRequests = 3;

const err = new Error("Cannot read properties of undefined (reading 'id')");
sim1.simulateUncaughtException(err);
sim1.printLogs();
console.log(`\n  Final state: ${sim1.state}, exit code: ${sim1.exitCode}\n`);

// --- Demo 2: Unhandled promise rejection ---

console.log("--- Scenario 2: Unhandled promise rejection ---\n");

const sim2 = new ProcessSimulator();
sim2.state = "running";

sim2.simulateUnhandledRejection(new Error("ECONNREFUSED: database connection failed"));
sim2.printLogs();
console.log(`\n  Final state: ${sim2.state}, exit code: ${sim2.exitCode}\n`);

// --- Demo 3: Proper error handling prevents crashes ---

console.log("--- Scenario 3: Proper error handling ---\n");

// Bad: unhandled promise rejection
console.log("  BAD (causes crash):");
console.log(`    async function getUser(id) {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
      return result.rows[0];  // If db.query rejects, nothing catches it!
    }
    getUser(42);  // No .catch() → unhandled rejection
  `);

// Good: proper error handling
console.log("  GOOD (handles errors):");
console.log(`    async function getUser(id) {
      try {
        const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0];
      } catch (err) {
        logger.error({ err, userId: id }, 'Failed to fetch user');
        throw new AppError('User fetch failed', 500);
      }
    }
  `);

// --- Demo 4: Complete crash handler setup ---

console.log("--- Complete crash handler setup ---\n");

console.log(`  // 1. Uncaught exceptions
  process.on('uncaughtException', (err, origin) => {
    logger.fatal({ err, origin }, 'Uncaught exception');
    // Give time for logs to flush, then exit
    setTimeout(() => process.exit(1), 1000).unref();
  });

  // 2. Unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ err: reason }, 'Unhandled rejection');
    setTimeout(() => process.exit(1), 1000).unref();
  });

  // 3. Warnings (don't exit, just log)
  process.on('warning', (warning) => {
    logger.warn({ warning: warning.message }, 'Process warning');
  });
`);

// --- Demo 5: Process manager restart strategies ---

console.log("--- Process manager restart strategies ---\n");

const strategies = [
  ["Tool", "Strategy", "Config"],
  ["systemd", "Restart=on-failure", "RestartSec=1, StartLimitBurst=5"],
  ["PM2", "Autorestart + max_restarts", "max_restarts: 10, min_uptime: 5000"],
  ["Kubernetes", "restartPolicy: Always", "backoff: 10s, 20s, 40s... 5min"],
  ["Docker", "restart: unless-stopped", "Exponential backoff built-in"],
];

for (const [tool, strategy, config] of strategies) {
  console.log(`  ${tool.padEnd(12)} ${strategy.padEnd(30)} ${config}`);
}

// --- Demo 6: Crash vs graceful shutdown ---

console.log("\n--- Crash vs graceful shutdown ---\n");

const comparison = [
  ["Aspect", "Crash (uncaught)", "Graceful (SIGTERM)"],
  ["Trigger", "Bug in code", "Deployment/scaling"],
  ["In-flight requests", "Dropped/corrupted", "Completed (with timeout)"],
  ["Database transactions", "Left open (rollback by DB)", "Committed/rolled back"],
  ["Log buffer", "May be lost", "Flushed before exit"],
  ["Exit code", "1 (error)", "0 (success)"],
  ["Response", "Fix the bug", "Normal operation"],
];

for (const [aspect, crash, graceful] of comparison) {
  console.log(`  ${aspect.padEnd(22)} ${crash.padEnd(28)} ${graceful}`);
}

// --- Demo 7: Common crash causes ---

console.log("\n--- Common crash causes in Node.js ---\n");

const causes = [
  ["TypeError: Cannot read properties of undefined", "Missing null checks, unexpected API response shape"],
  ["RangeError: Maximum call stack size exceeded", "Infinite recursion, stack overflow"],
  ["FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed", "V8 heap out of memory (increase --max-old-space-size)"],
  ["ERR_UNHANDLED_REJECTION", "Promise rejected without .catch()"],
  ["ECONNREFUSED / ENOTFOUND", "Database or external service unavailable"],
  ["EMFILE: too many open files", "File descriptor leak (forgot to close)"],
];

for (const [error, cause] of causes) {
  console.log(`  ${error}`);
  console.log(`    → ${cause}\n`);
}
```

## Expected Output

```
=== Crash Handling and Recovery ===

--- Scenario 1: Uncaught exception ---

    [FATAL] Uncaught exception {"error":"Cannot read properties..."}
    [INFO ] Stopped accepting new requests
    [INFO ] Waiting for 3 in-flight requests
    [INFO ] Closing database connections
    [INFO ] Flushing log buffer
    [INFO ] Process exiting with code 1

  Final state: exited, exit code: 1

--- Scenario 2: Unhandled promise rejection ---

    [FATAL] Unhandled promise rejection {"reason":"ECONNREFUSED..."}
    [INFO ] Process exiting with code 1
  ...
```

## Challenge

1. Build a crash reporter that captures the error, stack trace, environment info (Node version, OS, memory usage), and sends it to a webhook URL before the process exits
2. Implement a "last resort" error boundary for Express/Fastify middleware that catches synchronous and asynchronous errors and returns a 500 response instead of crashing
3. What's the difference between `process.exit(1)` and `process.abort()`? When would you use each?

## Common Mistakes

- Catching `uncaughtException` and continuing to serve requests — the process state is corrupted, exit immediately
- Not logging the error before exiting — you lose the most important debugging information
- Relying on `process.exit()` alone — async operations (log flushing, connection closing) may not complete. Use `setTimeout(...).unref()` to give cleanup a chance
- Not having a process manager — without auto-restart, a single uncaught exception takes your service down permanently
