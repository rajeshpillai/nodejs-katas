---
id: cpu-offloading-patterns
phase: 11
phase_title: Child Processes & Worker Threads
sequence: 5
title: CPU Offloading Patterns
difficulty: intermediate
tags: [worker_threads, child_process, cpu-bound, offloading, event-loop]
prerequisites: [worker-threads]
estimated_minutes: 15
---

## Concept

The golden rule of Node.js: **never block the event loop**. Any CPU-intensive operation that takes more than a few milliseconds should be offloaded. There are several strategies:

**1. Worker threads** — for trusted, CPU-bound JavaScript:
```js
const worker = new Worker('./hash-worker.js');
worker.postMessage({ data: largeFile });
```

**2. Child processes** — for isolation or external tools:
```js
const child = spawn('ffmpeg', ['-i', input, '-o', output]);
```

**3. Native addons (N-API)** — for maximum performance:
```js
// C/C++ addon compiled to .node file
const { compress } = require('./native-addon.node');
```

**4. Chunking** — break work into small pieces, yield between chunks:
```js
async function processChunked(items, chunkSize = 100) {
  for (let i = 0; i < items.length; i += chunkSize) {
    processChunk(items.slice(i, i + chunkSize));
    await new Promise(resolve => setImmediate(resolve)); // Yield to event loop
  }
}
```

**5. libuv thread pool** — Node.js already offloads some operations:
- `crypto.pbkdf2`, `crypto.scrypt` — CPU-heavy crypto
- `zlib.gzip`, `zlib.brotliCompress` — compression
- DNS lookups (`dns.lookup`)
- File system operations

## Key Insight

> The event loop can process thousands of I/O callbacks per second, but a single 100ms CPU task blocks ALL of them. In a web server handling 1000 req/sec, one blocking computation causes a 100ms latency spike for every request, not just the one doing the work. Offloading CPU work ensures the event loop stays responsive for all connections.

## Experiment

```js
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  const { task, data } = workerData;

  if (task === "hash-passwords") {
    const { scrypt } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const scryptAsync = promisify(scrypt);

    const results = [];
    for (const password of data) {
      const salt = Buffer.alloc(16, "salt"); // Fixed salt for demo
      const hash = await scryptAsync(password, salt, 64, { N: 1024, r: 8, p: 1 });
      results.push(hash.toString("hex").slice(0, 16));
    }
    parentPort.postMessage({ results });
    process.exit(0);
  }

  if (task === "analyze") {
    const start = performance.now();
    // Simulate CPU-intensive analysis
    let sum = 0;
    for (const item of data) {
      // Intentionally CPU-bound work
      for (let i = 0; i < 1000; i++) {
        sum += Math.sin(item * i) * Math.cos(item * i);
      }
    }
    parentPort.postMessage({ result: sum, elapsed: performance.now() - start });
    process.exit(0);
  }
}

// --- Main thread code ---

console.log("=== CPU Offloading Patterns ===\n");

function runInWorker(task, data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { task, data },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
  });
}

// --- Demo 1: Event loop blocking demonstration ---

console.log("--- Event loop blocking demonstration ---\n");

function cpuBoundWork(iterations) {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sin(i) * Math.cos(i);
  }
  return sum;
}

// Measure event loop latency during CPU work
async function measureEventLoopLatency(label, workFn) {
  const latencies = [];
  let measuring = true;

  // Measure how long setImmediate callbacks are delayed
  function measureTick() {
    const start = performance.now();
    setImmediate(() => {
      if (measuring) {
        latencies.push(performance.now() - start);
        measureTick();
      }
    });
  }
  measureTick();

  // Wait a tick to start measuring
  await new Promise(r => setImmediate(r));

  // Do the work
  const workStart = performance.now();
  await workFn();
  const workElapsed = performance.now() - workStart;

  measuring = false;
  await new Promise(r => setImmediate(r));

  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  console.log(`  ${label}:`);
  console.log(`    Work time: ${workElapsed.toFixed(0)}ms`);
  console.log(`    Event loop ticks: ${latencies.length}`);
  console.log(`    Avg tick latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`    Max tick latency: ${maxLatency.toFixed(2)}ms`);

  return { workElapsed, avgLatency, maxLatency, ticks: latencies.length };
}

// Blocking: CPU work on main thread
const blocking = await measureEventLoopLatency("Blocking (main thread)", () => {
  cpuBoundWork(5000000);
  return Promise.resolve();
});

// Non-blocking: CPU work in worker thread
const nonBlocking = await measureEventLoopLatency("Non-blocking (worker thread)", async () => {
  await runInWorker("analyze", Array.from({ length: 5000 }, (_, i) => i));
});

console.log(`\n  Blocking max latency: ${blocking.maxLatency.toFixed(0)}ms`);
console.log(`  Worker max latency:   ${nonBlocking.maxLatency.toFixed(0)}ms`);
console.log(`  Event loop ${blocking.maxLatency > 10 ? "WAS" : "was not"} blocked in the first case\n`);

// --- Demo 2: Chunking pattern ---

console.log("--- Chunking pattern (yield to event loop) ---\n");

async function processChunked(items, processFn, chunkSize = 1000) {
  const results = [];
  let processed = 0;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    for (const item of chunk) {
      results.push(processFn(item));
    }
    processed += chunk.length;

    // Yield to the event loop between chunks
    await new Promise(resolve => setImmediate(resolve));
  }

  return { results, processed };
}

const chunkedItems = Array.from({ length: 10000 }, (_, i) => i);
const chunkedStart = performance.now();

let chunkedTicks = 0;
let chunkedMeasuring = true;
function countTicks() {
  if (chunkedMeasuring) {
    chunkedTicks++;
    setImmediate(countTicks);
  }
}
setImmediate(countTicks);

