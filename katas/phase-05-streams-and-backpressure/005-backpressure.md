---
id: backpressure
phase: 5
phase_title: Streams & Backpressure
sequence: 5
title: Backpressure
difficulty: advanced
tags: [streams, backpressure, highWaterMark, memory, flow-control]
prerequisites: [piping-and-pipeline]
estimated_minutes: 18
---

## Concept

Backpressure is the mechanism that prevents a fast producer from overwhelming a slow consumer. Without it, data accumulates in memory buffers until the process runs out of memory and crashes.

The backpressure chain works like this:

1. A Readable produces data faster than the Writable can consume it
2. The Writable's internal buffer fills up past its `highWaterMark`
3. `writable.write()` returns `false` — "stop sending"
4. The Readable pauses (stops reading from its source)
5. The Writable drains its buffer (writes to disk/network)
6. The Writable emits `'drain'` — "ready for more"
7. The Readable resumes

When you use `pipe()` or `pipeline()`, this entire dance happens automatically. When you write data manually, **you** are responsible for checking `write()` return values and waiting for `'drain'`.

The `highWaterMark` (default 16 KB for byte streams, 16 objects for object streams) controls when backpressure kicks in. It's not a hard limit — it's a suggestion. Data can exceed it, but the stream signals to slow down.

## Key Insight

> Backpressure is what makes streaming possible. Without it, `readableStream.pipe(writableStream)` with a fast SSD source and a slow network destination would buffer the entire file in memory. With backpressure, memory usage stays bounded regardless of data size. This is why Node.js can serve 10 GB files with 64 MB of RAM.

## Experiment

```js
import { Readable, Writable, Transform, pipeline } from "stream";
import { pipeline as pipelinePromise } from "stream/promises";

console.log("=== Seeing Backpressure ===\n");

// Fast producer, slow consumer
class FastProducer extends Readable {
  constructor(total) {
    super({ highWaterMark: 64 });  // Small buffer to trigger backpressure quickly
    this.total = total;
    this.produced = 0;
    this.readCalls = 0;
  }

  _read(size) {
    this.readCalls++;
    if (this.produced < this.total) {
      this.produced++;
      this.push(`Chunk ${this.produced}\n`);
    } else {
      this.push(null);
    }
  }
}

class SlowConsumer extends Writable {
  constructor(delayMs) {
    super({ highWaterMark: 32 });  // Small buffer
    this.delayMs = delayMs;
    this.consumed = 0;
    this.drainCount = 0;
  }

  _write(chunk, encoding, callback) {
    this.consumed++;
    // Simulate slow processing
    setTimeout(callback, this.delayMs);
  }
}

const producer = new FastProducer(20);
const consumer = new SlowConsumer(10);

// Track drain events
consumer.on("drain", () => consumer.drainCount++);

await pipelinePromise(producer, consumer);

console.log("Producer:");
console.log("  Total chunks produced:", producer.produced);
console.log("  Times _read() was called:", producer.readCalls);
console.log("Consumer:");
console.log("  Total chunks consumed:", consumer.consumed);
console.log("  Drain events:", consumer.drainCount);
console.log("  (drain > 0 means backpressure was applied)");

console.log("\n=== Manual Backpressure ===\n");

// Without pipe() — you must handle backpressure yourself
async function writeWithBackpressure(writable, items) {
  let backpressureCount = 0;

  for (const item of items) {
    const ok = writable.write(item);
    if (!ok) {
      backpressureCount++;
      await new Promise(resolve => writable.once("drain", resolve));
    }
  }

  writable.end();
  await new Promise((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("error", reject);
  });

  return backpressureCount;
}

const slowWriter = new SlowConsumer(5);
slowWriter.on("drain", () => slowWriter.drainCount++);

const items = Array.from({ length: 30 }, (_, i) => `Item ${i}\n`);
const bpCount = await writeWithBackpressure(slowWriter, items);

console.log("Items written:", items.length);
console.log("Backpressure pauses:", bpCount);

console.log("\n=== What Happens WITHOUT Backpressure ===\n");

// Ignoring write() return value — buffer grows unbounded
class MemoryTracker extends Writable {
  constructor() {
    super({ highWaterMark: 16 });  // 16 byte buffer
    this.maxBuffered = 0;
    this.writeCount = 0;
  }

  _write(chunk, encoding, callback) {
    this.writeCount++;
    // Track maximum buffer size
    if (this.writableLength > this.maxBuffered) {
      this.maxBuffered = this.writableLength;
    }
    // Simulate slow write
    setTimeout(callback, 1);
  }
}

// BAD: ignoring backpressure
const badWriter = new MemoryTracker();
for (let i = 0; i < 100; i++) {
  badWriter.write(`${"x".repeat(100)}\n`);  // Ignoring return value!
}
badWriter.end();
await new Promise(resolve => badWriter.on("finish", resolve));

console.log("Without backpressure:");
console.log("  Max buffered:", badWriter.maxBuffered, "bytes");
console.log("  (entire dataset was buffered in memory)");

// GOOD: respecting backpressure
const goodWriter = new MemoryTracker();
const goodItems = Array.from({ length: 100 }, (_, i) => `${"x".repeat(100)}\n`);
await writeWithBackpressure(goodWriter, goodItems);

console.log("\nWith backpressure:");
console.log("  Max buffered:", goodWriter.maxBuffered, "bytes");
console.log("  (bounded by highWaterMark)");

console.log("\n=== highWaterMark Tuning ===\n");

async function measureThroughput(hwm, chunkCount) {
  let bytesProcessed = 0;

  const source = new Readable({
    highWaterMark: hwm,
    read() {
      if (bytesProcessed < chunkCount * 1024) {
        this.push(Buffer.alloc(1024, 0x41));
        bytesProcessed += 1024;
      } else {
        this.push(null);
      }
    }
  });

  const sink = new Writable({
    highWaterMark: hwm,
    write(chunk, enc, cb) { cb(); }
  });

  const start = performance.now();
  await pipelinePromise(source, sink);
  const elapsed = performance.now() - start;

  return { hwm, bytes: bytesProcessed, elapsed: elapsed.toFixed(1) };
}

// Compare different highWaterMark sizes
const results = [];
for (const hwm of [64, 1024, 16384, 65536]) {
  const result = await measureThroughput(hwm, 1000);
  results.push(result);
}

console.log("highWaterMark vs throughput (1 MB of data):");
for (const r of results) {
  console.log(`  hwm=${String(r.hwm).padStart(5)}: ${r.elapsed}ms`);
}
console.log("\n  Larger buffers = fewer reads/writes = higher throughput");
console.log("  But also = more memory usage per stream");

console.log("\n=== Object Mode Backpressure ===\n");

// In object mode, highWaterMark is number of objects, not bytes
class ObjectProducer extends Readable {
  constructor(count) {
    super({ objectMode: true, highWaterMark: 4 });  // Buffer up to 4 objects
    this.count = count;
    this.current = 0;
  }

  _read() {
    if (this.current < this.count) {
      this.current++;
      this.push({ id: this.current, data: "x".repeat(1000) });
    } else {
      this.push(null);
    }
  }
}

class ObjectConsumer extends Writable {
  constructor() {
    super({ objectMode: true, highWaterMark: 2 });  // Buffer up to 2 objects
    this.processed = 0;
  }

  _write(obj, enc, cb) {
    this.processed++;
    setTimeout(cb, 5);  // Slow consumer
  }
}

const objProducer = new ObjectProducer(10);
const objConsumer = new ObjectConsumer();

await pipelinePromise(objProducer, objConsumer);

console.log("Object mode:");
console.log("  Produced:", objProducer.current, "objects");
console.log("  Consumed:", objConsumer.processed, "objects");
console.log("  Producer hwm: 4 objects, Consumer hwm: 2 objects");
```

