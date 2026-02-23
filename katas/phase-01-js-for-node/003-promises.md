---
id: promises
phase: 1
phase_title: JavaScript for the Node Runtime
sequence: 3
title: Promises
difficulty: beginner
tags: [promises, async, error-handling]
prerequisites: [microtasks-vs-macrotasks]
estimated_minutes: 15
---

## Concept

A Promise represents a value that may not exist yet. It has three states:

- **Pending** — the operation hasn't completed
- **Fulfilled** — the operation succeeded, the value is available
- **Rejected** — the operation failed, an error is available

Promises are the foundation of async programming in Node.js. Every `fs.promises` call, every `fetch`, every database query returns a Promise. Understanding them is non-negotiable.

A key property: once a Promise settles (fulfilled or rejected), it **never changes state again**. And `.then()` callbacks always run as microtasks — never synchronously, even if the Promise is already resolved.

## Key Insight

> Promises are not just callbacks with better syntax. They are a state machine (pending → fulfilled/rejected) that guarantees: handlers always run asynchronously, errors propagate through chains, and settled values are immutable.

## Experiment

```js
// Creating and consuming Promises
function readConfig(path) {
  return new Promise((resolve, reject) => {
    // Simulate async file read
    setTimeout(() => {
      if (path === "/valid") {
        resolve({ port: 3000, host: "localhost" });
      } else {
        reject(new Error(`Config not found: ${path}`));
      }
    }, 50);
  });
}

// Promise chain — each .then() returns a new Promise
console.log("1. Starting config read...");

readConfig("/valid")
  .then((config) => {
    console.log("2. Got config:", config);
    return config.port;  // returned value becomes next Promise's value
  })
  .then((port) => {
    console.log("3. Server would start on port:", port);
  });

// Error handling with .catch()
readConfig("/invalid")
  .then((config) => {
    console.log("This never runs");
  })
  .catch((err) => {
    console.log("4. Caught error:", err.message);
  });

// Key: .then() on an already-resolved Promise still runs asynchronously
const resolved = Promise.resolve("instant");
resolved.then((val) => console.log("6. Resolved value:", val));
console.log("5. This prints before the resolved Promise handler");
```

## Expected Output

```
1. Starting config read...
5. This prints before the resolved Promise handler
6. Resolved value: instant
2. Got config: { port: 3000, host: 'localhost' }
3. Server would start on port: 3000
4. Caught error: Config not found: /invalid
```

## Challenge

1. Chain three `.then()` calls where each transforms the value. What happens if one throws an error?
2. Use `Promise.all()` to run 3 async operations concurrently. What happens if one rejects?
3. Use `Promise.allSettled()` instead — how does the result differ when one rejects?
4. What happens to an unhandled Promise rejection in Node.js? Try it.

## Deep Dive

`Promise.all` vs `Promise.allSettled` vs `Promise.race` vs `Promise.any`:

- **`Promise.all([...])`** — resolves when ALL resolve, rejects on FIRST rejection
- **`Promise.allSettled([...])`** — always resolves, gives status of each Promise
- **`Promise.race([...])`** — resolves/rejects with the FIRST settled Promise
- **`Promise.any([...])`** — resolves with FIRST fulfillment, rejects only if ALL reject

In production Node.js, unhandled Promise rejections terminate the process (Node 15+). Always handle errors.

## Common Mistakes

- Forgetting to return a value inside `.then()` — the next handler gets `undefined`
- Not adding `.catch()` at the end of a chain — unhandled rejection crashes the process
- Creating a Promise inside `.then()` without returning it — breaks the chain, the outer chain can't wait for it
- Thinking `Promise.resolve(value).then(fn)` runs `fn` synchronously — it never does
