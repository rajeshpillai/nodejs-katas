---
id: event-loop-phases
phase: 2
phase_title: Node.js Core Architecture
sequence: 1
title: Event Loop Phases
difficulty: intermediate
tags: [event-loop, phases, libuv, internals]
prerequisites: [the-event-loop, microtasks-vs-macrotasks]
estimated_minutes: 15
---

## Concept

The event loop is not a single queue. It runs through **six phases** in a fixed order, and each phase has its own queue of callbacks:

1. **Timers** — executes `setTimeout` and `setInterval` callbacks whose time has elapsed
2. **Pending callbacks** — executes I/O callbacks deferred from the previous loop iteration
3. **Idle, prepare** — internal use only
4. **Poll** — retrieves new I/O events, executes I/O callbacks (file reads, network data). This is where Node.js spends most of its time
5. **Check** — executes `setImmediate` callbacks
6. **Close callbacks** — executes close handlers like `socket.on('close', ...)`

After **each** phase, Node.js drains the `process.nextTick` queue, then the microtask queue (Promises). This inter-phase microtask processing is what makes Node.js async behavior predictable.

## Key Insight

> The event loop is a cycle of phases, not a single queue. `setTimeout` and `setImmediate` run in different phases, which is why their relative order can vary. Understanding phases lets you predict exactly when your code runs.

## Experiment

```js
import { readFile } from "fs";

// Show the phase ordering
console.log("=== Phase ordering demo ===\n");

// Timer phase
setTimeout(() => console.log("2. setTimeout  (timers phase)"), 0);

// Check phase
setImmediate(() => console.log("3. setImmediate (check phase)"));

// Microtasks (run between phases)
process.nextTick(() => console.log("1. nextTick (between phases)"));

console.log("0. synchronous\n");

// Inside I/O callback, the order is guaranteed
console.log("=== Inside I/O callback ===\n");

readFile(import.meta.filename ?? __filename, () => {
  console.log("I/O callback fired (poll phase)");

  // After poll phase, check phase runs next
  setTimeout(() => console.log("  setTimeout  (next tick of timers phase)"), 0);
  setImmediate(() => console.log("  setImmediate (check phase — runs first!)"));

  process.nextTick(() => console.log("  nextTick (runs before either)"));
});
```

## Expected Output

```
=== Phase ordering demo ===

0. synchronous

=== Inside I/O callback ===

1. nextTick (between phases)
3. setImmediate (check phase)      ┓ these three lines race — order varies
2. setTimeout  (timers phase)      ┃ run to run (see notes below)
I/O callback fired (poll phase)    ┛
  nextTick (runs before either)
  setImmediate (check phase — runs first!)
  setTimeout  (next tick of timers phase)
```

What's guaranteed here and what isn't:

- **Both heading lines are synchronous.** `=== Inside I/O callback ===` is a
  plain `console.log` that runs *before* `readFile`'s callback is ever scheduled,
  so it prints during the synchronous pass — right after `0. synchronous`, not
  next to the I/O output.
- **`1. nextTick` is always first** of the async lines (microtasks drain before
  any phase).
- **Lines `2`, `3`, and `I/O callback fired` race.** At the top level
  `setTimeout(0)` vs `setImmediate` is undefined (often `3` prints before `2`),
  and the `readFile` callback may land before *or* after the top-level timer
  depending on how fast the read completes. Run it a few times — the order of
  these three shifts.
- **The indented block is deterministic.** Inside the I/O callback you're in the
  poll phase, so `nextTick` → `setImmediate` → `setTimeout` is fixed: the check
  phase always runs before the next timers phase.

## Challenge

1. Why does `setImmediate` beat `setTimeout` inside an I/O callback but not always at the top level?
2. Schedule a `setTimeout(fn, 0)` and a `setImmediate` inside another `setTimeout`. Which runs first?
3. Use `process.hrtime.bigint()` to measure the actual delay of `setTimeout(fn, 0)` — is it really 0ms?

## Deep Dive

The reason `setTimeout` vs `setImmediate` ordering varies at the top level:

When the program starts, the timer callback might or might not be ready depending on how fast the process initialized. If the event loop starts within 1ms, the timer isn't expired yet and `setImmediate` wins. If startup takes longer, the timer is expired and runs first.

Inside an I/O callback, you're in the **poll phase**. After poll, the **check phase** runs next — so `setImmediate` always fires before the next iteration's timer phase.

## Common Mistakes

- Assuming `setTimeout(fn, 0)` and `setImmediate` always run in the same order — they don't at the top level
- Not understanding that I/O callbacks run in the poll phase, and check phase comes right after
- Thinking `setImmediate` means "immediately" — it means "after the current poll phase"


---

## Navigation

[< 005 — Async Pitfalls](../phase-01-js-for-node/005-async-pitfalls.md) | [002 — Libuv >](002-libuv.md)
