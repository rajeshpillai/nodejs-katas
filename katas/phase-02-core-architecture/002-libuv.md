---
id: libuv
phase: 2
phase_title: Node.js Core Architecture
sequence: 2
title: libuv and the Thread Pool
difficulty: intermediate
tags: [libuv, thread-pool, async-io, internals]
prerequisites: [event-loop-phases]
estimated_minutes: 12
---

## Concept

libuv is the C library that powers Node.js's async I/O. It provides:

- The **event loop** implementation
- **Async I/O** using OS-level mechanisms (epoll on Linux, kqueue on macOS, IOCP on Windows)
- A **thread pool** (default 4 threads) for operations that can't use async OS APIs

Not all async operations work the same way:

- **Network I/O** (TCP, UDP, HTTP) — uses OS async APIs directly, no thread pool needed. This is why Node.js handles thousands of connections efficiently.
- **File system operations** — uses the thread pool on most platforms, because POSIX doesn't guarantee async file I/O.
- **DNS lookups** (`dns.lookup()`) — uses the thread pool.
- **Crypto operations** — CPU-intensive, uses the thread pool.

The thread pool has a default size of 4 threads. If all 4 are busy, additional operations queue up.

## Key Insight

> Not all async is equal. Network I/O scales to thousands of connections because it uses OS-level async. File I/O and DNS are bottlenecked by the 4-thread pool. When your "async" code is slow, the thread pool might be saturated.

## Experiment

```js
import { pbkdf2 } from "crypto";

// Crypto operations use the libuv thread pool
// Default pool size is 4 — let's see what happens with 8 operations

const ITERATIONS = 100000;

console.log(`Thread pool size: ${process.env.UV_THREADPOOL_SIZE || 4} (default)`);
console.log(`Running 8 pbkdf2 operations...\n`);

const start = performance.now();

function runPbkdf2(id) {
  const opStart = performance.now();
  return new Promise((resolve) => {
    pbkdf2("password", "salt", ITERATIONS, 64, "sha512", () => {
      const elapsed = Math.round(performance.now() - opStart);
      console.log(`  Operation ${id} finished at ${elapsed}ms`);
      resolve();
    });
  });
}

// Fire 8 operations — only 4 can run concurrently (thread pool limit)
const operations = [];
for (let i = 1; i <= 8; i++) {
  operations.push(runPbkdf2(i));
}

await Promise.all(operations);

const total = Math.round(performance.now() - start);
console.log(`\nTotal: ${total}ms`);
console.log("Notice: first 4 finish together, then next 4.");
console.log("This is the thread pool bottleneck.");
```

## Expected Output

```
Thread pool size: 4 (default)
Running 8 pbkdf2 operations...

  Operation 1 finished at ~Xms
  Operation 2 finished at ~Xms
  Operation 3 finished at ~Xms
  Operation 4 finished at ~Xms
  Operation 5 finished at ~2Xms
  Operation 6 finished at ~2Xms
  Operation 7 finished at ~2Xms
  Operation 8 finished at ~2Xms

Total: ~2Xms
Notice: first 4 finish together, then next 4.
This is the thread pool bottleneck.
```

## Challenge

1. Set `UV_THREADPOOL_SIZE=8` before running. How does the output change? (Hint: set it in the env before Node starts)
2. Run only 4 operations instead of 8 — do they all finish at the same time?
3. Mix a file read (`fs.readFile`) with crypto operations. Does the file read get delayed when the thread pool is full?

## Deep Dive

You can increase the thread pool size with the `UV_THREADPOOL_SIZE` environment variable (max 1024). But more threads isn't always better — each thread consumes memory and causes context switches.

Operations that use the thread pool:
- `fs.*` (most file operations)
- `dns.lookup()` (but NOT `dns.resolve()` — that uses the async DNS resolver)
- `crypto.pbkdf2()`, `crypto.randomBytes()`, `crypto.scrypt()`
- `zlib.*` (compression)

Operations that do NOT use the thread pool:
- All network I/O (`net`, `http`, `https`, `tls`)
- `dns.resolve()` (uses c-ares, an async DNS library)
- Timers (`setTimeout`, `setInterval`)

## Common Mistakes

- Assuming all async operations are equally scalable — file I/O and crypto are limited by the thread pool
- Not increasing `UV_THREADPOOL_SIZE` in production when doing heavy file I/O or crypto
- Confusing `dns.lookup()` (thread pool, OS resolver) with `dns.resolve()` (async, c-ares) — they use different mechanisms
