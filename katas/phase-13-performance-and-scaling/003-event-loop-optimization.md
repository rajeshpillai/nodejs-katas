---
id: event-loop-optimization
phase: 13
phase_title: Performance & Scaling
sequence: 3
title: Event Loop Optimization
difficulty: advanced
tags: [event-loop, blocking, optimization, setImmediate, libuv]
prerequisites: [memory-management]
estimated_minutes: 15
---

## Concept

The event loop is Node.js's heartbeat. Every I/O callback, timer, and microtask runs on it. If any single callback takes too long, **all** other work is delayed.

**Blocking detection:**
```js
import { monitorEventLoopDelay } from 'node:perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

setInterval(() => {
  console.log(`Event loop p99: ${(histogram.percentile(99) / 1e6).toFixed(1)}ms`);
  histogram.reset();
}, 5000);
```

**Common blockers:**
- `JSON.parse` / `JSON.stringify` on large payloads (>1MB)
- `fs.readFileSync` / `fs.writeFileSync`
- Complex regex on long strings (catastrophic backtracking)
- Tight computational loops (sorting, crypto, compression)
- Synchronous native addon calls

**Optimization strategies:**
1. **Break up work** — `setImmediate()` between chunks
2. **Offload** — worker threads for CPU-bound tasks
3. **Stream** — process data incrementally instead of buffering
4. **Cache** — avoid repeated expensive computations
5. **Use async APIs** — never use sync variants in servers

## Key Insight

> `setImmediate(callback)` schedules the callback for the next iteration of the event loop's check phase — after I/O polling. This means inserting `await new Promise(r => setImmediate(r))` between chunks of CPU work gives the event loop a chance to process I/O callbacks, timers, and other waiting work. It's the simplest way to keep the server responsive during long computations without the overhead of worker threads.

## Experiment

