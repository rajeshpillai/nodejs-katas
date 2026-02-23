---
id: retry-strategies
phase: 14
phase_title: Background Jobs & Async Systems
sequence: 3
title: Retry Strategies
difficulty: advanced
tags: [retry, backoff, exponential, jitter, resilience, circuit-breaker]
prerequisites: [job-queues]
estimated_minutes: 15
---

## Concept

External services fail. Networks are unreliable. Databases hit timeouts. Retry strategies determine how your system recovers from transient failures.

**Retry approaches:**

1. **Immediate retry** — try again right away (only for rare, instant glitches)
2. **Fixed delay** — wait a constant time between retries (e.g., 1s, 1s, 1s)
3. **Exponential backoff** — double the delay each time (e.g., 1s, 2s, 4s, 8s)
4. **Exponential backoff + jitter** — add randomness to prevent thundering herd

**Which errors are retryable?**
- Network timeouts — yes (transient)
- 503 Service Unavailable — yes (server overloaded)
- 429 Too Many Requests — yes (with Retry-After header)
- 500 Internal Server Error — maybe (depends on the API)
- 400 Bad Request — no (your input is wrong)
- 404 Not Found — no (the resource doesn't exist)
- 409 Conflict — no (duplicate, fix the data)

**Circuit breaker** — after N consecutive failures, stop trying for a cooldown period. This prevents overwhelming a failing service with retries.

## Key Insight

> Exponential backoff without jitter causes the "thundering herd" problem: if 1000 clients fail at the same time, they all retry at exactly 1s, then 2s, then 4s — hitting the recovering service with synchronized bursts. Adding random jitter (e.g., `delay * (0.5 + Math.random())`) spreads the retries over time, giving the service a chance to recover gradually.

## Experiment

```js
console.log("=== Retry Strategies ===\n");

// --- Retry engine ---

class RetryEngine {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 5;
    this.strategy = options.strategy || "exponential-jitter";
    this.baseDelay = options.baseDelay || 100; // ms
    this.maxDelay = options.maxDelay || 10000;  // ms
    this.retryOn = options.retryOn || (() => true);
    this.log = [];
  }

  getDelay(attempt) {
    switch (this.strategy) {
      case "immediate":
        return 0;
      case "fixed":
        return this.baseDelay;
      case "linear":
        return this.baseDelay * attempt;
      case "exponential":
        return Math.min(this.baseDelay * Math.pow(2, attempt), this.maxDelay);
      case "exponential-jitter":
        const exp = this.baseDelay * Math.pow(2, attempt);
        const capped = Math.min(exp, this.maxDelay);
        return Math.round(capped * (0.5 + Math.random() * 0.5));
      case "decorrelated-jitter":
        // AWS-style decorrelated jitter
        const prev = attempt === 0 ? this.baseDelay : this.getDelay(attempt - 1);
        return Math.min(this.maxDelay, Math.round(Math.random() * (prev * 3 - this.baseDelay) + this.baseDelay));
      default:
        return this.baseDelay;
    }
  }

  async execute(fn) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const start = performance.now();
        const result = await fn(attempt);
        const elapsed = performance.now() - start;

        this.log.push({
          attempt,
          status: "success",
          elapsed: Math.round(elapsed),
        });

        return result;
      } catch (err) {
        lastError = err;
        const elapsed = performance.now();

        if (attempt === this.maxRetries || !this.retryOn(err)) {
          this.log.push({
            attempt,
            status: "final-failure",
            error: err.message,
          });
          throw err;
        }

        const delay = this.getDelay(attempt);
        this.log.push({
          attempt,
          status: "retry",
          error: err.message,
          delay,
        });

        await new Promise(r => setTimeout(r, Math.min(delay, 50))); // Capped for demo
      }
    }

    throw lastError;
  }
}

// --- Demo 1: Compare backoff strategies ---

console.log("--- Backoff strategy comparison ---\n");

const strategies = ["immediate", "fixed", "linear", "exponential", "exponential-jitter"];

console.log(`  ${"Attempt".padEnd(10)} ${strategies.map(s => s.padEnd(18)).join("")}`);
console.log(`  ${"─".repeat(10 + strategies.length * 18)}`);

for (let attempt = 0; attempt < 8; attempt++) {
  const delays = strategies.map(strategy => {
    const engine = new RetryEngine({ strategy, baseDelay: 100, maxDelay: 10000 });
    return engine.getDelay(attempt);
  });

  console.log(`  ${String(attempt).padEnd(10)} ${delays.map(d => `${d}ms`.padEnd(18)).join("")}`);
}

// --- Demo 2: Retry with transient failure ---

console.log("\n--- Retry with transient failure ---\n");

let failCount = 0;
const engine = new RetryEngine({
  strategy: "exponential-jitter",
  maxRetries: 5,
  baseDelay: 100,
});

try {
  const result = await engine.execute(async (attempt) => {
    failCount++;
    if (failCount <= 3) {
      throw new Error(`Connection timeout (attempt ${failCount})`);
    }
    return { data: "success!", attempts: failCount };
  });

  console.log("  Result:", JSON.stringify(result));
} catch (err) {
  console.log("  Final error:", err.message);
}

console.log("\n  Retry log:");
for (const entry of engine.log) {
  if (entry.status === "retry") {
    console.log(`    Attempt ${entry.attempt}: ${entry.error} → retry in ${entry.delay}ms`);
  } else {
    console.log(`    Attempt ${entry.attempt}: ${entry.status}`);
  }
}

// --- Demo 3: Non-retryable errors ---

console.log("\n--- Non-retryable errors ---\n");

const smartEngine = new RetryEngine({
  strategy: "exponential-jitter",
  maxRetries: 5,
  retryOn: (err) => {
    // Only retry transient errors
    const retryableCodes = [408, 429, 500, 502, 503, 504];
    return retryableCodes.includes(err.statusCode);
  },
});

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// 400 Bad Request — should NOT retry
try {
  await smartEngine.execute(async () => {
    throw new HttpError(400, "Invalid email format");
  });
} catch (err) {
  console.log(`  400 Bad Request: "${err.message}" → no retry (${smartEngine.log.length} attempt)`);
}

// 503 Service Unavailable — SHOULD retry
const engine503 = new RetryEngine({
  strategy: "exponential-jitter",
  maxRetries: 3,
  retryOn: (err) => [503].includes(err.statusCode),
});

let calls503 = 0;
try {
  await engine503.execute(async () => {
    calls503++;
    if (calls503 < 3) throw new HttpError(503, "Service unavailable");
    return "ok";
  });
  console.log(`  503 Service Unavailable: succeeded after ${calls503} attempts`);
} catch (err) {
  console.log(`  503: failed after ${calls503} attempts`);
}

// --- Demo 4: Circuit breaker ---

console.log("\n--- Circuit breaker ---\n");

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 10000;
    this.state = "closed"; // closed = normal, open = rejecting, half-open = testing
    this.failures = 0;
    this.lastFailure = 0;
    this.successes = 0;
    this.log = [];
  }

  async execute(fn) {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.cooldownMs) {
        this.state = "half-open";
        this.log.push({ state: "half-open", reason: "cooldown expired" });
      } else {
        this.log.push({ state: "open", action: "rejected" });
        throw new Error("Circuit is open — request rejected");
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this.failures = 0;
    this.successes++;
    if (this.state === "half-open") {
      this.state = "closed";
      this.log.push({ state: "closed", reason: "test request succeeded" });
    }
  }

  _onFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
      this.log.push({ state: "open", reason: `${this.failures} consecutive failures` });
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }
}

const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 200 });

// Simulate failures
for (let i = 0; i < 8; i++) {
  try {
    await breaker.execute(async () => {
      if (i < 5) throw new Error("Service down");
      return "ok";
    });
    console.log(`  Call ${i + 1}: success — state: ${breaker.state}`);
  } catch (err) {
    console.log(`  Call ${i + 1}: ${err.message} — state: ${breaker.state}`);
  }
}

// Wait for cooldown
await new Promise(r => setTimeout(r, 250));

// Half-open: test request
try {
  await breaker.execute(async () => "recovered!");
  console.log(`  Call 9 (after cooldown): success — state: ${breaker.state}`);
} catch (err) {
  console.log(`  Call 9: ${err.message}`);
}

console.log(`\n  Circuit breaker log:`);
for (const entry of breaker.log) {
  console.log(`    State → ${entry.state}: ${entry.reason || entry.action}`);
}

// --- Demo 5: Best practices ---

console.log("\n=== Retry Best Practices ===\n");

const practices = [
  ["Always use jitter", "Prevents thundering herd on retry"],
  ["Set a max retry count", "Don't retry forever (3-5 for APIs, 10+ for jobs)"],
  ["Classify errors", "Only retry transient errors (5xx, timeouts)"],
  ["Respect Retry-After", "429 responses often include when to retry"],
  ["Make operations idempotent", "Retrying a non-idempotent operation is dangerous"],
  ["Log every retry", "Visibility into retry patterns reveals systemic issues"],
  ["Add circuit breakers", "Stop hammering a failing service"],
  ["Set total timeout", "Don't let retries exceed the user's patience"],
];

for (const [practice, reason] of practices) {
  console.log(`  ${practice}`);
  console.log(`    → ${reason}\n`);
}
```

## Expected Output

```
=== Retry Strategies ===

--- Backoff strategy comparison ---

  Attempt   immediate         fixed             linear            exponential       exponential-jitter
  0         0ms               100ms             0ms               100ms             ~75ms
  1         0ms               100ms             100ms             200ms             ~150ms
  2         0ms               100ms             200ms             400ms             ~300ms
  ...

--- Retry with transient failure ---

  Result: {"data":"success!","attempts":4}

  Retry log:
    Attempt 0: Connection timeout → retry in ~75ms
    Attempt 1: Connection timeout → retry in ~150ms
    Attempt 2: Connection timeout → retry in ~300ms
    Attempt 3: success
  ...
```

## Challenge

1. Implement a retry-aware HTTP client that automatically retries on 5xx errors with exponential backoff, respects `Retry-After` headers, and gives up after a total timeout
2. Build a circuit breaker that tracks failure rates per endpoint (not globally) — `/api/users` might be healthy while `/api/payments` is failing
3. What's the difference between "at least once" and "exactly once" delivery? Why is "exactly once" so hard, and how does idempotency help?

## Common Mistakes

- Retrying without backoff — immediate retries at full speed overwhelm a recovering service
- Not adding jitter — synchronized retries from multiple clients create periodic spikes
- Retrying non-idempotent operations — sending a payment twice is worse than not sending it at all
- No maximum retry limit — infinite retries waste resources and may never succeed
