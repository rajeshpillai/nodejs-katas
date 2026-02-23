---
id: streaming-apis
phase: 16
phase_title: Advanced Architectures
sequence: 2
title: Streaming APIs
difficulty: advanced
tags: [streaming, ndjson, chunked, transfer-encoding, backpressure, api]
prerequisites: [rest-and-realtime-hybrid]
estimated_minutes: 15
---

## Concept

Traditional REST APIs buffer the entire response before sending it. Streaming APIs send data incrementally as it becomes available.

**Why stream API responses?**
- **Large datasets** — returning 1M rows as JSON requires buffering the entire array in memory
- **Long-running operations** — export jobs, report generation, data migration
- **Real-time data** — log tailing, live metrics, event streams
- **Time to first byte** — clients start processing immediately instead of waiting

**Streaming formats:**

1. **NDJSON (Newline-Delimited JSON)** — one JSON object per line
   ```
   {"id":1,"name":"Alice"}\n
   {"id":2,"name":"Bob"}\n
   {"id":3,"name":"Charlie"}\n
   ```

2. **SSE (Server-Sent Events)** — event stream protocol
   ```
   event: message\ndata: {"text":"hello"}\n\n
   ```

3. **Chunked Transfer Encoding** — HTTP/1.1 chunked responses
   ```
   Transfer-Encoding: chunked
   ```

4. **gRPC streaming** — HTTP/2 bidirectional streaming (not covered here)

**NDJSON is the most common for APIs because:**
- Each line is independently parseable (unlike JSON arrays)
- Can be processed with Unix tools: `curl ... | jq -c .`
- Backpressure-friendly (pause between lines)
- Fault-tolerant (partial response is still useful)

## Key Insight

> The fundamental problem with `res.json([...array])` is that you must build the entire array in memory before sending it. If you're querying 1M rows from PostgreSQL, that's the database result set + the serialized JSON string — potentially gigabytes of memory for a single request. Streaming with NDJSON solves this: you fetch rows in batches (cursor or LIMIT/OFFSET), serialize each row independently, and write it to the response stream. Memory usage stays constant regardless of result set size. The trade-off is that the client must parse line-by-line instead of `JSON.parse()` on the whole body.

## Experiment

