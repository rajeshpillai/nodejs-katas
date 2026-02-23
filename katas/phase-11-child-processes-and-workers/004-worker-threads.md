---
id: worker-threads
phase: 11
phase_title: Child Processes & Worker Threads
sequence: 4
title: Worker Threads
difficulty: intermediate
tags: [worker_threads, threads, shared-memory, parallelism, cpu-bound]
prerequisites: [fork-and-ipc]
estimated_minutes: 15
---

## Concept

Worker threads run JavaScript in **parallel threads** within the same process. Unlike child processes, threads share the process's memory space and can transfer data without serialization overhead.

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { numbers: [1, 2, 3, 4, 5] }
  });
  worker.on('message', result => console.log('Sum:', result));
} else {
  const sum = workerData.numbers.reduce((a, b) => a + b, 0);
  parentPort.postMessage(sum);
}
```

**Worker threads vs child processes:**

| Feature | Worker Thread | Child Process |
|---------|--------------|---------------|
| Memory | Shared process memory | Separate memory |
| Startup | ~5ms | ~30ms |
| Communication | postMessage (structured clone) | IPC (JSON) |
| Shared memory | SharedArrayBuffer | No |
| Crash isolation | Thread crash kills process | Child crash is isolated |
| Use case | CPU-bound work, shared state | Isolation, untrusted code |

**Data transfer mechanisms:**
1. **Structured clone** — default, copies data (like JSON but supports more types)
2. **Transfer** — moves ownership of ArrayBuffers (zero-copy, original becomes empty)
3. **SharedArrayBuffer** — true shared memory (requires atomics for synchronization)

## Key Insight

> Worker threads share the same process and can share memory via SharedArrayBuffer — but this is both their strength and their danger. Shared memory requires careful synchronization with Atomics to avoid data races. For most tasks, structured cloning (postMessage) is simpler and fast enough. Reserve SharedArrayBuffer for performance-critical scenarios where you've measured that message passing is the bottleneck.

## Experiment

```js
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  // --- Worker code ---
  const { task, data } = workerData;

  switch (task) {
    case "sum": {
      const result = data.reduce((a, b) => a + b, 0);
      parentPort.postMessage({ task, result });
      break;
    }
    case "fibonacci": {
      function fib(n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
      }
      const start = performance.now();
      const result = fib(data);
      parentPort.postMessage({ task, result, elapsed: performance.now() - start });
      break;
    }
    case "sort": {
      const start = performance.now();
      const sorted = [...data].sort((a, b) => a - b);
      parentPort.postMessage({ task, result: sorted.length, elapsed: performance.now() - start });
      break;
    }
    default:
      parentPort.postMessage({ error: `Unknown task: ${task}` });
  }
  process.exit(0);
}

// --- Main thread code ---

console.log("=== Worker Threads ===\n");

// Helper to run a task in a worker
function runWorker(task, data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { task, data },
    });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", code => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

// --- Demo 1: Basic worker thread ---

console.log("--- Basic worker thread ---\n");

const sumResult = await runWorker("sum", Array.from({ length: 1000 }, (_, i) => i + 1));
console.log(`  Sum of 1..1000 = ${sumResult.result}`);
console.log(`  (expected: ${(1000 * 1001) / 2})\n`);

// --- Demo 2: CPU-bound work doesn't block main thread ---

console.log("--- CPU-bound work: main thread stays responsive ---\n");

const mainStart = performance.now();
let ticks = 0;
const tickInterval = setInterval(() => ticks++, 5);

// Run fibonacci in a worker thread
const fibResult = await runWorker("fibonacci", 38);

clearInterval(tickInterval);
const mainElapsed = performance.now() - mainStart;

console.log(`  fib(38) = ${fibResult.result}`);
console.log(`  Worker time: ${fibResult.elapsed.toFixed(0)}ms`);
console.log(`  Main thread ticks: ${ticks} (stayed responsive!)`);
console.log(`  Total wall time: ${mainElapsed.toFixed(0)}ms\n`);

// --- Demo 3: Parallel workers ---

console.log("--- Parallel workers ---\n");

// Run 4 fibonacci computations in parallel
const parallelStart = performance.now();

const parallelResults = await Promise.all([
  runWorker("fibonacci", 35),
  runWorker("fibonacci", 36),
  runWorker("fibonacci", 37),
  runWorker("fibonacci", 35),
]);

const parallelElapsed = performance.now() - parallelStart;

console.log("  4 fibonacci computations in parallel:");
for (const r of parallelResults) {
  console.log(`    fib(${r.result > 14930351 ? 37 : r.result > 9227465 ? 36 : 35}) = ${r.result} (${r.elapsed.toFixed(0)}ms)`);
}
console.log(`  Total wall time: ${parallelElapsed.toFixed(0)}ms`);

