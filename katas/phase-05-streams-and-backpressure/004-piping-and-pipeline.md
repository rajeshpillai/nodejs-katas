---
id: piping-and-pipeline
phase: 5
phase_title: Streams & Backpressure
sequence: 4
title: Piping and Pipeline
difficulty: intermediate
tags: [streams, pipe, pipeline, error-handling, composition]
prerequisites: [transform-streams]
estimated_minutes: 15
---

## Concept

`pipe()` and `pipeline()` connect streams together, creating data processing chains. Data flows from source through transforms to destination, with backpressure handled automatically.

**`source.pipe(dest)`** — the original API:
- Connects source's output to dest's input
- Handles backpressure (pauses source when dest is overwhelmed)
- Returns `dest` (enabling chaining: `a.pipe(b).pipe(c)`)
- **Does NOT propagate errors** — this is its critical flaw

**`stream.pipeline(source, ...transforms, dest, callback)`** — the modern API:
- Connects all streams in sequence
- **Propagates errors** — if any stream errors, all streams are destroyed
- **Cleans up resources** — no leaked file descriptors or dangling streams
- Has a promise version via `stream/promises`

Always use `pipeline()` in production code. `pipe()` leaks resources on error.

## Key Insight

> `pipe()` is ergonomic but dangerous — it doesn't handle errors. If a transform throws or a file read fails, the other streams in the chain stay open, leaking file descriptors and memory. `pipeline()` was created specifically to fix this: it destroys all streams when any one fails.

## Experiment

```js
import { Readable, Transform, Writable, pipeline } from "stream";
import { pipeline as pipelinePromise } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createGzip, createGunzip } from "zlib";

console.log("=== Basic Pipe ===\n");

// source.pipe(dest) returns dest — enabling chains
class Upper extends Transform {
  _transform(chunk, enc, cb) {
    this.push(chunk.toString().toUpperCase());
    cb();
  }
}

class Exclaim extends Transform {
  _transform(chunk, enc, cb) {
    this.push(chunk.toString().replace(/\n/g, "!!!\n"));
    cb();
  }
}

const source = Readable.from(["hello\n", "world\n", "streams\n"]);
const upper = new Upper();
const exclaim = new Exclaim();
const chunks = [];

// Chain: source → upper → exclaim
source.pipe(upper).pipe(exclaim);

for await (const chunk of exclaim) {
  chunks.push(chunk.toString());
}
console.log("Piped result:", chunks.join(""));

console.log("=== pipeline() with Promises ===\n");

// File → Gzip → File
const inputPath = join(tmpdir(), `kata-pipe-input-${Date.now()}.txt`);
const gzipPath = inputPath + ".gz";
const outputPath = inputPath + ".restored";

// Create test data
const testData = "Hello from pipeline!\n".repeat(100);
await writeFile(inputPath, testData);

// Compress with pipeline
await pipelinePromise(
  createReadStream(inputPath),
  createGzip(),
  createWriteStream(gzipPath)
);

// Decompress with pipeline
await pipelinePromise(
  createReadStream(gzipPath),
  createGunzip(),
  createWriteStream(outputPath)
);

const restored = await readFile(outputPath, "utf-8");
console.log("Original size:", Buffer.byteLength(testData), "bytes");
const { stat: statFn } = await import("fs/promises");
const gzInfo = await statFn(gzipPath);
console.log("Compressed size:", gzInfo.size, "bytes");
console.log("Data integrity:", restored === testData ? "MATCH" : "MISMATCH");

console.log("\n=== Pipeline Error Handling ===\n");

// When any stream in the pipeline fails, all streams are cleaned up
class FailingTransform extends Transform {
  constructor(failAfter) {
    super();
    this.count = 0;
    this.failAfter = failAfter;
  }

  _transform(chunk, enc, cb) {
    this.count++;
    if (this.count > this.failAfter) {
      cb(new Error(`Failed after ${this.failAfter} chunks`));
    } else {
      this.push(chunk);
      cb();
    }
  }
}

try {
  await pipelinePromise(
    Readable.from(["a", "b", "c", "d", "e"]),
    new FailingTransform(3),
    new Upper()
  );
} catch (err) {
  console.log("Pipeline caught error:", err.message);
}

console.log("\n=== pipe() Does NOT Handle Errors ===\n");

// Demonstrate the pipe() error problem
const badSource = new Readable({
  read() {
    this.destroy(new Error("Source exploded"));
  }
});

const collector = new Writable({
  write(chunk, enc, cb) { cb(); }
});

// pipe() doesn't propagate the error to collector
badSource.pipe(collector);

// Must handle errors on EACH stream manually with pipe()
badSource.on("error", (err) => {
  console.log("Source error (manual handler):", err.message);
  collector.destroy();  // Must manually clean up!
});

await new Promise(resolve => setTimeout(resolve, 50));

console.log("\n=== Pipeline with Async Generators ===\n");

// pipeline() supports async generators as transform stages
async function* filterLines(source) {
  for await (const chunk of source) {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.includes("ERROR")) {
        yield line + "\n";
      }
    }
  }
}

async function* addTimestamp(source) {
  for await (const chunk of source) {
    yield `[${new Date().toISOString()}] ${chunk}`;
  }
}

const logData = Readable.from([
  "INFO: Server started\n",
  "ERROR: Connection refused\n",
  "INFO: Request handled\n",
  "ERROR: Timeout exceeded\n",
  "INFO: Shutting down\n",
]);

const results = [];
await pipelinePromise(
  logData,
  filterLines,
  addTimestamp,
  async function* (source) {
    for await (const chunk of source) {
      results.push(chunk.toString().trim());
    }
  }
);

console.log("Filtered log lines:");
for (const line of results) {
  console.log(" ", line);
}

// Cleanup
await Promise.all([
  unlink(inputPath),
  unlink(gzipPath),
  unlink(outputPath),
]);
console.log("\nCleaned up");
```

