---
id: io-callbacks
phase: 2
phase_title: Node.js Core Architecture
sequence: 4
title: I/O Callbacks and the Poll Phase
difficulty: intermediate
tags: [io, callbacks, poll-phase, event-loop]
prerequisites: [event-loop-phases, libuv]
estimated_minutes: 12
---

## Concept

The **poll phase** is where Node.js spends most of its time. It does two things:

1. Calculates how long it should block and wait for I/O
2. Processes events in the poll queue (I/O completion callbacks)

When an I/O operation completes (file read finishes, data arrives on a socket, DNS resolves), its callback is queued in the poll phase. The event loop processes these callbacks one by one.

If the poll queue is empty, Node.js either:
- **Waits** for I/O events (if timers aren't due yet)
- **Moves on** to the check phase if `setImmediate` callbacks are queued
- **Wraps around** to the timer phase if timers have expired

This is the beating heart of Node.js — the poll phase is where your server actually does work.

## Key Insight

> The poll phase is Node.js's default resting state. When there's nothing to do, Node.js parks here waiting for I/O events. It only leaves when timers expire or `setImmediate` callbacks are queued. This is what makes Node.js efficient — it sleeps instead of busy-waiting.

## Experiment

```js
import { readFile, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const tmpFile = join(tmpdir(), `io-test-${Date.now()}.txt`);

// Write a test file
await writeFile(tmpFile, "Hello from I/O callback kata!\n".repeat(100));

console.log("=== I/O callback ordering ===\n");

// Demonstrate that I/O callbacks run in the poll phase
const start = performance.now();

// Schedule a timer (runs in timers phase)
setTimeout(() => {
  const t = Math.round(performance.now() - start);
  console.log(`  3. setTimeout at ${t}ms (timers phase)`);
}, 0);

// Schedule setImmediate (runs in check phase, after poll)
setImmediate(() => {
  const t = Math.round(performance.now() - start);
  console.log(`  2. setImmediate at ${t}ms (check phase)`);
});

// Start a file read (callback runs in poll phase)
const data = await readFile(tmpFile, "utf-8");
const t = Math.round(performance.now() - start);
console.log(`  1. File read completed at ${t}ms (${data.length} bytes)`);

// Multiple I/O operations — they interleave with the event loop
console.log("\n=== Concurrent I/O ===\n");

const files = [];
for (let i = 0; i < 5; i++) {
  const path = join(tmpdir(), `io-test-${Date.now()}-${i}.txt`);
  await writeFile(path, `File ${i} content`);
  files.push(path);
}

const ioStart = performance.now();
const results = await Promise.all(
  files.map(async (f, i) => {
    const content = await readFile(f, "utf-8");
    const elapsed = (performance.now() - ioStart).toFixed(1);
    return `  File ${i}: read in ${elapsed}ms (${content.length} bytes)`;
  })
);

results.forEach((r) => console.log(r));
const total = (performance.now() - ioStart).toFixed(1);
console.log(`\n  All 5 files read in ${total}ms (concurrent, not sequential)`);

// Cleanup
await Promise.all([unlink(tmpFile), ...files.map((f) => unlink(f))]);
```

## Expected Output

```
=== I/O callback ordering ===

  1. File read completed at ~Xms (2900 bytes)
  2. setImmediate at ~Xms (check phase)
  3. setTimeout at ~Xms (timers phase)

=== Concurrent I/O ===

  File 0: read in ~Xms (14 bytes)
  File 1: read in ~Xms (14 bytes)
  File 2: read in ~Xms (14 bytes)
  File 3: read in ~Xms (14 bytes)
  File 4: read in ~Xms (14 bytes)

  All 5 files read in ~Xms (concurrent, not sequential)
```

## Challenge

1. Read 20 files concurrently. At what point does the thread pool (4 threads) become a bottleneck?
2. Compare `readFile` (callback-based) with `fs.promises.readFile` (Promise-based) — is there a performance difference?
3. Use `fs.createReadStream` instead of `readFile` for a large file. When does the stream approach win?

## Common Mistakes

- Thinking all I/O callbacks fire at once — they're processed one at a time in the poll phase
- Not realizing that file I/O uses the thread pool and is limited to `UV_THREADPOOL_SIZE` concurrent operations
- Using synchronous `fs.readFileSync` in a server — it blocks the entire event loop while the file is being read
