---
id: process-lifecycle
phase: 3
phase_title: File System & OS Interaction
sequence: 5
title: Process Lifecycle and Signals
difficulty: intermediate
tags: [process, signals, graceful-shutdown, error-handling]
prerequisites: [process-and-environment]
estimated_minutes: 15
---

## Concept

A Node.js process goes through a lifecycle:

1. **Startup** — load modules, execute top-level code
2. **Running** — event loop processes callbacks, I/O, timers
3. **Shutdown** — event loop empties, or process receives a signal

Understanding this lifecycle is critical for building reliable servers. A production process must:

- **Handle errors** without crashing — `uncaughtException`, `unhandledRejection`
- **Respond to signals** — `SIGINT` (Ctrl+C), `SIGTERM` (container stop)
- **Shut down gracefully** — close database connections, finish in-flight requests, flush logs

The process exits when the event loop has nothing left to do (no timers, no I/O, no listeners), or when `process.exit()` is called, or when an unhandled error occurs.

## Key Insight

> A production server must handle its own death gracefully. Catching `SIGTERM`, closing connections, finishing in-flight work, and then exiting cleanly is the difference between a reliable system and a system that corrupts data on restart.

## Experiment

```js
console.log("=== Process Lifecycle Demo ===\n");
console.log("PID:", process.pid);
console.log("Title:", process.title);

// Track lifecycle events
process.on("exit", (code) => {
  // Only synchronous code runs here — no async!
  console.log(`\n[exit] Process exiting with code ${code}`);
});

process.on("beforeExit", (code) => {
  // Fires when event loop is empty, before exit
  // Can schedule async work to keep the process alive
  console.log(`[beforeExit] Event loop empty (code: ${code})`);
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error(`[uncaughtException] ${err.message}`);
  // In production: log the error, then exit
  // process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[unhandledRejection] ${reason}`);
  // In production: log and exit
});

// Signal handling
const signals = ["SIGINT", "SIGTERM"];
for (const sig of signals) {
  process.on(sig, () => {
    console.log(`[${sig}] Received — would shut down gracefully`);
    // In a real server:
    // 1. Stop accepting new connections
    // 2. Wait for in-flight requests to finish
    // 3. Close database connections
    // 4. process.exit(0)
  });
}
console.log("Signal handlers registered for:", signals.join(", "));

// Demonstrate error handling
console.log("\n=== Error Handling ===\n");

// Trigger an unhandled rejection (caught by our handler)
Promise.reject("intentional rejection for demo");

// Simulate async work that keeps the process alive
console.log("Scheduling work...");

setTimeout(() => {
  console.log("\n[timer] Async work completed");

  // Demonstrate uncaughtException
  setTimeout(() => {
    // This would crash without our handler
    throw new Error("intentional error for demo");
  }, 10);
}, 50);

// Show resource tracking
console.log("\n=== Active Resources ===\n");
const resources = process.getActiveResourcesInfo();
console.log("Active handles keeping process alive:");
for (const r of resources) {
  console.log(`  - ${r}`);
}
```

## Expected Output

```
=== Process Lifecycle Demo ===

PID: <number>
Title: node
Signal handlers registered for: SIGINT, SIGTERM

=== Error Handling ===

Scheduling work...

=== Active Resources ===

Active handles keeping process alive:
  - Timeout
  - ...
[unhandledRejection] intentional rejection for demo

[timer] Async work completed
[uncaughtException] intentional error for demo

[exit] Process exiting with code 0
```

## Challenge

1. Write a graceful shutdown function that: sets a "shutting down" flag, calls `server.close()`, waits up to 10 seconds for in-flight requests, then exits
2. What's the difference between `process.exit(0)` and `process.exitCode = 0`? Which allows cleanup handlers to run?
3. Use `process.getActiveResourcesInfo()` to debug why a process isn't exiting — find the resource keeping it alive

## Deep Dive

Graceful shutdown pattern for production servers:

```
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;  // prevent double shutdown
  isShuttingDown = true;

  console.log('Shutting down...');

  // 1. Stop accepting new work
  server.close();

  // 2. Wait for in-flight work (with timeout)
  const timeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30_000);
  timeout.unref();  // don't keep process alive

  // 3. Close resources
  await db.end();

  // 4. Exit cleanly
  process.exit(0);
});
```

The `.unref()` on the timeout is important — without it, the timeout itself keeps the process alive for 30 seconds even if everything else closes cleanly.

## Common Mistakes

- Using `process.on('uncaughtException')` to silently swallow errors — always exit after logging. The process state may be corrupted
- Not handling `SIGTERM` — containers (Docker, Kubernetes) send `SIGTERM` before `SIGKILL`. You have ~30 seconds to clean up
- Running async code in the `'exit'` handler — only synchronous code works there
- Forgetting to `.unref()` shutdown timeouts — they keep the process alive unnecessarily
