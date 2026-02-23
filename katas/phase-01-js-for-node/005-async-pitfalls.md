---
id: async-pitfalls
phase: 1
phase_title: JavaScript for the Node Runtime
sequence: 5
title: Async Pitfalls
difficulty: intermediate
tags: [async, pitfalls, error-handling, performance]
prerequisites: [async-await]
estimated_minutes: 15
---

## Concept

Async code in Node.js has several traps that catch developers at every level. The three most dangerous:

1. **Unhandled rejections** — a rejected Promise with no `.catch()` or `try/catch` crashes the process
2. **Sequential awaits** — awaiting independent operations one-by-one when they could run concurrently
3. **Callback/Promise mixing** — using callbacks inside async functions or forgetting to promisify old APIs

These aren't edge cases. They're the most common bugs in Node.js production code. Understanding them now saves hours of debugging later.

## Key Insight

> Every async pattern has a failure mode. Unhandled rejections kill your process. Sequential awaits kill your performance. Mixed paradigms kill your sanity. Learn to spot them before they reach production.

## Experiment

```js
// PITFALL 1: Unhandled rejection
// In Node.js 15+, this crashes the process!
// Uncomment to see: Promise.reject(new Error("boom"));

// PITFALL 2: Sequential vs concurrent awaits
function delay(ms, label) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(label), ms);
  });
}

async function sequential() {
  const start = performance.now();
  const a = await delay(50, "A");
  const b = await delay(50, "B");
  const c = await delay(50, "C");
  const time = Math.round(performance.now() - start);
  console.log(`Sequential: ${time}ms [${a}, ${b}, ${c}]`);
}

async function concurrent() {
  const start = performance.now();
  const [a, b, c] = await Promise.all([
    delay(50, "A"),
    delay(50, "B"),
    delay(50, "C"),
  ]);
  const time = Math.round(performance.now() - start);
  console.log(`Concurrent: ${time}ms [${a}, ${b}, ${c}]`);
}

// PITFALL 3: forEach doesn't await
async function forEachTrap() {
  const items = [1, 2, 3];
  const results = [];

  // BUG: forEach ignores async — loop finishes before callbacks
  items.forEach(async (item) => {
    await delay(10, item);
    results.push(item);
  });

  console.log(`forEach trap — results: [${results}] (empty! forEach didn't wait)`);
}

// FIX: Use for...of
async function forOfFix() {
  const items = [1, 2, 3];
  const results = [];

  for (const item of items) {
    await delay(10, item);
    results.push(item);
  }

  console.log(`for...of fix — results: [${results}]`);
}

// Run all demos
await sequential();
await concurrent();
await forEachTrap();
await forOfFix();

// PITFALL 4: Swallowed errors in Promise.all
async function errorDemo() {
  try {
    await Promise.all([
      delay(30, "ok"),
      Promise.reject(new Error("one failed")),
      delay(30, "also ok"),
    ]);
  } catch (err) {
    console.log(`Promise.all error: "${err.message}" — all results lost!`);
  }

  // Fix: Promise.allSettled preserves all results
  const results = await Promise.allSettled([
    delay(30, "ok"),
    Promise.reject(new Error("one failed")),
    delay(30, "also ok"),
  ]);
  console.log("allSettled:", results.map((r) =>
    r.status === "fulfilled" ? r.value : `ERR: ${r.reason.message}`
  ));
}

await errorDemo();
```

## Expected Output

```
Sequential: ~150ms [A, B, C]
Concurrent: ~50ms [A, B, C]
forEach trap — results: [] (empty! forEach didn't wait)
for...of fix — results: [1, 2, 3]
Promise.all error: "one failed" — all results lost!
allSettled: [ 'ok', 'ERR: one failed', 'also ok' ]
```

## Challenge

1. Write a function that retries a failing async operation 3 times with a delay between attempts
2. Implement a `pMap(items, fn, concurrency)` that runs async work with limited concurrency (e.g., 3 at a time)
3. What happens if you `await` a non-Promise value? Try `await 42` and `await "hello"`

## Common Mistakes

- Using `forEach` with `async` callbacks — it never waits for them. Use `for...of` for sequential, `Promise.all(arr.map(...))` for concurrent
- Catching errors from `Promise.all` and losing the successful results — use `Promise.allSettled` when you need partial results
- Not handling the case where `Promise.all` rejects on the first failure — the other Promises keep running but their results are discarded
- Wrapping synchronous code in `new Promise()` unnecessarily — if it doesn't need to be async, don't make it async
