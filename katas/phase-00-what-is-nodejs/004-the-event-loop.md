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

> Within a single turn the event loop has a strict ordering: `process.nextTick` runs before Promise microtasks, and microtasks run before any timer or `setImmediate`. But `setTimeout(fn, 0)` vs `setImmediate` is **not** ordered at the top level — it's a race decided by how long startup took. Understanding what *is* guaranteed (and what isn't) is the key to understanding Node.js behavior.

## Experiment

```js
console.log("1 - synchronous");

setTimeout(() => {
  console.log("6 - setTimeout (timer phase) — order vs setImmediate not guaranteed");
}, 0);

setImmediate(() => {
  console.log("7 - setImmediate (check phase) — may print before #6");
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

// Guaranteed: sync → nextTick → microtasks → (timers / check)
// NOT guaranteed: setTimeout(0) vs setImmediate — that pair races at the top level
```

## Expected Output

```
1 - synchronous
2 - synchronous end
3 - process.nextTick (runs before microtasks)
4 - Promise.then (microtask)
5 - queueMicrotask (microtask)
6 - setTimeout (timer phase) — order vs setImmediate not guaranteed
7 - setImmediate (check phase) — may print before #6
```

The first five lines are deterministic. The last two (`setTimeout(0)` and
`setImmediate`) can appear in **either** order — run this a few times and you may
see them swap. At the top level the timer is "due" only if startup already took
more than ~1 ms, so the winner depends on process startup timing. (Inside an I/O
callback the order *is* fixed — `setImmediate` always wins; see the Event Loop
Phases kata.)

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
- Thinking `setImmediate` is "more immediate" than `setTimeout(fn, 0)` — the name is misleading. At the top level their order is a race; inside an I/O callback `setImmediate` always runs first
- Assuming Promises run "in parallel" — they don't, they're just deferred microtasks on the same thread


---

## Navigation

[< 003 — Single Threaded Execution](003-single-threaded-execution.md) | [005 — Why Nodejs Scales >](005-why-nodejs-scales.md)
