---
id: readable-streams
phase: 5
phase_title: Streams & Backpressure
sequence: 1
title: Readable Streams
difficulty: intermediate
tags: [streams, readable, async-iteration, flowing, paused]
prerequisites: [what-is-a-buffer]
estimated_minutes: 15
---

## Concept

A Readable stream is a source of data that produces chunks over time. Instead of loading an entire file or response into memory at once, a Readable delivers data piece by piece — letting you process gigabytes of data with kilobytes of memory.

Readable streams have two modes:

1. **Flowing mode** — data is pushed to you as fast as possible via `'data'` events
2. **Paused mode** (default) — you pull data by calling `stream.read()`

In practice, you rarely use either mode directly. Modern Node.js provides two better approaches:

- **`for await...of`** — async iteration over chunks (cleanest API)
- **`stream.pipe(dest)`** — connect a readable to a writable with automatic backpressure

Every `fs.createReadStream()`, HTTP request body, `process.stdin`, TCP socket, and child process stdout is a Readable stream.

## Key Insight

> Streams exist because data often doesn't fit in memory — or shouldn't. A 10 GB log file, a continuous network feed, an infinite sensor stream. Readable streams let you process data as it arrives, one chunk at a time, using constant memory regardless of total data size.

## Experiment

```js
import { Readable } from "stream";
import { createReadStream } from "fs";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

console.log("=== Creating a Readable Stream ===\n");

// Create a readable from an iterable
const nums = Readable.from([1, 2, 3, 4, 5]);
const chunks = [];
for await (const chunk of nums) {
  chunks.push(chunk);
}
console.log("Readable.from() chunks:", chunks);

// Create a readable from a generator
async function* generateLines() {
  yield "Line 1\n";
  yield "Line 2\n";
  yield "Line 3\n";
}

const lineStream = Readable.from(generateLines());
let text = "";
for await (const chunk of lineStream) {
  text += chunk;
}
console.log("From generator:", JSON.stringify(text));

console.log("\n=== File Readable Stream ===\n");

// Create a test file
const filePath = join(tmpdir(), `kata-stream-${Date.now()}.txt`);
const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(80)}\n`);
await writeFile(filePath, lines.join(""));

// Read it as a stream
const fileStream = createReadStream(filePath, { highWaterMark: 256 });

let chunkCount = 0;
let totalBytes = 0;
const chunkSizes = [];

for await (const chunk of fileStream) {
  chunkCount++;
  totalBytes += chunk.length;
  chunkSizes.push(chunk.length);
}

console.log("File size:", totalBytes, "bytes");
console.log("Chunks received:", chunkCount);
console.log("Chunk sizes:", chunkSizes.slice(0, 5).join(", "), "...");
console.log("highWaterMark was: 256 bytes");

console.log("\n=== Stream Events ===\n");

// Observe lifecycle events
const eventStream = createReadStream(filePath, { highWaterMark: 1024 });
const events = [];

eventStream.on("open", () => events.push("open"));
eventStream.on("ready", () => events.push("ready"));
eventStream.on("data", () => events.push("data"));
eventStream.on("end", () => events.push("end"));
eventStream.on("close", () => events.push("close"));

// Consume the stream
// eslint-disable-next-line no-unused-vars
for await (const _ of eventStream) { /* consume */ }

// Wait a tick for close event
await new Promise(r => setTimeout(r, 10));

const uniqueEvents = [...new Set(events)];
console.log("Event order:", uniqueEvents.join(" → "));
console.log("Total data events:", events.filter(e => e === "data").length);

console.log("\n=== Stream Properties ===\n");

const propStream = createReadStream(filePath);
console.log("readable:", propStream.readable);
console.log("readableEncoding:", propStream.readableEncoding);
console.log("readableHighWaterMark:", propStream.readableHighWaterMark);
console.log("readableFlowing:", propStream.readableFlowing, "(null = not started)");

propStream.on("data", () => {});  // Start flowing
console.log("readableFlowing:", propStream.readableFlowing, "(true = flowing)");

propStream.pause();
console.log("readableFlowing:", propStream.readableFlowing, "(false = paused)");

propStream.destroy();

console.log("\n=== Custom Readable ===\n");

// Build a custom Readable that generates data
class CounterStream extends Readable {
  constructor(max) {
    super({ objectMode: true });
    this.current = 0;
    this.max = max;
  }

  _read() {
    if (this.current < this.max) {
      this.current++;
      this.push({ n: this.current, time: Date.now() });
    } else {
      this.push(null);  // Signal end of stream
    }
  }
}

const counter = new CounterStream(5);
for await (const item of counter) {
  console.log("  Item:", item.n);
}

// Cleanup
await unlink(filePath);
console.log("\nCleaned up");
```

## Expected Output

```
=== Creating a Readable Stream ===

Readable.from() chunks: [ 1, 2, 3, 4, 5 ]
From generator: "Line 1\nLine 2\nLine 3\n"

=== File Readable Stream ===

File size: <number> bytes
Chunks received: <number>
Chunk sizes: 256, 256, 256, 256, 256 ...
highWaterMark was: 256 bytes

=== Stream Events ===

Event order: open → ready → data → end → close
Total data events: <number>

=== Stream Properties ===

readable: true
readableEncoding: null
readableHighWaterMark: 65536
readableFlowing: null (null = not started)
readableFlowing: true (true = flowing)
readableFlowing: false (false = paused)

=== Custom Readable ===

  Item: 1
  Item: 2
  Item: 3
  Item: 4
  Item: 5

Cleaned up
```

## Challenge

1. Create a Readable stream that emits the Fibonacci sequence indefinitely. Consume the first 20 numbers using `for await...of` with a manual break
2. Read a file stream with encoding set to `"utf-8"` — how does the chunk type change from Buffer to string? What happens with multi-byte characters split across chunks?
3. Build a Readable that reads from an API with pagination — each `_read()` call fetches the next page and pushes the results

## Deep Dive

The `highWaterMark` controls the internal buffer size. For a file stream with `highWaterMark: 16384` (16 KB, the default), Node.js reads up to 16 KB at a time from disk. If the consumer is slow, data accumulates in the internal buffer up to the high water mark, then reading pauses until the consumer drains it.

`objectMode: true` changes the stream from byte mode to object mode. In byte mode, chunks are Buffers and `highWaterMark` is in bytes. In object mode, chunks can be any JavaScript value and `highWaterMark` is in number of objects.

## Common Mistakes

- Listening to `'data'` without handling backpressure — in flowing mode, data arrives as fast as the source can produce it, potentially overwhelming the consumer
- Not handling the `'error'` event — unhandled stream errors crash the process. Always add an error handler
- Calling `stream.read()` in a loop without checking for `null` — returns `null` when no data is available
- Forgetting `this.push(null)` in a custom Readable — the stream never ends, `for await...of` hangs forever
