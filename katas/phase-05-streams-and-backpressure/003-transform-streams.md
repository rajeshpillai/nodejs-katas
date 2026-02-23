---
id: transform-streams
phase: 5
phase_title: Streams & Backpressure
sequence: 3
title: Transform Streams
difficulty: intermediate
tags: [streams, transform, duplex, pipeline, data-processing]
prerequisites: [writable-streams]
estimated_minutes: 15
---

## Concept

A Transform stream is both Readable and Writable — data goes in one side, gets transformed, and comes out the other. It's a data processing pipeline stage.

Common built-in transforms:
- `zlib.createGzip()` / `zlib.createGunzip()` — compression/decompression
- `crypto.createCipheriv()` / `crypto.createDecipheriv()` — encryption/decryption
- `stream.PassThrough` — passes data through unchanged (useful for tapping/monitoring)

You build custom transforms by implementing `_transform(chunk, encoding, callback)`. Call `this.push(outputChunk)` to emit transformed data, then call `callback()` to signal you're ready for the next chunk. You can push zero, one, or many output chunks per input chunk.

Transform streams respect backpressure in both directions: if the downstream consumer is slow, the transform slows down, which slows down the upstream source.

## Key Insight

> Transform streams are the composable units of data processing. Need to read a file, decompress it, parse each line as JSON, filter certain records, and write results? That's five stream stages piped together, each doing one thing, all respecting backpressure automatically.

## Experiment

```js
import { Transform, Readable, pipeline } from "stream";
import { promisify } from "util";

const pipelineAsync = promisify(pipeline);

console.log("=== Basic Transform ===\n");

// Transform that uppercases text
class UpperCase extends Transform {
  _transform(chunk, encoding, callback) {
    this.push(chunk.toString().toUpperCase());
    callback();
  }
}

const upper = new UpperCase();
const source = Readable.from(["hello ", "world ", "from ", "transforms!"]);

const chunks = [];
source.pipe(upper);

for await (const chunk of upper) {
  chunks.push(chunk.toString());
}
console.log("Uppercased:", chunks.join(""));

console.log("\n=== Transform with State ===\n");

// Line counter transform — adds line numbers
class LineNumberer extends Transform {
  constructor() {
    super();
    this.lineNum = 0;
    this.remainder = "";
  }

  _transform(chunk, encoding, callback) {
    const text = this.remainder + chunk.toString();
    const lines = text.split("\n");

    // Last element might be incomplete
    this.remainder = lines.pop();

    for (const line of lines) {
      this.lineNum++;
      this.push(`${String(this.lineNum).padStart(3)}: ${line}\n`);
    }
    callback();
  }

  _flush(callback) {
    // Handle any remaining data
    if (this.remainder) {
      this.lineNum++;
      this.push(`${String(this.lineNum).padStart(3)}: ${this.remainder}\n`);
    }
    callback();
  }
}

const input = Readable.from([
  "const x = 1;\n",
  "const y = 2;\ncons",
  "ole.log(x + y);\n",
]);

const numberer = new LineNumberer();

let result = "";
input.pipe(numberer);
for await (const chunk of numberer) {
  result += chunk;
}
console.log("Numbered code:");
console.log(result);

console.log("=== One-to-Many Transform ===\n");

// Transform that splits CSV lines into individual field objects
class CsvParser extends Transform {
  constructor(headers) {
    super({ objectMode: true });  // Output is objects, not buffers
    this.headers = headers;
    this.remainder = "";
  }

  _transform(chunk, encoding, callback) {
    const text = this.remainder + chunk.toString();
    const lines = text.split("\n");
    this.remainder = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        const values = line.split(",");
        const obj = {};
        this.headers.forEach((h, i) => { obj[h] = values[i]?.trim(); });
        this.push(obj);  // Push one object per CSV line
      }
    }
    callback();
  }

  _flush(callback) {
    if (this.remainder.trim()) {
      const values = this.remainder.split(",");
      const obj = {};
      this.headers.forEach((h, i) => { obj[h] = values[i]?.trim(); });
      this.push(obj);
    }
    callback();
  }
}

const csv = Readable.from([
  "Alice,30,Engineer\n",
  "Bob,25,Designer\nCharl",
  "ie,35,Manager\n",
]);

const parser = new CsvParser(["name", "age", "role"]);
csv.pipe(parser);

const records = [];
for await (const record of parser) {
  records.push(record);
}
console.log("Parsed CSV records:");
records.forEach(r => console.log(" ", r));

console.log("\n=== Chaining Transforms ===\n");

// Filter transform — only passes through items matching a predicate
class FilterTransform extends Transform {
  constructor(predicate) {
    super({ objectMode: true });
    this.predicate = predicate;
    this.passed = 0;
    this.filtered = 0;
  }

  _transform(chunk, encoding, callback) {
    if (this.predicate(chunk)) {
      this.push(chunk);
      this.passed++;
    } else {
      this.filtered++;
    }
    callback();
  }
}

// Map transform
class MapTransform extends Transform {
  constructor(fn) {
    super({ objectMode: true });
    this.fn = fn;
  }

  _transform(chunk, encoding, callback) {
    this.push(this.fn(chunk));
    callback();
  }
}

const data = Readable.from([
  { name: "Alice", score: 85 },
  { name: "Bob", score: 42 },
  { name: "Charlie", score: 91 },
  { name: "Diana", score: 67 },
  { name: "Eve", score: 95 },
]);

const filter = new FilterTransform(item => item.score >= 70);
const mapper = new MapTransform(item => `${item.name}: ${item.score} (PASS)`);

// Chain: data → filter → mapper
await pipelineAsync(data, filter, mapper, async function* (source) {
  for await (const item of source) {
    console.log(" ", item);
  }
});

console.log(`\n  Passed: ${filter.passed}, Filtered: ${filter.filtered}`);

console.log("\n=== PassThrough for Monitoring ===\n");

const { PassThrough } = await import("stream");

const monitor = new PassThrough();
let bytesSeen = 0;

monitor.on("data", (chunk) => {
  bytesSeen += chunk.length;
});

const source2 = Readable.from(["chunk1", "chunk2", "chunk3"]);
const upper2 = new UpperCase();

// Insert monitor between source and transform
source2.pipe(monitor).pipe(upper2);

let output = "";
for await (const chunk of upper2) {
  output += chunk;
}
console.log("Output:", output);
console.log("Bytes monitored:", bytesSeen);
```

