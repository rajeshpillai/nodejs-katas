---
id: timers-in-depth
phase: 2
phase_title: Node.js Core Architecture
sequence: 3
title: Timers in Depth
difficulty: intermediate
tags: [timers, setTimeout, setInterval, setImmediate, scheduling]
prerequisites: [event-loop-phases]
estimated_minutes: 12
---

## Concept

Node.js has three timer mechanisms, each with different behavior:

- **`setTimeout(fn, delay)`** — runs `fn` once, after at least `delay` ms. Runs in the **timers phase**.
- **`setInterval(fn, delay)`** — runs `fn` repeatedly, every `delay` ms. Also timers phase. Drift accumulates over time.
- **`setImmediate(fn)`** — runs `fn` in the **check phase** of the current or next event loop iteration. No delay concept.

The key word is **"at least."** `setTimeout(fn, 100)` guarantees the callback won't run before 100ms, but it might run later if the event loop is busy. Timers are not precise clocks — they're minimum-delay schedulers.

Node.js also provides `setTimeout` and `setInterval` from `timers/promises` for async/await usage.

## Key Insight

> Timers guarantee a minimum delay, not an exact one. If the event loop is busy processing I/O or running callbacks, timer callbacks are delayed. Never use timers for precision timing — use them for scheduling.

## Experiment

```js
import { setTimeout as sleep } from "timers/promises";

// Timer precision test
console.log("=== Timer precision ===\n");

for (const target of [0, 1, 5, 10, 50]) {
  const start = performance.now();
  await sleep(target);
  const actual = (performance.now() - start).toFixed(2);
  console.log(`  setTimeout(${target}ms) → actual: ${actual}ms`);
}

// setInterval drift
console.log("\n=== setInterval drift ===\n");

let count = 0;
const intervalStart = performance.now();

const id = setInterval(() => {
  count++;
  const elapsed = Math.round(performance.now() - intervalStart);
  const expected = count * 50;
  const drift = elapsed - expected;
  console.log(`  Tick ${count}: ${elapsed}ms (expected ${expected}ms, drift: ${drift >= 0 ? "+" : ""}${drift}ms)`);

  if (count >= 5) {
    clearInterval(id);
    console.log("\n=== Timer return values ===\n");

    // Timers return objects, not numbers (unlike browsers)
    const t = setTimeout(() => {}, 100);
    console.log("  setTimeout returns:", typeof t, `(has ref: ${t.hasRef()})`);

    // Unref'd timers don't keep the process alive
    t.unref();
    console.log("  After unref:", `has ref: ${t.hasRef()}`);
    clearTimeout(t);
    console.log("  Unref'd timers let the process exit naturally");
  }
}, 50);
```

## Expected Output

```
=== Timer precision ===

  setTimeout(0ms) → actual: ~1ms
  setTimeout(1ms) → actual: ~1ms
  setTimeout(5ms) → actual: ~5ms
  setTimeout(10ms) → actual: ~10ms
  setTimeout(50ms) → actual: ~50ms

=== setInterval drift ===

  Tick 1: ~50ms (expected 50ms, drift: ~0ms)
  Tick 2: ~100ms (expected 100ms, drift: ~0ms)
  Tick 3: ~150ms (expected 150ms, drift: ~0ms)
  Tick 4: ~200ms (expected 200ms, drift: ~0ms)
  Tick 5: ~250ms (expected 250ms, drift: ~0ms)

=== Timer return values ===

  setTimeout returns: object (has ref: true)
  After unref: has ref: false
  Unref'd timers let the process exit naturally
```

## Challenge

1. Block the event loop with a 200ms `while` loop after setting `setTimeout(fn, 50)`. When does the callback actually fire?
2. Use `timer.refresh()` to reset a running timer without creating a new one. When is this useful?
3. Replace `setInterval` with recursive `setTimeout` — why is this pattern often preferred in production?

## Deep Dive

`setInterval` has a subtle problem: if the callback takes longer than the interval, executions pile up. Consider:

```
setInterval(() => { heavyWork(); }, 100);
// If heavyWork takes 150ms, the next call is immediately queued
```

The safer pattern is recursive `setTimeout`:

```
function tick() {
  heavyWork();
  setTimeout(tick, 100);  // schedules AFTER work completes
}
```

This guarantees at least 100ms between the **end** of one execution and the **start** of the next.

## Common Mistakes

- Using `setInterval` for operations that may take longer than the interval — causes callback pileup
- Assuming `setTimeout(fn, 0)` is the same as `setImmediate` — they run in different event loop phases
- Forgetting that `setTimeout` in Node.js returns a `Timeout` object (not a number like in browsers)
- Not calling `clearInterval`/`clearTimeout` — leaked timers keep the process alive and waste memory
