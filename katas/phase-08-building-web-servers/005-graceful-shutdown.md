---
id: graceful-shutdown
phase: 8
phase_title: Building Web Servers & APIs
sequence: 5
title: Graceful Shutdown
difficulty: intermediate
tags: [shutdown, signals, production, reliability, server]
prerequisites: [error-handling, process-lifecycle]
estimated_minutes: 15
---

## Concept

When a production server needs to stop (deployment, scaling, maintenance), it must shut down gracefully:

1. **Stop accepting new connections** — `server.close()`
2. **Finish in-flight requests** — let active requests complete
3. **Close external resources** — database connections, message queues, file handles
4. **Exit the process** — `process.exit(0)` or let the event loop drain

The trigger is usually a signal:
- **`SIGTERM`** — "please terminate" (sent by container orchestrators, `kill` command)
- **`SIGINT`** — "interrupt" (Ctrl+C in terminal)

Without graceful shutdown, in-flight requests get abruptly killed, database transactions may be left in an inconsistent state, and connections leak.

In containerized environments (Docker, Kubernetes), `SIGTERM` is sent first, then after a grace period (default 30s in Kubernetes), `SIGKILL` (which can't be caught). Your server must finish its work within that window.

## Key Insight

> A server that doesn't handle `SIGTERM` is a server that corrupts data on every deployment. In-flight database transactions are interrupted, WebSocket clients get disconnected without close frames, and cached writes are lost. Graceful shutdown is not a nice-to-have — it's a correctness requirement.

## Experiment

```js
import { createServer } from "http";

console.log("=== Graceful Shutdown ===\n");

// Simulated resources
class Database {
  constructor() {
    this.connected = true;
    this.activeQueries = 0;
  }

  async query(sql) {
    this.activeQueries++;
    await new Promise(r => setTimeout(r, 50));  // Simulate query
    this.activeQueries--;
    return { rows: [] };
  }

  async close() {
    // Wait for active queries to finish
    while (this.activeQueries > 0) {
      console.log(`  [db] Waiting for ${this.activeQueries} active queries...`);
      await new Promise(r => setTimeout(r, 100));
    }
    this.connected = false;
    console.log("  [db] Connection closed");
  }
}

// --- Graceful Shutdown Manager ---

class GracefulShutdown {
  constructor() {
    this.isShuttingDown = false;
    this.resources = [];     // { name, close() }
    this.servers = [];       // http.Server instances
    this.shutdownTimeout = 10_000;  // Max 10 seconds for shutdown
  }

  // Register a resource that needs cleanup
  registerResource(name, closeFn) {
    this.resources.push({ name, close: closeFn });
  }

  // Register an HTTP server
  registerServer(server) {
    this.servers.push(server);
  }

  // Install signal handlers
  install() {
    const signals = ["SIGTERM", "SIGINT"];
    for (const signal of signals) {
      process.on(signal, () => {
        console.log(`\n[shutdown] Received ${signal}`);
        this.shutdown();
      });
    }

    // Handle uncaught errors — log and exit
    process.on("uncaughtException", (err) => {
      console.error("[fatal] Uncaught exception:", err.message);
      this.shutdown(1);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[fatal] Unhandled rejection:", reason);
      this.shutdown(1);
    });
  }

  async shutdown(exitCode = 0) {
    if (this.isShuttingDown) {
      console.log("[shutdown] Already shutting down...");
      return;
    }
    this.isShuttingDown = true;

    console.log("[shutdown] Starting graceful shutdown...");

    // Set a hard deadline
    const deadline = setTimeout(() => {
      console.error("[shutdown] Timeout! Forcing exit.");
      process.exit(1);
    }, this.shutdownTimeout);
    deadline.unref();  // Don't keep process alive

    try {
      // Step 1: Stop accepting new connections
      console.log("[shutdown] Step 1: Closing servers...");
      await Promise.all(this.servers.map(server =>
        new Promise((resolve) => {
          server.close(() => {
            console.log("  [server] Stopped accepting connections");
            resolve();
          });
        })
      ));

      // Step 2: Wait for in-flight requests
      // (server.close() callback fires when all active connections finish)
      console.log("[shutdown] Step 2: In-flight requests completed");

      // Step 3: Close resources (in reverse order of registration)
      console.log("[shutdown] Step 3: Closing resources...");
      for (const resource of this.resources.reverse()) {
        try {
          await resource.close();
          console.log(`  [${resource.name}] Closed`);
        } catch (err) {
          console.error(`  [${resource.name}] Error closing: ${err.message}`);
        }
      }

      console.log(`[shutdown] Complete (exit code: ${exitCode})`);
      process.exit(exitCode);

    } catch (err) {
      console.error("[shutdown] Error during shutdown:", err.message);
      process.exit(1);
    }
  }
}

// --- Application ---

const db = new Database();
const shutdown = new GracefulShutdown();
shutdown.shutdownTimeout = 5000;

// Simulated cache
const cache = {
  data: new Map(),
  async flush() {
    console.log(`  [cache] Flushing ${cache.data.size} entries...`);
    await new Promise(r => setTimeout(r, 100));
  }
};

// Register resources (will be closed in reverse order)
shutdown.registerResource("database", () => db.close());
shutdown.registerResource("cache", () => cache.flush());

// Create server with shutdown-aware middleware
let activeRequests = 0;

const server = createServer(async (req, res) => {
  // Reject new requests during shutdown
  if (shutdown.isShuttingDown) {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Retry-After": "5",
      "Connection": "close",
    });
    res.end(JSON.stringify({ error: "Service shutting down" }));
    return;
  }

  activeRequests++;

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/slow") {
      // Simulate a slow request
      await db.query("SELECT * FROM users");
      await new Promise(r => setTimeout(r, 200));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: "slow response", active: activeRequests }));
    } else if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: shutdown.isShuttingDown ? "shutting_down" : "healthy",
        activeRequests,
        dbConnected: db.connected,
      }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "OK" }));
    }
  } finally {
    activeRequests--;
  }
});

shutdown.registerServer(server);

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

console.log(`Server listening on port ${port}\n`);

// --- Demo: simulate the shutdown sequence ---

console.log("--- Normal operation ---\n");

// Health check
const health = await fetch(`${base}/health`);
console.log("Health:", await health.json());

// Start a slow request (will be in-flight during shutdown)
console.log("\nStarting slow request...");
const slowPromise = fetch(`${base}/slow`).then(r => r.json());

// Give the slow request time to start
await new Promise(r => setTimeout(r, 50));

// Trigger shutdown
console.log("\n--- Triggering shutdown ---\n");
const shutdownPromise = shutdown.shutdown(0);

// Try a new request during shutdown
await new Promise(r => setTimeout(r, 10));
try {
  const duringShutdown = await fetch(`${base}/health`);
  console.log("Request during shutdown:", duringShutdown.status, await duringShutdown.json());
} catch (err) {
  console.log("Request during shutdown failed:", err.message);
}

// Wait for the slow request to complete
const slowResult = await slowPromise;
console.log("\nSlow request completed:", slowResult);

// Note: in a real app, process.exit() would be called by the shutdown manager
// For this demo, we just wait for it to complete
await shutdownPromise.catch(() => {});
```

## Expected Output

```
=== Graceful Shutdown ===

Server listening on port <port>

--- Normal operation ---

Health: { status: 'healthy', activeRequests: 0, dbConnected: true }

Starting slow request...

--- Triggering shutdown ---

[shutdown] Starting graceful shutdown...
[shutdown] Step 1: Closing servers...
Request during shutdown: 503 { error: 'Service shutting down' }

Slow request completed: { result: 'slow response', active: 1 }
  [server] Stopped accepting connections
[shutdown] Step 2: In-flight requests completed
[shutdown] Step 3: Closing resources...
  [cache] Flushing 0 entries...
  [cache] Closed
  [db] Connection closed
  [database] Closed
[shutdown] Complete (exit code: 0)
```

## Challenge

1. Implement a shutdown health check endpoint that returns 503 once shutdown starts — this tells the load balancer to stop routing new traffic to this instance
2. Add connection draining: set `Connection: close` on all responses during shutdown so clients don't try to reuse the connection
3. What happens if a database query hangs during shutdown? Implement a per-resource timeout: if a resource doesn't close within 5 seconds, skip it and continue

## Deep Dive

Kubernetes shutdown sequence:
1. Pod receives `SIGTERM`
2. Pod is removed from Service endpoints (load balancer stops sending traffic)
3. `preStop` hook runs (if configured)
4. Container has `terminationGracePeriodSeconds` (default 30s) to shut down
5. If still running, `SIGKILL` is sent (cannot be caught)

The race condition: step 2 (removing from endpoints) and step 1 (SIGTERM) happen concurrently. New requests may arrive after SIGTERM but before the pod is removed from the load balancer. This is why returning 503 during shutdown is important — it tells the load balancer this instance is going away.

## Common Mistakes

- Not calling `server.close()` — new connections keep arriving, and the server never actually stops
- Calling `process.exit(0)` immediately — kills in-flight requests without letting them complete
- Not `.unref()`-ing the shutdown timeout — the timeout itself keeps the process alive
- Not handling double-signals — pressing Ctrl+C twice should still shut down cleanly, not crash
- Closing resources before in-flight requests finish — a request tries to query a closed database and crashes
