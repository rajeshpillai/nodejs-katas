---
id: profiling
phase: 13
phase_title: Performance & Scaling
sequence: 1
title: Profiling Node.js Applications
difficulty: advanced
tags: [profiling, cpu, flamegraph, v8, performance]
prerequisites: [graceful-restart]
estimated_minutes: 15
---

## Concept

Before optimizing, you must **measure**. Guessing where performance bottlenecks are is almost always wrong. Node.js provides several profiling tools:

**1. `--prof` (V8 CPU profile):**
```bash
node --prof app.js
# Generates isolate-*.log
node --prof-process isolate-*.log > profile.txt
```

**2. `--inspect` (Chrome DevTools):**
```bash
node --inspect app.js
# Open chrome://inspect → CPU Profiler
```

**3. `perf_hooks` (programmatic):**
```js
import { performance, PerformanceObserver } from 'node:perf_hooks';

performance.mark('start');
doWork();
performance.mark('end');
performance.measure('work', 'start', 'end');
```

**4. `console.time` / `console.timeEnd` (quick benchmarks):**
```js
console.time('query');
await db.query('SELECT ...');
console.timeEnd('query'); // query: 12.345ms
```

**What to profile:**
- CPU time — which functions take the most time?
- Event loop delay — is the loop being blocked?
- Memory allocation — where are objects being created?
- I/O wait — how long are you waiting for network/disk?

## Key Insight

> The most common performance mistake in Node.js isn't slow I/O — it's accidentally blocking the event loop with synchronous work. A single `JSON.parse()` of a 10MB payload or a `fs.readFileSync()` of a large file blocks ALL concurrent requests. Profiling reveals these hidden bottlenecks that you'd never find by code review alone. Always profile under realistic load, not with a single request.

## Experiment

