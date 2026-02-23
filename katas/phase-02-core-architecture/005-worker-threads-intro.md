---
id: worker-threads-intro
phase: 2
phase_title: Node.js Core Architecture
sequence: 5
title: Worker Threads (Introduction)
difficulty: intermediate
tags: [worker-threads, cpu-bound, parallelism, concurrency]
prerequisites: [libuv, io-callbacks]
estimated_minutes: 15
---

## Concept

Node.js is single-threaded for JavaScript execution. But what about CPU-intensive work like image processing, encryption, or data transformation?

**Worker threads** let you run JavaScript in parallel on separate threads. Each worker has its own V8 instance, its own event loop, and its own memory. Workers communicate with the main thread by passing messages.

Key differences from the main thread:
- Workers can't access the DOM (irrelevant in Node.js)
- Workers can't share memory directly (unless using `SharedArrayBuffer`)
- Workers communicate via structured cloning (data is copied, not shared)
- Creating a worker has overhead (~30-50ms) — don't spawn one for trivial work

Workers are for **CPU-bound** work. For I/O-bound work (network, files), the event loop and async I/O are more efficient.

## Key Insight

> Worker threads give Node.js true parallelism for CPU-bound work. But they're not lightweight — each worker is a full V8 instance. Use them for heavy computation, not for I/O or simple tasks.

## Experiment

```js
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

if (isMainThread) {
  // === Main thread ===
  console.log("Main thread: starting\n");

  // CPU-bound work on the main thread (blocks everything)
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }

  // Run on main thread — blocks
  const mainStart = performance.now();
  const mainResult = fibonacci(35);
  const mainTime = Math.round(performance.now() - mainStart);
  console.log(`Main thread: fib(35) = ${mainResult} in ${mainTime}ms (blocked!)\n`);

  // Run on worker thread — doesn't block main
  const workerStart = performance.now();

  const worker = new Worker(new URL(import.meta.url), {
    workerData: { n: 35 },
  });

  // Main thread is free while worker computes
  console.log("Main thread: worker started, I'm free to do other work!");

  let mainWorkDone = false;
  const checkInterval = setInterval(() => {
    if (!mainWorkDone) {
      console.log("Main thread: ...doing other work while worker computes...");
      mainWorkDone = true;
    }
  }, 10);

  worker.on("message", (result) => {
    clearInterval(checkInterval);
    const workerTime = Math.round(performance.now() - workerStart);
    console.log(`\nWorker result: fib(35) = ${result} in ${workerTime}ms`);
    console.log("Main thread was NOT blocked during worker computation.");
  });

  worker.on("error", (err) => {
    clearInterval(checkInterval);
    console.error("Worker error:", err);
  });

} else {
  // === Worker thread ===
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }

  const result = fibonacci(workerData.n);
  parentPort.postMessage(result);
}
```

## Expected Output

```
Main thread: starting

Main thread: fib(35) = 9227465 in ~Xms (blocked!)

Main thread: worker started, I'm free to do other work!
Main thread: ...doing other work while worker computes...

Worker result: fib(35) = 9227465 in ~Xms
Main thread was NOT blocked during worker computation.
```

## Challenge

1. Spawn 4 workers, each computing `fibonacci(35)`. How does the total time compare to running them sequentially on the main thread?
2. Pass a large array to a worker and back. Measure how long the message passing takes for 1MB, 10MB, 100MB of data.
3. Use `SharedArrayBuffer` and `Atomics` to share memory between the main thread and a worker without copying.

## Deep Dive

When to use worker threads vs other approaches:

| Approach | Use for | Example |
|----------|---------|---------|
| **Async I/O** | Network, files, DB | HTTP server, file processing |
| **Worker threads** | CPU-heavy JS | Image resize, data transform |
| **Child process** | External programs | Running ffmpeg, shell commands |
| **C++ addon** | Max performance | Native crypto, ML inference |

Workers share the same process but have separate V8 heaps. `SharedArrayBuffer` is the only way to share memory without copying — useful for large datasets but requires careful synchronization with `Atomics`.

## Common Mistakes

- Spawning workers for I/O-bound work — async I/O is faster and lighter for network/file operations
- Creating a new worker per request — worker creation has overhead. Use a worker pool instead
- Assuming workers share variables with the main thread — they don't. Data is cloned when sent via `postMessage`
- Not handling worker errors — unhandled errors in a worker silently fail unless you listen for the `'error'` event