// Sequential comparison
const seqStart = performance.now();
for (const n of [35, 36, 37, 35]) {
  await runWorker("fibonacci", n);
}
const seqElapsed = performance.now() - seqStart;

console.log(`  Sequential: ${seqElapsed.toFixed(0)}ms`);
console.log(`  Speedup: ${(seqElapsed / parallelElapsed).toFixed(1)}x\n`);

// --- Demo 4: Data transfer ---

console.log("--- Data transfer mechanisms ---\n");

// Structured clone (copy)
const largeArray = new Float64Array(100000);
for (let i = 0; i < largeArray.length; i++) largeArray[i] = Math.random();

const cloneStart = performance.now();
const sortResult = await runWorker("sort", Array.from(largeArray));
const cloneTime = performance.now() - cloneStart;

console.log(`  Structured clone: 100K floats`);
console.log(`    Worker sorted ${sortResult.result} items in ${sortResult.elapsed.toFixed(0)}ms`);
console.log(`    Total (clone + sort): ${cloneTime.toFixed(0)}ms\n`);

// Transfer (zero-copy for ArrayBuffers)
console.log("  ArrayBuffer transfer (zero-copy):");
const buffer = new ArrayBuffer(1024 * 1024); // 1MB
const view = new Uint8Array(buffer);
view[0] = 42;
console.log(`    Before transfer: buffer.byteLength = ${buffer.byteLength}`);
console.log(`    (After transfer, original buffer becomes detached — byteLength = 0)\n`);

// SharedArrayBuffer concept
console.log("  SharedArrayBuffer (true shared memory):");
console.log(`    const shared = new SharedArrayBuffer(1024);`);
console.log(`    // Both main thread and worker see the same memory`);
console.log(`    // Use Atomics.add/load/store for thread-safe access`);

// --- Demo 5: Worker pool pattern ---

console.log("\n--- Worker pool pattern ---\n");

class WorkerPool {
  constructor(size, workerUrl) {
    this.workers = [];
    this.queue = [];
    this.active = 0;
    this.maxSize = size;
    this.workerUrl = workerUrl;
    this.completed = 0;
  }

  async execute(task, data) {
    if (this.active >= this.maxSize) {
      // Wait for a slot
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.active++;

    try {
      const result = await runWorker(task, data);
      this.completed++;
      return result;
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }

  getStatus() {
    return {
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
    };
  }
}

const pool = new WorkerPool(4, import.meta.url);

// Submit 8 tasks to a pool of 4 workers
const poolStart = performance.now();
const poolResults = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    pool.execute("fibonacci", 33 + (i % 3))
  )
);
const poolElapsed = performance.now() - poolStart;

console.log(`  Pool size: 4 workers, 8 tasks`);
console.log(`  Completed in: ${poolElapsed.toFixed(0)}ms`);
console.log(`  Status: ${JSON.stringify(pool.getStatus())}`);

// --- Demo 6: When to use what ---

console.log("\n=== Decision Guide ===\n");

const guide = [
  ["Task Type", "Solution", "Why"],
  ["CPU-bound (trusted)", "Worker thread", "Fast startup, can share memory"],
  ["CPU-bound (untrusted)", "Child process (fork)", "Crash isolation, memory isolation"],
  ["External command", "spawn/execFile", "Not a Node.js task"],
  ["I/O-bound", "async/await", "Threads add overhead without benefit"],
  ["Shared state needed", "Worker + SharedArrayBuffer", "Zero-copy shared memory"],
];

for (const [task, solution, why] of guide) {
  console.log(`  ${task.padEnd(24)} → ${solution.padEnd(30)} ${why}`);
}
```

## Expected Output

```
=== Worker Threads ===

--- Basic worker thread ---

  Sum of 1..1000 = 500500
  (expected: 500500)

--- CPU-bound work: main thread stays responsive ---

  fib(38) = 39088169
  Worker time: ~500ms
  Main thread ticks: >50 (stayed responsive!)

--- Parallel workers ---

  4 fibonacci computations in parallel:
    fib(35) = 9227465 (...)
    ...
  Total wall time: <ms>
  Sequential: <ms>
  Speedup: ~2-4x
  ...
```

## Challenge

1. Build a production-ready `WorkerPool` class that pre-spawns workers, keeps them alive between tasks, and handles worker crashes with automatic restart
2. Implement a parallel map function: `parallelMap(array, fn, concurrency)` that splits an array across worker threads and merges results
3. Use SharedArrayBuffer and Atomics to build a thread-safe counter that multiple workers can increment concurrently without data races

## Common Mistakes

- Creating a new worker per task — worker startup has overhead. Use a worker pool for repeated tasks
- Using workers for I/O-bound tasks — async/await is better; workers add complexity without benefit for I/O
- Forgetting that worker thread crash kills the whole process — unlike child processes, threads aren't isolated
- Sharing mutable state without Atomics — concurrent writes to SharedArrayBuffer cause data races
