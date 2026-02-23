---
id: memory-management
phase: 13
phase_title: Performance & Scaling
sequence: 2
title: Memory Management and Leak Detection
difficulty: advanced
tags: [memory, leaks, heap, gc, v8, debugging]
prerequisites: [profiling]
estimated_minutes: 15
---

## Concept

V8 (Node.js's JavaScript engine) manages memory automatically with a garbage collector. Understanding how it works helps you avoid memory leaks and optimize memory usage.

**V8 memory structure:**
- **New Space** — small, short-lived objects (fast allocation, frequent GC)
- **Old Space** — objects that survived multiple GC cycles (less frequent GC)
- **Large Object Space** — objects > 1MB
- **Code Space** — compiled functions
- **Map Space** — hidden classes (object shapes)

**Common memory leak patterns:**
1. **Growing arrays/maps** — accumulating data without bounds
2. **Event listeners** — adding listeners without removing them
3. **Closures** — functions capturing large scopes
4. **Global caches** — caches without eviction
5. **Unreleased resources** — streams, timers, connections

**Monitoring memory:**
```js
const mem = process.memoryUsage();
// { rss, heapTotal, heapUsed, external, arrayBuffers }
```

- `rss` — Resident Set Size (total process memory from OS perspective)
- `heapTotal` — V8 heap allocated
- `heapUsed` — V8 heap actually used
- `external` — C++ objects (Buffers, native addons)

## Key Insight

> A memory leak in Node.js means objects that should be garbage collected are still reachable from a GC root (global, active closures, event listeners). The heap grows steadily over time until the process crashes with FATAL ERROR: CALL_AND_RETRY_LAST. The fix isn't increasing `--max-old-space-size` — that just delays the crash. The fix is finding and removing the reference chain that keeps dead objects alive.

## Experiment

```js
console.log("=== Memory Management and Leak Detection ===\n");

// --- Demo 1: Process memory usage ---

console.log("--- Process memory usage ---\n");

function formatMemory(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function printMemory(label) {
  const mem = process.memoryUsage();
  console.log(`  ${label}:`);
  console.log(`    RSS:       ${formatMemory(mem.rss).padStart(10)} (total process memory)`);
  console.log(`    Heap total: ${formatMemory(mem.heapTotal).padStart(9)} (V8 heap allocated)`);
  console.log(`    Heap used:  ${formatMemory(mem.heapUsed).padStart(9)} (V8 heap in use)`);
  console.log(`    External:  ${formatMemory(mem.external).padStart(10)} (C++ objects/Buffers)`);
}

printMemory("Baseline");

// Allocate some objects
const data = [];
for (let i = 0; i < 100000; i++) {
  data.push({ id: i, name: `user_${i}`, timestamp: Date.now() });
}
console.log();
printMemory("After allocating 100K objects");

// Release them
data.length = 0;
global.gc?.(); // Force GC if --expose-gc is set

console.log();
printMemory("After releasing objects");

// --- Demo 2: Memory leak simulation ---

console.log("\n--- Memory leak patterns ---\n");

// Leak 1: Unbounded cache
class LeakyCache {
  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    if (this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key);
    }
    this.misses++;
    return null;
  }

  set(key, value) {
    // BUG: Never evicts old entries!
    this.cache.set(key, value);
  }

  size() {
    return this.cache.size;
  }
}

const leakyCache = new LeakyCache();
for (let i = 0; i < 10000; i++) {
  leakyCache.set(`key-${i}`, { data: "x".repeat(100), timestamp: Date.now() });
}

console.log(`  Leak 1: Unbounded cache`);
console.log(`    Cache size: ${leakyCache.size()} entries (never shrinks!)`);
console.log(`    Fix: Add maxSize + LRU eviction\n`);

// Fixed: LRU cache with max size
class LRUCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  size() { return this.cache.size; }
}

const lruCache = new LRUCache(100);
for (let i = 0; i < 10000; i++) {
  lruCache.set(`key-${i}`, { data: "x".repeat(100) });
}
console.log(`  Fixed: LRU cache (maxSize=100)`);
console.log(`    Cache size: ${lruCache.size()} entries (bounded!)\n`);

// Leak 2: Event listener accumulation
console.log(`  Leak 2: Event listener accumulation`);

const { EventEmitter } = await import("node:events");
const emitter = new EventEmitter();

// BAD: adding listeners in a loop without removing
let listenerCount = 0;
for (let i = 0; i < 20; i++) {
  emitter.on("data", () => {}); // Each iteration adds a new listener!
  listenerCount++;
}
console.log(`    Listeners: ${emitter.listenerCount("data")} (should be 1, not ${listenerCount})`);
console.log(`    Fix: Use .once(), or remove old listeners with .off()\n`);

// Leak 3: Closure capturing scope
console.log(`  Leak 3: Closures capturing large scope`);
console.log(`    BAD:  function process(data) {`);
console.log(`            const bigBuffer = Buffer.alloc(10 * 1024 * 1024);`);
console.log(`            return () => data.id; // Closure keeps bigBuffer alive!`);
console.log(`          }`);
console.log(`    GOOD: function process(data) {`);
console.log(`            const bigBuffer = Buffer.alloc(10 * 1024 * 1024);`);
console.log(`            const id = data.id;   // Extract only what's needed`);
console.log(`            return () => id;       // bigBuffer can be GC'd`);
console.log(`          }\n`);

// --- Demo 3: WeakRef and FinalizationRegistry ---

console.log("--- WeakRef and FinalizationRegistry ---\n");

// WeakRef doesn't prevent garbage collection
let strongRef = { name: "Alice", data: new Array(1000).fill("x") };
const weakRef = new WeakRef(strongRef);

console.log(`  Before: weakRef.deref()?.name = "${weakRef.deref()?.name}"`);
strongRef = null; // Remove strong reference
// GC may collect it now (but not guaranteed immediately)
console.log(`  After nulling strongRef: weakRef.deref()?.name = "${weakRef.deref()?.name || "(collected)"}"`);
console.log(`  WeakRef allows GC to collect when no strong refs remain\n`);

// FinalizationRegistry for cleanup callbacks
console.log(`  FinalizationRegistry: get notified when objects are collected`);
console.log(`    const registry = new FinalizationRegistry((key) => {`);
console.log(`      cache.delete(key); // Clean up associated resources`);
console.log(`    });`);
console.log(`    registry.register(object, cacheKey);\n`);

// --- Demo 4: Memory monitoring over time ---

console.log("--- Memory trend monitoring ---\n");

const snapshots = [];
const memBaseline = process.memoryUsage().heapUsed;

// Simulate a server processing requests over time
const tempData = [];
for (let i = 0; i < 10; i++) {
  // Simulate "request processing"
  for (let j = 0; j < 1000; j++) {
    tempData.push({ reqId: `${i}-${j}`, data: "x".repeat(50) });
  }

  // Track memory
  const mem = process.memoryUsage();
  snapshots.push({
    tick: i,
    heapMB: ((mem.heapUsed - memBaseline) / 1024 / 1024).toFixed(2),
    objects: tempData.length,
  });
}

console.log("  Tick  Heap Growth   Objects   Trend");
for (const snap of snapshots) {
  const bar = "█".repeat(Math.max(1, Math.round(parseFloat(snap.heapMB) * 2)));
  console.log(`    ${String(snap.tick).padStart(2)}   +${snap.heapMB.padStart(5)} MB   ${String(snap.objects).padStart(6)}   ${bar}`);
}
console.log(`\n  Heap growing linearly → memory leak! (tempData never cleared)\n`);

// --- Demo 5: V8 GC info ---

console.log("--- V8 garbage collection ---\n");

const gcInfo = [
  ["GC Type", "Space", "Frequency", "Pause"],
  ["Scavenge", "New Space (young)", "Frequent (~ms)", "~1-5ms"],
  ["Mark-Sweep", "Old Space", "Less frequent", "~10-100ms"],
  ["Mark-Compact", "Old Space", "Rare (compaction)", "~50-200ms"],
  ["Incremental", "Old Space", "Concurrent", "~0.1ms per step"],
];

for (const [type, space, freq, pause] of gcInfo) {
  console.log(`  ${type.padEnd(14)} ${space.padEnd(22)} ${freq.padEnd(18)} ${pause}`);
}

console.log(`\n  V8 heap defaults: --max-old-space-size ~1.5GB (64-bit)`);
console.log(`  Override: node --max-old-space-size=4096 app.js (4GB heap)`);

console.log("\n=== Memory Debugging Commands ===\n");

console.log(`  # Heap snapshot via inspect
  node --inspect app.js
  # Chrome DevTools → Memory → Take Heap Snapshot

  # Heap snapshot from code
  const v8 = require('v8');
  v8.writeHeapSnapshot(); // writes to cwd

  # Monitor GC activity
  node --trace-gc app.js

  # Set heap limit
  node --max-old-space-size=2048 app.js
`);
```

## Expected Output

```
=== Memory Management and Leak Detection ===

--- Process memory usage ---

  Baseline:
    RSS:        ~30 MB
    Heap total:  ~8 MB
    Heap used:   ~6 MB

  After allocating 100K objects:
    RSS:        ~50 MB
    Heap total: ~25 MB
    Heap used:  ~20 MB

--- Memory leak patterns ---

  Leak 1: Unbounded cache
    Cache size: 10000 entries (never shrinks!)
    Fix: Add maxSize + LRU eviction

  Fixed: LRU cache (maxSize=100)
    Cache size: 100 entries (bounded!)
  ...
```

## Challenge

1. Build a memory monitor that takes heap snapshots every 60 seconds and alerts when heap usage grows by more than 20% between snapshots
2. Implement an LRU cache with `WeakRef` values — cached objects can be garbage collected under memory pressure, and the cache automatically cleans up stale entries
3. Write a stress test that intentionally creates a memory leak (accumulating event listeners), detect it with `process.memoryUsage()`, and fix it

## Common Mistakes

- Increasing `--max-old-space-size` to "fix" memory leaks — it just delays the inevitable crash. Find and fix the leak
- Storing unbounded data in module-level variables — these persist for the lifetime of the process
- Adding event listeners in request handlers without removing them — each request adds a new listener that's never cleaned up
- Using `global` for caching — no eviction, no size limits, grows until OOM