```js
console.log("=== Streaming APIs ===\n");

// --- Demo 1: Buffered vs streamed response ---

console.log("--- Buffered vs streamed (memory comparison) ---\n");

function generateRows(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      score: Math.round(Math.random() * 1000),
    });
  }
  return rows;
}

// Buffered: build entire response in memory
function bufferedResponse(rows) {
  const json = JSON.stringify(rows);
  return {
    contentType: "application/json",
    size: json.length,
    peakMemory: json.length + rows.length * 100, // approximate
  };
}

// Streamed: serialize one row at a time
function streamedResponse(rows) {
  let totalSize = 0;
  let maxChunkSize = 0;

  for (const row of rows) {
    const chunk = JSON.stringify(row) + "\n";
    totalSize += chunk.length;
    maxChunkSize = Math.max(maxChunkSize, chunk.length);
  }

  return {
    contentType: "application/x-ndjson",
    size: totalSize,
    peakMemory: maxChunkSize, // Only one row in memory at a time
  };
}

const counts = [100, 1000, 10000, 100000];

console.log(`  ${"Rows".padEnd(10)} ${"Buffered".padEnd(20)} ${"Streamed".padEnd(20)} Memory Savings`);
console.log(`  ${"-".repeat(70)}`);

for (const count of counts) {
  const rows = generateRows(count);
  const buf = bufferedResponse(rows);
  const str = streamedResponse(rows);

  const savings = ((1 - str.peakMemory / buf.peakMemory) * 100).toFixed(1);
  console.log(
    `  ${String(count).padEnd(10)} ` +
    `${(buf.peakMemory / 1024).toFixed(0)}KB peak`.padEnd(20) +
    `${(str.peakMemory / 1024).toFixed(0)}KB peak`.padEnd(20) +
    `${savings}%`
  );
}

// --- Demo 2: NDJSON streaming ---

console.log("\n--- NDJSON streaming ---\n");

class NDJSONStream {
  constructor() {
    this.chunks = [];
    this.bytesWritten = 0;
    this.paused = false;
  }

  write(obj) {
    const line = JSON.stringify(obj) + "\n";
    this.chunks.push(line);
    this.bytesWritten += line.length;
    return !this.paused; // Return false when backpressure needed
  }

  end() {
    this.chunks.push(null); // EOF marker
  }

  getOutput() {
    return this.chunks.filter(c => c !== null).join("");
  }
}

// Simulate streaming a database query result
async function* queryStream(tableName, batchSize) {
  // Simulate cursor-based fetching
  const totalRows = 12;
  let offset = 0;

  while (offset < totalRows) {
    const batch = [];
    const end = Math.min(offset + batchSize, totalRows);
    for (let i = offset; i < end; i++) {
      batch.push({
        id: i + 1,
        name: `${tableName}_${i + 1}`,
        value: Math.round(Math.random() * 100),
      });
    }
    offset = end;
    yield* batch;
  }
}

const stream = new NDJSONStream();

console.log("  Streaming query results (NDJSON):\n");

let rowCount = 0;
for await (const row of queryStream("users", 5)) {
  stream.write(row);
  rowCount++;
}
stream.end();

// Show first few lines
const lines = stream.getOutput().split("\n").filter(Boolean);
for (const line of lines.slice(0, 5)) {
  console.log(`    ${line}`);
}
console.log(`    ... (${lines.length} total rows)`);
console.log(`    Total bytes: ${stream.bytesWritten}`);

// --- Demo 3: Client-side NDJSON parsing ---

console.log("\n--- Client-side NDJSON parsing ---\n");

class NDJSONParser {
  constructor() {
    this.buffer = "";
    this.objects = [];
    this.errors = [];
  }

  // Feed incoming chunks (as they arrive from fetch)
  feed(chunk) {
    this.buffer += chunk;

    // Process complete lines
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop(); // Keep incomplete last line in buffer

    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        this.objects.push(JSON.parse(line));
      } catch (err) {
        this.errors.push({ line, error: err.message });
      }
    }
  }

  // Flush any remaining data
  flush() {
    if (this.buffer.trim()) {
      try {
        this.objects.push(JSON.parse(this.buffer));
      } catch (err) {
        this.errors.push({ line: this.buffer, error: err.message });
      }
      this.buffer = "";
    }
  }
}

// Simulate receiving chunked response
const parser = new NDJSONParser();

// Chunks arrive at network boundaries (not line boundaries!)
const rawData = stream.getOutput();
const chunkSize = 80; // Arbitrary chunk size
const networkChunks = [];
for (let i = 0; i < rawData.length; i += chunkSize) {
  networkChunks.push(rawData.slice(i, i + chunkSize));
}

console.log(`  Received ${networkChunks.length} network chunks:`);
for (let i = 0; i < Math.min(3, networkChunks.length); i++) {
  console.log(`    Chunk ${i + 1}: "${networkChunks[i].replace(/\n/g, "\\n").slice(0, 60)}..."`);
}

for (const chunk of networkChunks) {
  parser.feed(chunk);
}
parser.flush();

console.log(`\n  Parsed: ${parser.objects.length} objects, ${parser.errors.length} errors`);

// --- Demo 4: Streaming with backpressure ---

console.log("\n--- Streaming with backpressure ---\n");

class BackpressureStream {
  constructor(highWaterMark = 5) {
    this.highWaterMark = highWaterMark;
    this.buffer = [];
    this.drained = true;
    this.log = [];
  }

  write(chunk) {
    this.buffer.push(chunk);

    if (this.buffer.length >= this.highWaterMark) {
      this.drained = false;
      this.log.push({ action: "backpressure", bufferSize: this.buffer.length });
      return false; // Signal: stop writing!
    }

    return true;
  }

  // Simulate consumer reading
  read(count = 1) {
    const items = this.buffer.splice(0, count);
    if (!this.drained && this.buffer.length < this.highWaterMark) {
      this.drained = true;
      this.log.push({ action: "drain", bufferSize: this.buffer.length });
    }
    return items;
  }
}

const bpStream = new BackpressureStream(3);

// Producer writes faster than consumer reads
for (let i = 1; i <= 8; i++) {
  const canWrite = bpStream.write({ id: i });
  console.log(`  Write ${i}: buffer=${bpStream.buffer.length}, canWrite=${canWrite}`);

  if (!canWrite) {
    // Consumer catches up
    const consumed = bpStream.read(2);
    console.log(`  Consumer read ${consumed.length} items, buffer=${bpStream.buffer.length}`);
  }
}

console.log(`\n  Backpressure events:`);
for (const entry of bpStream.log) {
  console.log(`    ${entry.action}: buffer size = ${entry.bufferSize}`);
}

// --- Demo 5: HTTP implementation pattern ---

console.log("\n--- HTTP streaming implementation ---\n");

console.log(`  // Server: Stream NDJSON response
  app.get('/api/users/export', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    });

    const cursor = db.query(
      new Cursor('SELECT * FROM users')
    );

    while (true) {
      const rows = await cursor.read(100);  // Batch of 100
      if (rows.length === 0) break;

      for (const row of rows) {
        const canWrite = res.write(JSON.stringify(row) + '\\n');
        if (!canWrite) {
          await new Promise(r => res.once('drain', r));  // Backpressure!
        }
      }
    }

    cursor.close();
    res.end();
  });

  // Client: Parse streaming response
  const response = await fetch('/api/users/export');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line) processUser(JSON.parse(line));
    }
  }