## Expected Output

```
=== Basic Pipe ===

Piped result: HELLO!!!
WORLD!!!
STREAMS!!!

=== pipeline() with Promises ===

Original size: 2100 bytes
Compressed size: <number> bytes
Data integrity: MATCH

=== Pipeline Error Handling ===

Pipeline caught error: Failed after 3 chunks

=== pipe() Does NOT Handle Errors ===

Source error (manual handler): Source exploded

=== Pipeline with Async Generators ===

Filtered log lines:
  [<timestamp>] ERROR: Connection refused
  [<timestamp>] ERROR: Timeout exceeded

Cleaned up
```

## Challenge

1. Build a log processing pipeline: read a log file → parse each line as JSON → filter by level === "error" → format as human-readable → write to output file. Use `pipeline()` with async generators
2. Create a pipeline that downloads a file (simulated with a Readable), calculates its SHA-256 hash while writing it to disk (using a PassThrough + crypto), and reports the hash at the end
3. What happens when you call `source.pipe(dest)` multiple times with different sources? Can a writable receive from multiple readables?

## Deep Dive

`pipeline()` with async generators (Node.js 16+) is powerful because you can write transform logic as plain async functions — no need to subclass Transform:

```
await pipeline(
  source,
  async function* (source) {
    for await (const chunk of source) {
      yield transform(chunk);
    }
  },
  dest
);
```

This is often cleaner than creating a Transform subclass, especially for simple transformations. The generator handles backpressure automatically — `yield` waits if the downstream is overwhelmed.

## Common Mistakes

- Using `pipe()` without error handling on every stream — resource leaks guaranteed
- Forgetting that `pipe()` returns the destination, not the source — `source.pipe(a).pipe(b)` pipes `a` to `b`, not `source` to `b`
- Not using the promise version of `pipeline` — the callback version is harder to use with async/await
- Piping to a stream that's already ended — silently drops data or throws, depending on timing