```js
import { performance, PerformanceObserver } from "node:perf_hooks";

console.log("=== Profiling Node.js Applications ===\n");

// --- Demo 1: performance.now() for micro-benchmarks ---

console.log("--- Micro-benchmarking with performance.now() ---\n");

function benchmark(name, fn, iterations = 10000) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const opsPerSec = Math.round(iterations / (elapsed / 1000));
  const nsPerOp = Math.round((elapsed / iterations) * 1e6);

  return { name, elapsed, iterations, opsPerSec, nsPerOp };
}

const testObj = { name: "Alice", age: 30, email: "alice@example.com", roles: ["admin", "user"] };
const testJson = JSON.stringify(testObj);

const benchmarks = [
  benchmark("JSON.stringify (small)", () => JSON.stringify(testObj)),
  benchmark("JSON.parse (small)", () => JSON.parse(testJson)),
  benchmark("Object.assign", () => Object.assign({}, testObj)),
  benchmark("Spread operator", () => ({ ...testObj })),
  benchmark("Array.from (100)", () => Array.from({ length: 100 }, (_, i) => i)),
  benchmark("Map lookup", () => { const m = new Map([["a", 1]]); m.get("a"); }),
  benchmark("Object lookup", () => { const o = { a: 1 }; o.a; }),
];

console.log("  Operation".padEnd(30) + "ops/sec".padStart(12) + "ns/op".padStart(10));
console.log("  " + "─".repeat(48));
for (const b of benchmarks) {
  console.log(`  ${b.name.padEnd(28)} ${b.opsPerSec.toLocaleString().padStart(12)} ${String(b.nsPerOp).padStart(10)}`);
}

// --- Demo 2: performance.mark() and measure() ---

console.log("\n--- performance.mark() and measure() ---\n");

// Set up observer
const measurements = [];
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    measurements.push({
      name: entry.name,
      duration: entry.duration,
    });
  }
});
obs.observe({ entryTypes: ["measure"] });

// Simulate a request lifecycle
performance.mark("request-start");

// Step 1: Parse body
performance.mark("parse-start");
const body = JSON.parse('{"user":"alice","action":"login"}');
await new Promise(r => setTimeout(r, 2)); // Simulate I/O
performance.mark("parse-end");
performance.measure("parse-body", "parse-start", "parse-end");

// Step 2: Database query
performance.mark("db-start");
await new Promise(r => setTimeout(r, 15)); // Simulate DB
performance.mark("db-end");
performance.measure("db-query", "db-start", "db-end");

// Step 3: Serialize response
performance.mark("serialize-start");
const response = JSON.stringify({ status: "ok", user: body.user });
performance.mark("serialize-end");
performance.measure("serialize", "serialize-start", "serialize-end");

performance.mark("request-end");
performance.measure("total-request", "request-start", "request-end");

// Wait for observer
await new Promise(r => setTimeout(r, 10));

console.log("  Request lifecycle breakdown:\n");
for (const m of measurements) {
  const bar = "█".repeat(Math.max(1, Math.round(m.duration / 2)));
  console.log(`    ${m.name.padEnd(16)} ${m.duration.toFixed(2).padStart(8)}ms ${bar}`);
}

obs.disconnect();

// --- Demo 3: Finding hot spots ---

console.log("\n--- Finding CPU hot spots ---\n");

function simulateApp() {
  const data = [];

  // Hot spot 1: Inefficient search
  for (let i = 0; i < 1000; i++) {
    data.push({ id: i, name: `user_${i}`, score: Math.random() * 100 });
  }

  // Hot spot 2: Repeated sorting
  let totalSorted = 0;
  for (let i = 0; i < 50; i++) {
    const sorted = [...data].sort((a, b) => b.score - a.score);
    totalSorted += sorted[0].score;
  }

  // Hot spot 3: String concatenation in loop
  let html = "";
  for (const item of data) {
    html += `<div class="item"><span>${item.name}</span><span>${item.score.toFixed(2)}</span></div>`;
  }

  return { dataLen: data.length, totalSorted, htmlLen: html.length };
}

// Profile the function
const profileStart = performance.now();
const profileResult = simulateApp();
const profileElapsed = performance.now() - profileStart;

console.log(`  simulateApp() took ${profileElapsed.toFixed(2)}ms`);
console.log(`  Result: ${JSON.stringify(profileResult)}\n`);

// Optimized version
function simulateAppOptimized() {
  const data = [];

  for (let i = 0; i < 1000; i++) {
    data.push({ id: i, name: `user_${i}`, score: Math.random() * 100 });
  }

  // Fix 1: Sort once, not 50 times
  data.sort((a, b) => b.score - a.score);
  const totalSorted = data[0].score * 50;

  // Fix 2: Use array join instead of string concatenation
  const parts = data.map(item =>
    `<div class="item"><span>${item.name}</span><span>${item.score.toFixed(2)}</span></div>`
  );
  const html = parts.join("");

  return { dataLen: data.length, totalSorted, htmlLen: html.length };
}

const optStart = performance.now();
const optResult = simulateAppOptimized();
const optElapsed = performance.now() - optStart;

console.log(`  simulateAppOptimized() took ${optElapsed.toFixed(2)}ms`);
console.log(`  Speedup: ${(profileElapsed / optElapsed).toFixed(1)}x\n`);

// --- Demo 4: Event loop monitoring ---

console.log("--- Event loop delay monitoring ---\n");

async function measureEventLoopDelay(durationMs = 200) {
  const delays = [];
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    const tickStart = performance.now();
    await new Promise(r => setImmediate(r));
    delays.push(performance.now() - tickStart);
  }

  delays.sort((a, b) => a - b);
  return {
    samples: delays.length,
    min: delays[0]?.toFixed(3),
    avg: (delays.reduce((a, b) => a + b, 0) / delays.length).toFixed(3),
    p50: delays[Math.floor(delays.length * 0.5)]?.toFixed(3),
    p99: delays[Math.floor(delays.length * 0.99)]?.toFixed(3),
    max: delays[delays.length - 1]?.toFixed(3),
  };
}

// Normal event loop
const normalDelay = await measureEventLoopDelay();
console.log(`  Normal event loop:`);
console.log(`    samples=${normalDelay.samples} avg=${normalDelay.avg}ms p99=${normalDelay.p99}ms max=${normalDelay.max}ms`);

// Blocked event loop (simulate with sync work)
const blockedPromise = measureEventLoopDelay();
// Inject some blocking work
let blockSum = 0;
for (let i = 0; i < 1e6; i++) blockSum += Math.sin(i);
const blockedDelay = await blockedPromise;
console.log(`\n  After blocking work:`);
console.log(`    samples=${blockedDelay.samples} avg=${blockedDelay.avg}ms p99=${blockedDelay.p99}ms max=${blockedDelay.max}ms`);

// --- Demo 5: Profiling tools reference ---

console.log("\n=== Profiling Tools Reference ===\n");

const tools = [
  ["Tool", "What it measures", "How to use"],
  ["--prof", "CPU time per function", "node --prof app.js → --prof-process"],
  ["--inspect", "CPU, memory, timeline", "node --inspect → chrome://inspect"],
  ["--heap-prof", "Memory allocation", "node --heap-prof app.js"],
  ["perf_hooks", "Custom timing marks", "performance.mark/measure in code"],
  ["clinic.js", "Event loop, I/O, memory", "npx clinic doctor -- node app.js"],
  ["0x", "Flamegraph generation", "npx 0x app.js"],
  ["autocannon", "HTTP load testing", "npx autocannon http://localhost:6001"],
];

for (const [tool, what, how] of tools) {
  console.log(`  ${tool.padEnd(14)} ${what.padEnd(26)} ${how}`);
}
```

## Expected Output

```
=== Profiling Node.js Applications ===

--- Micro-benchmarking with performance.now() ---

  Operation                        ops/sec     ns/op
  ────────────────────────────────────────────────────
  JSON.stringify (small)          <varies>   <varies>
  JSON.parse (small)              <varies>   <varies>
  ...

--- performance.mark() and measure() ---

  Request lifecycle breakdown:

    parse-body           2.xx ms █
    db-query            15.xx ms ████████
    serialize            0.xx ms █
    total-request       18.xx ms █████████
  ...
```

## Challenge

1. Profile a JSON API endpoint that reads from a file, parses JSON, filters results, and returns a response. Use `performance.mark/measure` to find which step is slowest
2. Set up `--inspect` and use Chrome DevTools to record a CPU profile of your server under load. Generate a flamegraph and identify the hot functions
3. Build an event loop delay monitor middleware that adds an `X-Event-Loop-Delay` header to every response showing the current event loop latency

## Common Mistakes

- Optimizing without profiling — you'll optimize the wrong thing. Measure first, always
- Benchmarking with a single request — real performance issues emerge under concurrent load
- Ignoring p99 latency — the 1% worst-case matters more than the average for user experience
- Using `Date.now()` for micro-benchmarks — it has millisecond resolution. Use `performance.now()` for sub-millisecond precision