`);

// --- Demo 6: When to stream vs buffer ---

console.log("--- When to stream vs buffer ---\n");

const decisions = [
  ["< 1000 rows, < 1MB", "Buffer (JSON array)", "Simple, cacheable, standard"],
  ["> 10K rows or > 10MB", "Stream (NDJSON)", "Constant memory, fast TTFB"],
  ["Unknown result size", "Stream (NDJSON)", "Can't pre-allocate if size unknown"],
  ["Real-time / live data", "Stream (SSE/NDJSON)", "Data arrives over time"],
  ["Paginated results", "Buffer (JSON)", "Client controls batch size"],
  ["Export / download", "Stream (NDJSON/CSV)", "Could be gigabytes"],
  ["API consumed by browser", "Buffer (JSON)", "Easier to parse, standard"],
  ["API consumed by pipeline", "Stream (NDJSON)", "Unix pipe friendly"],
];

console.log(`  ${"Scenario".padEnd(30)} ${"Approach".padEnd(22)} Reason`);
console.log(`  ${"-".repeat(80)}`);
for (const [scenario, approach, reason] of decisions) {
  console.log(`  ${scenario.padEnd(30)} ${approach.padEnd(22)} ${reason}`);
}
```

## Expected Output

```
=== Streaming APIs ===

--- Buffered vs streamed (memory comparison) ---

  Rows       Buffered             Streamed             Memory Savings
  100        14KB peak            0KB peak             99.5%
  1000       140KB peak           0KB peak             99.9%
  ...

--- NDJSON streaming ---

  Streaming query results (NDJSON):

    {"id":1,"name":"users_1","value":42}
    {"id":2,"name":"users_2","value":87}
    ...
```

## Challenge

1. Build an NDJSON export endpoint: `GET /api/users/export` that streams rows from a database cursor with backpressure. Measure memory usage with 1M rows and compare it to `res.json(allRows)`
2. Implement a streaming search API: `GET /api/search?q=term` that starts sending results as they're found (from multiple sources in parallel) instead of waiting for all sources to complete
3. How would you add pagination to a streaming API? Design a protocol where the client can request "next page" on the same stream without reconnecting

## Common Mistakes

- Building the entire result in memory before streaming — defeats the purpose. Stream row-by-row from the data source
- Not handling backpressure — writing to `res` faster than the network can handle causes unbounded memory growth. Always check `res.write()` return value
- Using JSON arrays for large exports — `[{...},{...},...]` requires the client to buffer the entire response before parsing. NDJSON lets the client process each line immediately
- No content-type header — without `application/x-ndjson`, clients don't know how to parse the response. Always set the correct content type
