---
id: microtasks-vs-macrotasks
phase: 1
phase_title: JavaScript for the Node Runtime
sequence: 2
title: Microtasks vs Macrotasks
difficulty: beginner
tags: [event-loop, microtasks, macrotasks, scheduling]
prerequisites: [the-call-stack]
estimated_minutes: 12
---

## Concept

Node.js has two categories of async callbacks:

**Macrotasks** (task queue):
- `setTimeout`, `setInterval`
- `setImmediate`
- I/O callbacks (file reads, network responses)

**Microtasks** (microtask queue):
- `Promise.then()`, `Promise.catch()`, `Promise.finally()`
- `queueMicrotask()`
- `process.nextTick()` (special — runs before other microtasks)

The critical rule: **after each macrotask completes, the entire microtask queue is drained before the next macrotask runs.** This means microtasks always have priority over macrotasks.

## Key Insight

> Microtasks cut in line. No matter how many macrotasks are waiting, microtasks always run first. A microtask that schedules another microtask will run before any macrotask gets a chance.

## Experiment

```js
// Schedule a macrotask
setTimeout(() => console.log("4. setTimeout (macrotask)"), 0);

// Schedule a microtask
Promise.resolve().then(() => console.log("2. Promise.then (microtask)"));

// Schedule another microtask
queueMicrotask(() => console.log("3. queueMicrotask (microtask)"));

// nextTick runs before all other microtasks
process.nextTick(() => console.log("1. process.nextTick (before microtasks)"));

// Now: what happens when a microtask schedules more microtasks?
Promise.resolve().then(() => {
  console.log("   -- microtask scheduling another microtask --");
  queueMicrotask(() => {
    console.log("   -- nested microtask (still before setTimeout!) --");
  });
});

console.log("0. synchronous code");
```

## Expected Output

```
0. synchronous code
1. process.nextTick (before microtasks)
2. Promise.then (microtask)
   -- microtask scheduling another microtask --
3. queueMicrotask (microtask)
   -- nested microtask (still before setTimeout!) --
4. setTimeout (macrotask)
```

## Challenge

1. Schedule 3 `setTimeout` callbacks and 3 `Promise.then` callbacks in alternating order. What order do they execute in?
2. Write a `process.nextTick` inside another `process.nextTick`. Does it starve the macrotask queue?
3. What happens if you `queueMicrotask` inside a `setTimeout` callback? When does it run relative to the next `setTimeout`?

## Deep Dive

The priority order within Node.js:

```
1. process.nextTick     ← highest priority, runs before everything
2. Promise microtasks   ← runs after nextTick, before macrotasks
3. setTimeout(fn, 0)    ← timer phase macrotask
4. setImmediate         ← check phase macrotask
5. I/O callbacks        ← poll phase
```

`process.nextTick` is unique to Node.js (not available in browsers). It was created before Promises existed and has the highest async priority. Overusing it can starve I/O — prefer `queueMicrotask` for most cases.

## Common Mistakes

- Assuming `setTimeout(fn, 0)` and `Promise.then()` have equal priority — Promises always win
- Using `process.nextTick` recursively — it starves the event loop because the microtask queue never drains
- Not realizing that microtasks scheduled during microtask processing run immediately, before any macrotask
