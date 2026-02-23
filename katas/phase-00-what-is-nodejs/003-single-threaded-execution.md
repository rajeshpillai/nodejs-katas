---
id: single-threaded-execution
phase: 0
phase_title: What is Node.js Really?
sequence: 3
title: Single-Threaded Execution
difficulty: beginner
tags: [runtime, event-loop, blocking, single-thread]
prerequisites: [v8-and-the-runtime]
estimated_minutes: 12
---

## Concept

JavaScript in Node.js runs on a **single thread**. There is exactly one call stack. Code runs **to completion** before anything else can execute.

This is not a limitation — it is the design. A single thread means no locks, no race conditions, no deadlocks on shared state. The tradeoff is that if you block this thread, **nothing else runs**.

When you call `setTimeout(fn, 0)`, the callback does not run immediately. It is placed in a queue and will execute only after the current synchronous code finishes. The number `0` means "at least 0 milliseconds," not "right now."

## Key Insight

> If you block the single thread, nothing else can run. Blocking the event loop is always a bug. Every long-running synchronous operation delays all other work — timers, I/O callbacks, incoming requests.

## Experiment

```js
console.log("1 - synchronous start");

// Schedule a callback for "as soon as possible"
setTimeout(() => {
  console.log("4 - setTimeout callback (delayed by blocking)");
}, 0);

// Block the single thread for 200ms
const blockStart = performance.now();
const blockUntil = blockStart + 200;
while (performance.now() < blockUntil) {
  // burning CPU — the event loop is frozen
}
const blocked = (performance.now() - blockStart).toFixed(0);

console.log(`2 - after blocking for ${blocked}ms`);
console.log("3 - synchronous end");

// The setTimeout(fn, 0) fires AFTER all synchronous code,
// because the event loop only processes callbacks
// once the call stack is empty.
```

## Expected Output

```
1 - synchronous start
2 - after blocking for 200ms
3 - synchronous end
4 - setTimeout callback (delayed by blocking)
```

## Challenge

1. Change the `setTimeout` delay to `100` — does the callback run after 100ms or after 200ms? Why?
2. Add a second `setTimeout` with delay `50`. What order do callbacks fire in?
3. What would happen to an HTTP server if a request handler had a 200ms blocking loop?

## Deep Dive

Node.js is single-threaded for JavaScript execution, but libuv maintains a thread pool (default 4 threads) for operations that don't have async OS-level support — like file system operations on some platforms, DNS lookups, and compression. These threads do not run your JavaScript code; they handle I/O operations and notify the event loop when complete.

## Common Mistakes

- Thinking `setTimeout(fn, 0)` runs immediately — it doesn't, it waits for the call stack to clear
- Using synchronous file operations (`fs.readFileSync`) in server request handlers — this blocks all other requests
- Believing `async/await` makes code run on another thread — it doesn't, it just suspends and resumes on the same thread
