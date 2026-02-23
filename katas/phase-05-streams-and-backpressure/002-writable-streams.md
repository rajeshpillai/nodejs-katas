---
id: writable-streams
phase: 5
phase_title: Streams & Backpressure
sequence: 2
title: Writable Streams
difficulty: intermediate
tags: [streams, writable, drain, finish, backpressure]
prerequisites: [readable-streams]
estimated_minutes: 15
---

## Concept

A Writable stream is a destination for data — a file, a network socket, an HTTP response, `process.stdout`. You push chunks into it, and it writes them somewhere.

The critical method is `writable.write(chunk)`. It returns:
- **`true`** — the internal buffer is below the high water mark, keep writing
- **`false`** — the buffer is full, **stop writing** and wait for the `'drain'` event

This return value is the heart of backpressure. If you ignore it and keep calling `write()`, the internal buffer grows unbounded — you'll consume all available memory. Respecting `write()` returning `false` is what makes streams memory-safe.

Every `fs.createWriteStream()`, HTTP response, `process.stdout`, TCP socket, and child process stdin is a Writable stream.

## Key Insight

> The `write()` method returning `false` is not an error — it's a signal. It says "I'm overwhelmed, stop sending data until I say I'm ready." This is backpressure, and respecting it is the difference between a program that handles any data size and one that crashes on large inputs.

## Experiment

```js
import { Writable } from "stream";
import { createWriteStream } from "fs";
import { stat, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

console.log("=== Basic Writable Stream ===\n");

const filePath = join(tmpdir(), `kata-writable-${Date.now()}.txt`);
const ws = createWriteStream(filePath);

// write() is synchronous in appearance but async in reality
ws.write("First line\n");
ws.write("Second line\n");
ws.write("Third line\n");
ws.end("Final line\n");  // end() writes last chunk and signals done

// Wait for finish
await new Promise((resolve, reject) => {
  ws.on("finish", resolve);
  ws.on("error", reject);
});

const info = await stat(filePath);
console.log("File written:", info.size, "bytes");

console.log("\n=== write() Return Value ===\n");

// Demonstrate backpressure signal
const slowPath = join(tmpdir(), `kata-slow-${Date.now()}.txt`);
const slow = createWriteStream(slowPath, { highWaterMark: 16 });  // tiny buffer

let writeCount = 0;
let drainNeeded = 0;

for (let i = 0; i < 20; i++) {
  const canContinue = slow.write(`Chunk ${i}: ${"x".repeat(20)}\n`);
  writeCount++;
  if (!canContinue) {
    drainNeeded++;
  }
}
slow.end();

await new Promise(resolve => slow.on("finish", resolve));

console.log("Writes:", writeCount);
console.log("Times write() returned false:", drainNeeded);
console.log("  (should wait for 'drain' each time!)");

console.log("\n=== Correct Backpressure Pattern ===\n");

const bpPath = join(tmpdir(), `kata-bp-${Date.now()}.txt`);
const bpStream = createWriteStream(bpPath, { highWaterMark: 64 });

async function writeWithBackpressure(stream, data) {
  for (const chunk of data) {
    const ok = stream.write(chunk);
    if (!ok) {
      // Buffer full — wait for drain before continuing
      await new Promise(resolve => stream.once("drain", resolve));
    }
  }
  stream.end();
  await new Promise(resolve => stream.on("finish", resolve));
}

const data = Array.from({ length: 50 }, (_, i) => `Line ${i}: ${"=".repeat(30)}\n`);
await writeWithBackpressure(bpStream, data);

const bpInfo = await stat(bpPath);
console.log("Written with backpressure:", bpInfo.size, "bytes");

console.log("\n=== Custom Writable ===\n");

// A writable that collects data in memory (like a test spy)
class CollectorStream extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.totalBytes = 0;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    // callback() signals "I'm done processing this chunk"
    // Call with an error to signal a write failure
    callback();
  }

  getData() {
    return Buffer.concat(this.chunks);
  }
}

const collector = new CollectorStream();
collector.write("Hello ");
collector.write("from ");
collector.write("custom stream!");
collector.end();

await new Promise(resolve => collector.on("finish", resolve));

console.log("Collected:", collector.getData().toString());
console.log("Total bytes:", collector.totalBytes);
console.log("Chunks:", collector.chunks.length);

console.log("\n=== Writable Events ===\n");

const eventPath = join(tmpdir(), `kata-events-${Date.now()}.txt`);
const eventStream = createWriteStream(eventPath);
const events = [];

eventStream.on("open", () => events.push("open"));
eventStream.on("ready", () => events.push("ready"));
eventStream.on("pipe", () => events.push("pipe"));
eventStream.on("drain", () => events.push("drain"));
eventStream.on("finish", () => events.push("finish"));
eventStream.on("close", () => events.push("close"));

eventStream.write("data");
eventStream.end();

await new Promise(resolve => eventStream.on("close", resolve));

console.log("Event order:", events.join(" → "));

console.log("\n=== Stream Properties ===\n");

const propStream = createWriteStream(join(tmpdir(), `kata-props-${Date.now()}.txt`));
console.log("writable:", propStream.writable);
console.log("writableHighWaterMark:", propStream.writableHighWaterMark);
console.log("writableLength:", propStream.writableLength, "(buffered bytes)");

propStream.write("test data");
console.log("writableLength after write:", propStream.writableLength);

propStream.end();
await new Promise(resolve => propStream.on("finish", resolve));
console.log("writableFinished:", propStream.writableFinished);

// Cleanup
await Promise.all([
  unlink(filePath),
  unlink(slowPath),
  unlink(bpPath),
  unlink(eventPath),
]);
console.log("\nCleaned up");
```

## Expected Output

```
=== Basic Writable Stream ===

File written: <number> bytes

=== write() Return Value ===

Writes: 20
Times write() returned false: <number>
  (should wait for 'drain' each time!)

=== Correct Backpressure Pattern ===

Written with backpressure: <number> bytes

=== Custom Writable ===

Collected: Hello from custom stream!
Total bytes: 25
Chunks: 3

=== Writable Events ===

Event order: open → ready → finish → close

=== Stream Properties ===

writable: true
writableHighWaterMark: 16384
writableLength: 0 (buffered bytes)
writableLength after write: <number>
writableFinished: true

Cleaned up
```

## Challenge

1. Write a Writable stream that counts words and lines in the incoming data — report totals in the `_final()` callback
2. Implement a rate-limited writable that writes at most N bytes per second, using `setTimeout` in `_write()` to delay the callback
3. Write 1 GB of data to a file using proper backpressure — verify memory usage stays constant using `process.memoryUsage()`

## Deep Dive

The `_write(chunk, encoding, callback)` method in custom Writables:
- `chunk` — the data to write (Buffer in byte mode, any value in object mode)
- `encoding` — the encoding if chunk was a string (usually `'utf-8'` or `'buffer'`)
- `callback(err?)` — **must be called** when done processing. Call with an Error to signal failure. If you never call the callback, the stream stalls forever

There's also `_writev(chunks, callback)` for batch writes — called when multiple writes are queued. Each item in `chunks` is `{ chunk, encoding }`. This is useful for database batch inserts or network write coalescing.

## Common Mistakes

- Ignoring the return value of `write()` — leads to unbounded memory growth with large data
- Calling `write()` after `end()` — throws an error, the stream is closed
- Not calling the callback in `_write()` — the stream hangs, no more data is accepted
- Using `on('drain')` instead of `once('drain')` — the drain handler stays registered forever, creating a memory leak with many drain cycles