## Expected Output

```
=== Seeing Backpressure ===

Producer:
  Total chunks produced: 20
  Times _read() was called: <number>
Consumer:
  Total chunks consumed: 20
  Drain events: <number>
  (drain > 0 means backpressure was applied)

=== Manual Backpressure ===

Items written: 30
Backpressure pauses: <number>

=== What Happens WITHOUT Backpressure ===

Without backpressure:
  Max buffered: <large number> bytes
  (entire dataset was buffered in memory)

With backpressure:
  Max buffered: <small number> bytes
  (bounded by highWaterMark)

=== highWaterMark Tuning ===

highWaterMark vs throughput (1 MB of data):
  hwm=   64: <ms>
  hwm= 1024: <ms>
  hwm=16384: <ms>
  hwm=65536: <ms>

  Larger buffers = fewer reads/writes = higher throughput
  But also = more memory usage per stream

=== Object Mode Backpressure ===

Object mode:
  Produced: 10 objects
  Consumed: 10 objects
  Producer hwm: 4 objects, Consumer hwm: 2 objects
```

## Challenge

1. Build a pipeline that reads a large file and writes it to a slow destination (simulate with `setTimeout` in `_write`). Log memory usage (`process.memoryUsage().rss`) every 100ms to prove memory stays bounded
2. Implement a "throttled" transform that limits throughput to N bytes per second using backpressure — delay the `callback()` in `_transform` based on how many bytes have been processed
3. What happens when you have a Transform with a very small `highWaterMark` between a fast producer and a fast consumer? How does it affect throughput?

## Deep Dive

The `highWaterMark` is often misunderstood. It's not a maximum buffer size — it's a threshold. When the buffer exceeds the high water mark:
- For Readables: `_read()` stops being called until the buffer drains
- For Writables: `write()` returns `false` until the buffer drains below the mark

The actual buffer can exceed the high water mark by one chunk — the overshoot is by design. If `highWaterMark` is 16 KB and a chunk is 64 KB, the buffer will hold 64 KB before signaling backpressure.

Default values:
- Byte streams: 16,384 bytes (16 KB)
- Object streams: 16 objects
- `fs.createReadStream`: 65,536 bytes (64 KB)

## Common Mistakes

- Setting `highWaterMark` too small — causes excessive pausing and resuming, reducing throughput
- Setting `highWaterMark` too large — reduces the responsiveness of backpressure, allowing more memory usage
- Ignoring backpressure in manual write loops — the most common stream bug. Always check `write()` return value
- Not understanding that `pipe()` handles backpressure automatically — no need to manually pause/resume when using pipe/pipeline
- Using `stream.resume()` without a `'data'` handler — data is silently discarded