## Expected Output

```
=== Basic Transform ===

Uppercased: HELLO WORLD FROM TRANSFORMS!

=== Transform with State ===

Numbered code:
  1: const x = 1;
  2: const y = 2;
  3: console.log(x + y);

=== One-to-Many Transform ===

Parsed CSV records:
  { name: 'Alice', age: '30', role: 'Engineer' }
  { name: 'Bob', age: '25', role: 'Designer' }
  { name: 'Charlie', age: '35', role: 'Manager' }

=== Chaining Transforms ===

  Alice: 85 (PASS)
  Charlie: 91 (PASS)
  Eve: 95 (PASS)

  Passed: 3, Filtered: 2

=== PassThrough for Monitoring ===

Output: CHUNK1CHUNK2CHUNK3
Bytes monitored: 18
```

## Challenge

1. Build a JSON lines (NDJSON) parser transform — each line of input is a JSON object, emit the parsed objects in object mode
2. Create a transform that implements a sliding window average — for each incoming number, emit the average of the last N numbers
3. Write a compression pipeline: read a file → gzip transform → write compressed file. Then read compressed → gunzip → verify contents match

## Deep Dive

`_flush(callback)` is called when the upstream source has ended but before the Transform emits its `'end'` event. This is where you process any buffered data. Common use cases:
- Emit the last partial line in a line-splitting transform
- Flush aggregated results (counts, averages, summaries)
- Write trailing bytes for a format (like closing brackets for JSON arrays)

If your transform doesn't implement `_flush`, any buffered state is silently lost when the stream ends.

## Common Mistakes

- Forgetting `_flush()` — data buffered in the transform is lost when the source ends
- Not calling `callback()` in `_transform` — the stream stalls, no more data is processed
- Mixing object mode and byte mode in a pipeline — a byte-mode transform receiving objects will call `.toString()` on them, producing `"[object Object]"`
- Pushing in the callback instead of before it — `callback()` signals "ready for next chunk." Push first, then call callback
