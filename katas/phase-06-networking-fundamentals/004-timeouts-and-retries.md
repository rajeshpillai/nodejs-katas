---
id: timeouts-and-retries
phase: 6
phase_title: Networking Fundamentals
sequence: 4
title: Timeouts and Retries
difficulty: intermediate
tags: [networking, timeouts, retries, exponential-backoff, resilience]
prerequisites: [socket-lifecycle]
estimated_minutes: 15
---

## Concept

Networks are unreliable. Connections drop, servers crash, packets get lost, DNS fails. Robust network code needs two defenses:

**Timeouts** prevent your application from waiting forever:
- **Connection timeout** — how long to wait for the TCP handshake
- **Socket timeout** — how long to wait for data after connecting
- **Request timeout** — how long the entire operation can take
- **DNS timeout** — how long to wait for name resolution

**Retries** let you recover from transient failures:
- **Immediate retry** — try again right away (good for network glitches)
- **Fixed delay** — wait N seconds between attempts
- **Exponential backoff** — double the wait each time (1s, 2s, 4s, 8s...)
- **Exponential backoff with jitter** — add randomness to prevent thundering herd

The combination of timeouts + exponential backoff with jitter is the gold standard for resilient network code. Without timeouts, your app hangs. Without backoff, retries can DDoS a struggling server. Without jitter, all clients retry at the same moment.

## Key Insight

> Every network operation must have a timeout. Without one, a single unresponsive server can make your entire application hang forever. And every retry strategy must include exponential backoff with jitter — otherwise, when a server comes back up after a failure, all clients retry simultaneously and knock it down again (thundering herd).

## Experiment

```js
import { createServer, createConnection } from "net";

console.log("=== Socket Timeouts ===\n");

// Server that responds slowly
const slowServer = createServer((socket) => {
  // Don't respond for 3 seconds
  const timer = setTimeout(() => {
    socket.write("Finally responding!\n");
    socket.end();
  }, 3000);

  socket.on("close", () => clearTimeout(timer));
});

await new Promise(resolve => slowServer.listen(0, "127.0.0.1", resolve));
const slowPort = slowServer.address().port;

// Client with a 1-second timeout
const client = createConnection({ host: "127.0.0.1", port: slowPort });
client.setTimeout(1000);

const result = await new Promise((resolve) => {
  client.on("timeout", () => {
    console.log("[client] Timeout after 1000ms — server too slow");
    client.destroy();  // Must manually destroy on timeout!
    resolve("timeout");
  });

  client.on("data", (data) => {
    resolve(`data: ${data.toString().trim()}`);
  });

  client.on("error", (err) => {
    console.log("[client] Error:", err.message);
    resolve("error");
  });
});

console.log("Result:", result);
slowServer.close();

await new Promise(r => setTimeout(r, 100));

console.log("\n=== Retry with Exponential Backoff ===\n");

async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 5000,
    jitter = true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (err) {
      lastError = err;
      console.log(`  Attempt ${attempt + 1} failed: ${err.message}`);

      if (attempt < maxRetries) {
        // Exponential backoff: baseDelay * 2^attempt
        let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

        // Add jitter (±25%)
        if (jitter) {
          const jitterAmount = delay * 0.25;
          delay += (Math.random() * 2 - 1) * jitterAmount;
          delay = Math.round(delay);
        }

        console.log(`  Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError.message}`);
}

// Simulate a flaky operation that fails 60% of the time
let callCount = 0;
const flakyOperation = async (attempt) => {
  callCount++;
  if (Math.random() < 0.6) {
    throw new Error("Random failure");
  }
  return `Success on attempt ${attempt + 1} (call #${callCount})`;
};

try {
  const result = await withRetry(flakyOperation, {
    maxRetries: 5,
    baseDelay: 50,
  });
  console.log("Result:", result);
} catch (err) {
  console.log("Final failure:", err.message);
}

console.log("\n=== Connection Retry Pattern ===\n");

// Server that only starts after a delay (simulates server restart)
let serverReady = false;
const reliableServer = createServer((socket) => {
  socket.write("Connected!\n");
  socket.end();
});

// Start server after 400ms
setTimeout(async () => {
  await new Promise(resolve => reliableServer.listen(0, "127.0.0.1", resolve));
  serverReady = true;
  console.log(`  [server] Now listening on port ${reliableServer.address().port}`);
}, 400);