const chunkedResult = await processChunked(
  chunkedItems,
  x => Math.sin(x) * Math.cos(x),
  1000
);

chunkedMeasuring = false;
await new Promise(r => setImmediate(r));

const chunkedElapsed = performance.now() - chunkedStart;

console.log(`  Processed ${chunkedResult.processed} items in ${chunkedElapsed.toFixed(0)}ms`);
console.log(`  Event loop ticks during processing: ${chunkedTicks}`);
console.log(`  Chunk size: 1000 items per tick\n`);

// --- Demo 3: Worker pool for request handling ---

console.log("--- Simulated request handling with worker pool ---\n");

// Simulate 10 concurrent API requests, some CPU-heavy
const requests = [
  { id: 1, type: "io", duration: 20 },    // I/O bound — handle normally
  { id: 2, type: "cpu", work: 2000 },      // CPU bound — offload
  { id: 3, type: "io", duration: 10 },
  { id: 4, type: "cpu", work: 3000 },
  { id: 5, type: "io", duration: 15 },
  { id: 6, type: "io", duration: 25 },
  { id: 7, type: "cpu", work: 1000 },
  { id: 8, type: "io", duration: 5 },
  { id: 9, type: "io", duration: 30 },
  { id: 10, type: "cpu", work: 1500 },
];

const reqStart = performance.now();

const reqResults = await Promise.all(
  requests.map(async (req) => {
    const start = performance.now();
    if (req.type === "io") {
      // Simulated I/O — non-blocking
      await new Promise(r => setTimeout(r, req.duration));
    } else {
      // CPU work — offload to worker
      await runInWorker("analyze", Array.from({ length: req.work }, (_, i) => i));
    }
    return { ...req, elapsed: performance.now() - start };
  })
);

const reqElapsed = performance.now() - reqStart;

console.log("  Request results:");
for (const r of reqResults.sort((a, b) => a.id - b.id)) {
  const type = r.type === "cpu" ? "CPU→worker" : "I/O       ";
  console.log(`    Req ${String(r.id).padStart(2)}: ${type}  ${r.elapsed.toFixed(0).padStart(4)}ms`);
}
console.log(`\n  Total: ${reqElapsed.toFixed(0)}ms (concurrent, not sequential)`);
console.log(`  I/O requests were NOT blocked by CPU work\n`);

// --- Demo 4: Decision tree ---

console.log("=== CPU Offloading Decision Tree ===\n");

console.log(`  Is the work CPU-bound?
  ├─ No → Use async/await (I/O is already non-blocking)
  └─ Yes → How long does it take?
      ├─ < 1ms → Run inline (overhead of offloading > benefit)
      ├─ 1-10ms → Consider chunking with setImmediate
      ├─ 10-100ms → Worker thread (fast startup, shared process)
      └─ > 100ms → Worker thread pool or child process
          ├─ Trusted code? → Worker thread pool
          └─ Untrusted? → Child process (crash isolation)
`);

console.log("  Common CPU-bound operations in Node.js:");
const ops = [
  ["JSON.parse (large)", "~5-50ms", "Worker or streaming parser"],
  ["Image resize", "~50-500ms", "Worker + sharp (native)"],
  ["PDF generation", "~100-1000ms", "Worker or child process"],
  ["Crypto (scrypt)", "~50-200ms", "Already uses libuv pool"],
  ["Compression", "~10-100ms", "Already uses libuv pool"],
  ["Template rendering", "~1-10ms", "Usually fine inline"],
];

for (const [op, time, strategy] of ops) {
  console.log(`    ${op.padEnd(22)} ${time.padEnd(14)} ${strategy}`);
}
```

## Expected Output

```
=== CPU Offloading Patterns ===

--- Event loop blocking demonstration ---

  Blocking (main thread):
    Work time: ~100ms
    Event loop ticks: 0-1
    Max tick latency: ~100ms (BLOCKED!)

  Non-blocking (worker thread):
    Work time: ~100ms
    Event loop ticks: >10
    Max tick latency: <5ms (responsive)

--- Chunking pattern (yield to event loop) ---

  Processed 10000 items in <ms>
  Event loop ticks during processing: ~10
  ...
```

## Challenge

1. Build an event loop monitor that logs a warning whenever a tick takes longer than 50ms — use `monitorEventLoopDelay` from `perf_hooks` or measure manually with `setImmediate`
2. Implement a "compute budget" middleware: for each request, track how much CPU time has been used and reject requests that exceed a threshold
3. Profile a real Node.js server under load: use `--prof` to generate a V8 CPU profile and identify which functions are blocking the event loop

## Deep Dive

The Node.js event loop processes I/O callbacks, timers, and microtasks in a continuous loop. When CPU-bound work runs on the main thread:

```
Normal:    [I/O] [I/O] [I/O] [I/O] [I/O] [I/O]  (1ms each)
Blocked:   [I/O] [===CPU 100ms===] [I/O] [I/O]
Offloaded: [I/O] [I/O] [I/O] [I/O] [I/O] [I/O]  (worker handles CPU)
```

All I/O callbacks are delayed by the full duration of the CPU work. With 1000 req/sec, a 100ms block means 100 requests experience delayed processing.

## Common Mistakes

- Blocking the event loop with JSON.parse of large payloads — use streaming parsers or workers for bodies > 1MB
- Using `setImmediate` chunking with too-large chunks — each chunk still blocks; keep chunks under ~5ms of CPU time
- Over-offloading I/O-bound work to workers — workers add overhead; async I/O is already non-blocking
- Not monitoring event loop delay in production — use `monitorEventLoopDelay()` to detect blocking before users notice