```js
import { monitorEventLoopDelay } from "node:perf_hooks";

console.log("=== Event Loop Optimization ===\n");

// --- Demo 1: Measuring event loop delay ---

console.log("--- Measuring event loop delay ---\n");

async function measureLoopDelay(label, workFn) {
  // resolution is the sampling interval AND the noise floor: every reading is at
  // least ~resolution ms, so a coarse resolution (e.g. 10) hides anything smaller.
  // Use 1ms so an idle loop reads ~1ms and real stalls stand out.
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();

  // Warm-up: give the sampler a few clean turns to arm and record a baseline
  // BEFORE the work starts. Without this, a synchronous workFn runs before the
  // sampler's first tick is ever scheduled — so the stall is never measured.
  await new Promise(r => setTimeout(r, 50));

  await workFn();

  // Let a few more ticks happen to collect post-work measurements
  await new Promise(r => setTimeout(r, 50));

  histogram.disable();

  const p50 = (histogram.percentile(50) / 1e6).toFixed(2);
  const p99 = (histogram.percentile(99) / 1e6).toFixed(2);
  const max = (histogram.max / 1e6).toFixed(2);
  const min = (histogram.min / 1e6).toFixed(2);

  console.log(`  ${label}:`);
  console.log(`    p50=${p50}ms  p99=${p99}ms  max=${max}ms  min=${min}ms`);

  return { p50: parseFloat(p50), p99: parseFloat(p99), max: parseFloat(max) };
}

// Idle loop (baseline)
await measureLoopDelay("Idle (baseline)", async () => {
  await new Promise(r => setTimeout(r, 200));
});

// Blocking loop
await measureLoopDelay("Blocking (sync computation)", async () => {
  let sum = 0;
  for (let i = 0; i < 5e6; i++) sum += Math.sin(i);
});

// Non-blocking (chunked)
await measureLoopDelay("Non-blocking (chunked)", async () => {
  let sum = 0;
  const chunkSize = 50000;
  for (let i = 0; i < 5e6; i += chunkSize) {
    for (let j = i; j < Math.min(i + chunkSize, 5e6); j++) {
      sum += Math.sin(j);
    }
    await new Promise(r => setImmediate(r));
  }
});

// --- Demo 2: JSON parsing optimization ---

console.log("\n--- JSON parsing: small vs large ---\n");

const smallJson = JSON.stringify({ id: 1, name: "Alice", age: 30 });
const largePayload = Array.from({ length: 10000 }, (_, i) => ({
  id: i, name: `user_${i}`, email: `user${i}@example.com`,
  bio: "x".repeat(100),
}));
const largeJson = JSON.stringify(largePayload);

console.log(`  Small JSON: ${smallJson.length} bytes`);
const smallStart = performance.now();
for (let i = 0; i < 10000; i++) JSON.parse(smallJson);
const smallTime = performance.now() - smallStart;
console.log(`    10K parses: ${smallTime.toFixed(1)}ms (${(smallTime / 10000 * 1000).toFixed(1)}μs each)\n`);

console.log(`  Large JSON: ${(largeJson.length / 1024 / 1024).toFixed(1)} MB`);
const largeStart = performance.now();
JSON.parse(largeJson);
const largeTime = performance.now() - largeStart;
console.log(`    1 parse: ${largeTime.toFixed(1)}ms ← blocks event loop!\n`);

console.log(`  Strategy for large JSON:`);
console.log(`    1. Streaming parser (jsonparse, stream-json)`);
console.log(`    2. Worker thread for large payloads`);
console.log(`    3. Set body size limit (reject > 1MB)`);

// --- Demo 3: Regex catastrophic backtracking ---

console.log("\n--- Regex catastrophic backtracking ---\n");

// Safe regex
const safeRegex = /^[a-z]+@[a-z]+\.[a-z]+$/;
const safeStart = performance.now();
for (let i = 0; i < 10000; i++) safeRegex.test("user@example.com");
const safeTime = performance.now() - safeStart;
console.log(`  Safe regex:  10K tests in ${safeTime.toFixed(1)}ms`);

// Dangerous regex (exponential backtracking)
const dangerousInput = "a".repeat(25) + "!"; // Triggers backtracking
const dangerousRegex = /^(a+)+$/; // Nested quantifiers = catastrophic

const dangerousStart = performance.now();
dangerousRegex.test(dangerousInput);
const dangerousTime = performance.now() - dangerousStart;
console.log(`  Dangerous regex (/^(a+)+$/ with 25 a's + !): ${dangerousTime.toFixed(0)}ms`);
console.log(`  With 30 a's this would take minutes!\n`);

console.log(`  Prevention:`);
console.log(`    1. Avoid nested/ambiguous quantifiers: (a+)+, (a*)*, (a|a)*`);
console.log(`    2. Rewrite to remove ambiguity, e.g. /^a+$/ instead of /^(a+)+$/`);
console.log(`    3. Use re2 (linear-time regex) for untrusted patterns/input`);
console.log(`    4. Validate input length before regex matching`);
console.log(`    Note: JS regex has NO atomic groups (?>...) or possessive`);
console.log(`    quantifiers (a++) — those are PCRE/Java features that throw here.`);

// --- Demo 4: Sync vs async I/O impact ---

console.log("\n--- Sync vs async I/O ---\n");

// Simulate the impact of sync I/O on concurrent requests
async function simulateConcurrentRequests(ioFn, label) {
  const latencies = [];
  const start = performance.now();

  // Launch 10 "requests" concurrently
  const requests = Array.from({ length: 10 }, async (_, i) => {
    const reqStart = performance.now();
    await ioFn(i);
    return performance.now() - reqStart;
  });

  const results = await Promise.all(requests);
  const totalTime = performance.now() - start;

  return {
    label,
    totalTime: totalTime.toFixed(0),
    avgLatency: (results.reduce((a, b) => a + b, 0) / results.length).toFixed(0),
    maxLatency: Math.max(...results).toFixed(0),
  };
}

// Async I/O (non-blocking)
const asyncResult = await simulateConcurrentRequests(
  async () => await new Promise(r => setTimeout(r, 20)),
  "Async I/O (20ms each)"
);

// "Sync" I/O simulation (blocking)
const syncResult = await simulateConcurrentRequests(
  async () => {
    const end = performance.now() + 20;
    while (performance.now() < end) {} // Busy wait = sync-like
  },
  "Sync I/O (20ms each)"
);

console.log("  10 concurrent requests (each needs 20ms of I/O):\n");
console.log(`  ${"Mode".padEnd(25)} Total     Avg      Max`);
console.log(`  ${"-".repeat(55)}`);
console.log(`  ${asyncResult.label.padEnd(25)} ${asyncResult.totalTime.padStart(5)}ms  ${asyncResult.avgLatency.padStart(5)}ms  ${asyncResult.maxLatency.padStart(5)}ms`);
console.log(`  ${syncResult.label.padEnd(25)} ${syncResult.totalTime.padStart(5)}ms  ${syncResult.avgLatency.padStart(5)}ms  ${syncResult.maxLatency.padStart(5)}ms`);
console.log(`\n  Sync blocks requests sequentially. Async processes them concurrently.\n`);

// --- Demo 5: Optimization checklist ---

console.log("=== Event Loop Optimization Checklist ===\n");

const checklist = [
  ["Replace fs.*Sync with async", "readFileSync blocks the entire server"],
  ["Limit JSON body size", "JSON.parse(10MB) blocks for 50-200ms"],
  ["Audit regular expressions", "Nested quantifiers cause exponential backtracking"],
  ["Chunk CPU-bound loops", "setImmediate between chunks of 1-5ms"],
  ["Stream large responses", "Don't buffer 100MB in memory before sending"],
  ["Monitor event loop delay", "monitorEventLoopDelay + alert on p99 > 50ms"],
  ["Use worker threads for CPU", "Image processing, PDF generation, heavy crypto"],
  ["Cache expensive computations", "Don't recompute what hasn't changed"],
];

for (let i = 0; i < checklist.length; i++) {
  console.log(`  ${i + 1}. ${checklist[i][0]}`);
  console.log(`     → ${checklist[i][1]}`);
}
```

## Expected Output

```
=== Event Loop Optimization ===

--- Measuring event loop delay ---

  Idle (baseline):
    p50=~1.1ms  p99=~1.4ms  max=~2ms     min=~1ms
  Blocking (sync computation):
    p50=~1.1ms  p99=~2.5ms  max=~230ms   min=~0ms
  Non-blocking (chunked):
    p50=~1.3ms  p99=~3.8ms  max=~7ms     min=~0.7ms

--- JSON parsing: small vs large ---

  Small JSON: 39 bytes
    10K parses: <ms>
  Large JSON: ~1.4 MB
    1 parse: ~20ms ← blocks event loop!
  ...
```

Read the **`max`** column, not `p50`. The blocking run spends most of its samples
idle (so its p50 stays ~1ms, same as baseline) but freezes the loop for one
~230ms stretch — that single stall is the bug, and only `max`/high percentiles
reveal it. Chunking trades a slightly higher p50 for a `max` that stays in
single-digit milliseconds: the tail latency every request feels is now bounded.
(Exact numbers vary by machine; the *shape* — blocking `max` orders of magnitude
above idle, chunked `max` close to idle — is the point.)

## Challenge

1. Build a "safe JSON parser" middleware that rejects bodies over a size limit and parses large bodies in a worker thread instead of on the main thread
2. Implement a regex timeout: wrap `regex.test()` in a function that aborts if the regex takes longer than 10ms (hint: use a worker thread since regex is synchronous)
3. Measure the event loop delay of your own server under load using `autocannon` and `monitorEventLoopDelay`. At what request rate does p99 start degrading?

## Common Mistakes

- Using `readFileSync` in a request handler — blocks every concurrent request while the file is read
- Calling `JSON.stringify` on large objects in a hot path — it's synchronous and can take 50-200ms for large objects
- Using user-supplied regular expressions — enables ReDoS (Regular Expression Denial of Service)
- Not monitoring event loop delay in production — you won't know the loop is blocked until users complain


---

## Navigation

[< 002 — Memory Management](002-memory-management.md) | [004 — Load Testing >](004-load-testing.md)