// Client tries to connect with retries
async function connectWithRetry(port, maxRetries = 5) {
  return withRetry(async (attempt) => {
    // Use the port from the server once it's ready
    const targetPort = serverReady ? reliableServer.address().port : port;

    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: targetPort });
      socket.setTimeout(200);

      socket.on("data", (data) => {
        socket.destroy();
        resolve(data.toString().trim());
      });

      socket.on("error", (err) => reject(err));
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
    });
  }, { maxRetries, baseDelay: 100 });
}

try {
  // Try to connect to a port that doesn't exist yet
  const msg = await connectWithRetry(49999);
  console.log("Connected:", msg);
} catch (err) {
  console.log("Could not connect:", err.message);
}

reliableServer.close();

console.log("\n=== Timeout Strategies ===\n");

// AbortController for request-level timeouts
async function fetchWithTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await operation(controller.signal);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// Simulate a slow operation
async function slowOperation(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("completed"), 2000);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Operation aborted (timeout)"));
    });
  });
}

try {
  await fetchWithTimeout(slowOperation, 500);
} catch (err) {
  console.log("Timeout with AbortController:", err.message);
}

console.log("\n=== Backoff Visualization ===\n");

const baseDelay = 100;
console.log("Exponential backoff delays (base=100ms, max=10s):");
for (let i = 0; i < 8; i++) {
  const delay = Math.min(baseDelay * Math.pow(2, i), 10000);
  const jitter = Math.round(delay * 0.25);
  const bar = "█".repeat(Math.round(delay / 200));
  console.log(`  Attempt ${i + 1}: ${String(delay).padStart(5)}ms ±${String(jitter).padStart(4)}ms ${bar}`);
}
```

## Expected Output

```
=== Socket Timeouts ===

[client] Timeout after 1000ms — server too slow
Result: timeout

=== Retry with Exponential Backoff ===

  Attempt 1 failed: Random failure
  Retrying in <~100>ms...
  ...
Result: Success on attempt <N>

=== Connection Retry Pattern ===

  Attempt 1 failed: connect ECONNREFUSED 127.0.0.1:49999
  Retrying in <delay>ms...
  ...
  [server] Now listening on port <port>
Connected: Connected!

=== Timeout Strategies ===

Timeout with AbortController: Operation aborted (timeout)

=== Backoff Visualization ===

Exponential backoff delays (base=100ms, max=10s):
  Attempt 1:   100ms ±  25ms █
  Attempt 2:   200ms ±  50ms █
  Attempt 3:   400ms ± 100ms ██
  Attempt 4:   800ms ± 200ms ████
  Attempt 5:  1600ms ± 400ms ████████
  Attempt 6:  3200ms ± 800ms ████████████████
  Attempt 7:  6400ms ±1600ms ████████████████████████████████
  Attempt 8: 10000ms ±2500ms ██████████████████████████████████████████████████
```

## Challenge

1. Implement a circuit breaker: after N consecutive failures, stop retrying for a cooldown period, then try one "probe" request to see if the service is back
2. Add per-attempt timeout to the retry function — each attempt gets its own timeout, and the timeout can increase with each retry
3. What happens if you don't add jitter to exponential backoff? Simulate 100 clients all retrying the same server — observe the "thundering herd" pattern

## Deep Dive

The three timeout layers in a typical Node.js HTTP client:

1. **DNS timeout** — `dns.resolve()` with `AbortSignal.timeout()`
2. **Connection timeout** — `socket.setTimeout()` or connection options
3. **Response timeout** — total time waiting for the complete response

Each layer needs its own timeout. A common mistake is setting only a response timeout — the connection could hang for minutes before timing out if DNS resolution stalls.

`AbortController` is the modern Node.js pattern for cancellation. Many APIs accept an `AbortSignal`: `fetch()`, `fs.readFile()`, `setTimeout()` (Node.js 16+), and custom async operations.

## Common Mistakes

- `socket.setTimeout()` doesn't close the socket — it only emits `'timeout'`. You must call `socket.destroy()` in the handler
- Retrying non-idempotent operations (POST requests) — the first attempt may have succeeded, and retrying creates duplicates
- No maximum retry limit — infinite retries with backoff can keep retrying for hours
- Same retry strategy everywhere — a DNS failure needs different handling than a 503 response
