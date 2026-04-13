---
id: the-event-loop
phase: 0
phase_title: What is Node.js Really?
sequence: 4
title: The Event Loop
difficulty: beginner
tags: [runtime, event-loop, microtasks, macrotasks]
prerequisites: [single-threaded-execution]
estimated_minutes: 15
---

## Concept

The event loop is Node.js's heartbeat. It continuously checks for pending work and processes it in a specific order:

1. **Synchronous code** runs first, to completion
2. **`process.nextTick`** callbacks run next (before anything else async)
3. **Microtasks** (Promise `.then()`, `queueMicrotask`) run after nextTick
4. **Timers** (`setTimeout`, `setInterval`) run in the timer phase
5. **I/O callbacks** run for completed file/network operations
6. **`setImmediate`** runs in the check phase (after I/O)

Between each phase, Node.js drains the microtask queue completely. This means a chain of resolved Promises always runs before the next timer or I/O callback.

## Key Insight

> The event loop has a strict ordering. `process.nextTick` runs before Promises, Promises run before `setTimeout`, and `setTimeout` runs before `setImmediate`. Understanding this order is the key to understanding Node.js behavior.

## Experiment

```js
console.log("1 - synchronous");

setTimeout(() => {
  console.log("6 - setTimeout (timer phase)");
}, 0);

setImmediate(() => {
  console.log("7 - setImmediate (check phase)");
});

Promise.resolve().then(() => {
  console.log("4 - Promise.then (microtask)");
});

queueMicrotask(() => {
  console.log("5 - queueMicrotask (microtask)");
});

process.nextTick(() => {
  console.log("3 - process.nextTick (runs before microtasks)");
});

console.log("2 - synchronous end");

// Order: sync → nextTick → microtasks → timers → check
```

## Expected Output

```
1 - synchronous
2 - synchronous end
3 - process.nextTick (runs before microtasks)
4 - Promise.then (microtask)
5 - queueMicrotask (microtask)
6 - setTimeout (timer phase)
7 - setImmediate (check phase)
```

## Challenge

1. Add a `process.nextTick` inside the `Promise.then` callback. When does it run?
2. Add a `Promise.resolve().then()` inside the `setTimeout` callback. When does it run relative to `setImmediate`?
3. What happens if a `process.nextTick` callback schedules another `process.nextTick`? Can this starve the event loop?

## Deep Dive

The event loop runs in these phases (in order):

```
┌───────────────────────────────┐
│           timers              │  ← setTimeout, setInterval
├───────────────────────────────┤
│     pending callbacks         │  ← system-level callbacks
├───────────────────────────────┤
│       idle, prepare           │  ← internal use
├───────────────────────────────┤
│           poll                │  ← I/O events, incoming connections
├───────────────────────────────┤
│           check               │  ← setImmediate
├───────────────────────────────┤
│      close callbacks          │  ← socket.on('close', ...)
└───────────────────────────────┘
```

Between **every** phase transition, Node.js drains the `nextTick` queue, then the microtask queue. This is why `process.nextTick` is so aggressive — it can starve I/O if used recursively.

## Common Mistakes

- Using `process.nextTick` recursively — it starves the event loop because nextTick callbacks run before any I/O
- Thinking `setImmediate` is "more immediate" than `setTimeout(fn, 0)` — the name is misleading; it runs later
- Assuming Promises run "in parallel" — they don't, they're just deferred microtasks on the same thread


---

## Navigation

[< 003 — Single Threaded Execution](003-single-threaded-execution.md) | [005 — Why Nodejs Scales >](005-why-nodejs-scales.md)
