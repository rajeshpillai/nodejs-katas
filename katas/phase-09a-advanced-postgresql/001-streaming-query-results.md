---
id: streaming-query-results
phase: 9.5
phase_title: Advanced PostgreSQL in Node.js
sequence: 1
title: Streaming Query Results
difficulty: intermediate
tags: [postgresql, streams, cursor, memory, large-datasets]
prerequisites: [error-handling-db]
estimated_minutes: 15
---

## Concept

When a query returns millions of rows, `pool.query()` loads them all into memory before returning. For large result sets, this can crash your process.

**The problem:**
```js
// Loads ALL rows into memory at once
const result = await pool.query('SELECT * FROM huge_table');
// result.rows = [... 10 million objects ...] → out of memory!
```

**The solution — query streams:**
```js
import QueryStream from 'pg-query-stream';

const query = new QueryStream('SELECT * FROM huge_table');
const client = await pool.connect();
const stream = client.query(query);

stream.on('data', (row) => {
  // Process one row at a time — constant memory
});

stream.on('end', () => client.release());
```

`pg-query-stream` uses a PostgreSQL **cursor** internally. Instead of fetching all rows, it fetches them in batches (default 100 rows at a time) and presents them as a Node.js Readable stream. This means:

- Memory usage stays constant regardless of result set size
- Backpressure works — if you process slowly, the cursor pauses
- You can pipe results directly to transforms, files, or HTTP responses

## Key Insight

> `pool.query()` buffers the entire result set in memory. A cursor-based stream fetches rows in batches and applies backpressure — if your transform or consumer is slow, the database pauses. This lets you process a 10GB result set with 50MB of RAM. The tradeoff: cursor streams require a dedicated client connection for the duration of the stream.

## Experiment

```js
console.log("=== Streaming Query Results ===\n");

// Simulate pg-query-stream behavior
class SimulatedCursorStream {
  constructor(data, options = {}) {
    this.data = data;
    this.batchSize = options.batchSize || 100;
    this.position = 0;
    this.paused = false;
    this.ended = false;
    this.listeners = {};
    this.fetchCount = 0;
    this.totalBytesRead = 0;
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return this;
  }

  emit(event, ...args) {
    for (const fn of this.listeners[event] || []) {
      fn(...args);
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this._read();
  }

  _read() {
    if (this.paused || this.ended) return;

    const batch = this.data.slice(this.position, this.position + this.batchSize);
    this.fetchCount++;

    if (batch.length === 0) {
      this.ended = true;
      this.emit("end");
      return;
    }

    for (const row of batch) {
      const size = JSON.stringify(row).length;
      this.totalBytesRead += size;
      this.emit("data", row);
      this.position++;

      if (this.paused) return; // Backpressure: stop sending
    }

    // Schedule next batch (simulating async fetch)
    setTimeout(() => this._read(), 0);
  }

  start() {
    setTimeout(() => this._read(), 0);
  }
}

// --- Demo 1: Buffered vs streamed memory usage ---

console.log("--- Memory comparison: buffered vs streamed ---\n");

// Generate a large dataset
const totalRows = 10000;
const generateRow = (i) => ({
  id: i,
  name: `user_${i}`,
  email: `user${i}@example.com`,
  bio: "x".repeat(200), // ~200 bytes per row
});

// Approach 1: Buffer everything (like pool.query)
const allRows = Array.from({ length: totalRows }, (_, i) => generateRow(i));
const bufferedSize = JSON.stringify(allRows).length;
console.log(`Buffered approach (pool.query):`);
console.log(`  Rows: ${totalRows}`);
console.log(`  Memory: ~${(bufferedSize / 1024 / 1024).toFixed(1)} MB (all in memory at once)\n`);

// Approach 2: Stream with cursor
console.log(`Streaming approach (cursor, batchSize=100):`);
console.log(`  Rows: ${totalRows}`);
const batchMemory = JSON.stringify(allRows.slice(0, 100)).length;
console.log(`  Memory: ~${(batchMemory / 1024).toFixed(1)} KB per batch (constant)\n`);

// --- Demo 2: Streaming with backpressure ---

console.log("--- Streaming with batch processing ---\n");

const smallData = Array.from({ length: 500 }, (_, i) => ({
  id: i + 1,
  name: `item_${i + 1}`,
  value: Math.round(Math.random() * 1000),
}));

await new Promise((resolve) => {
  const stream = new SimulatedCursorStream(smallData, { batchSize: 100 });
  let processed = 0;
  let sum = 0;

  stream.on("data", (row) => {
    processed++;
    sum += row.value;
  });

  stream.on("end", () => {
    console.log(`  Processed: ${processed} rows in ${stream.fetchCount} fetches`);
    console.log(`  Sum of values: ${sum}`);
    console.log(`  Batch size: 100 rows per fetch\n`);
    resolve();
  });

  stream.start();
});

// --- Demo 3: Stream → transform → output ---

console.log("--- Stream pipeline: query → transform → aggregate ---\n");

const salesData = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1,
  product: ["Widget", "Gadget", "Doohickey"][i % 3],
  amount: Math.round(Math.random() * 100 * 100) / 100,
  date: `2024-${String((i % 12) + 1).padStart(2, "0")}-15`,
}));

await new Promise((resolve) => {
  const stream = new SimulatedCursorStream(salesData, { batchSize: 200 });

  // Aggregate by product (running totals)
  const totals = {};
  let rowCount = 0;

  stream.on("data", (row) => {
    rowCount++;
    if (!totals[row.product]) {
      totals[row.product] = { count: 0, total: 0 };
    }
    totals[row.product].count++;
    totals[row.product].total += row.amount;
  });

  stream.on("end", () => {
    console.log(`  Aggregated ${rowCount} sales records:\n`);
    for (const [product, stats] of Object.entries(totals)) {
      console.log(`    ${product}: ${stats.count} sales, $${stats.total.toFixed(2)} total, $${(stats.total / stats.count).toFixed(2)} avg`);
    }
    console.log(`\n  Fetched in ${stream.fetchCount} batches (constant memory)\n`);
    resolve();
  });

  stream.start();
});

// --- Demo 4: Streaming to JSON lines ---

console.log("--- Pattern: Stream to JSONL (newline-delimited JSON) ---\n");

await new Promise((resolve) => {
  const data = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    event: "page_view",
    url: `/page/${i + 1}`,
  }));

  const stream = new SimulatedCursorStream(data, { batchSize: 3 });
  const lines = [];

  stream.on("data", (row) => {
    lines.push(JSON.stringify(row));
  });

  stream.on("end", () => {
    console.log("  JSONL output (first 5 lines):");
    for (const line of lines.slice(0, 5)) {
      console.log(`    ${line}`);
    }
    console.log(`    ... (${lines.length} total lines)\n`);
    resolve();
  });

  stream.start();
});

console.log("=== pg-query-stream Usage Patterns ===\n");

console.log("Pattern 1: Basic stream");
console.log(`
  import QueryStream from 'pg-query-stream';

  const client = await pool.connect();
  const query = new QueryStream(
    'SELECT * FROM events WHERE created_at > $1',
    [since],
    { batchSize: 256 }  // Rows per cursor FETCH
  );
  const stream = client.query(query);

  stream.on('data', (row) => process(row));
  stream.on('end', () => client.release());
  stream.on('error', (err) => {
    client.release();
    console.error(err);
  });
`);

console.log("Pattern 2: Pipeline to HTTP response");
console.log(`
  app.get('/export', async (req, res) => {
    const client = await pool.connect();
    const query = new QueryStream('SELECT * FROM users');
    const stream = client.query(query);

    res.setHeader('Content-Type', 'application/x-ndjson');

    const { pipeline } = await import('stream/promises');
    const { Transform } = await import('stream');

    const toJsonl = new Transform({
      objectMode: true,
      transform(row, enc, cb) {
        cb(null, JSON.stringify(row) + '\\n');
      }
    });

    await pipeline(stream, toJsonl, res);
    client.release();
  });
`);

console.log("Pattern 3: Batch processing with pause/resume");
console.log(`
  const BATCH = 1000;
  let buffer = [];

  stream.on('data', (row) => {
    buffer.push(row);
    if (buffer.length >= BATCH) {
      stream.pause();
      processBatch(buffer).then(() => {
        buffer = [];
        stream.resume();
      });
    }
  });
`);
```

## Expected Output

```
=== Streaming Query Results ===

--- Memory comparison: buffered vs streamed ---

Buffered approach (pool.query):
  Rows: 10000
  Memory: ~3.1 MB (all in memory at once)

Streaming approach (cursor, batchSize=100):
  Rows: 10000
  Memory: ~31.0 KB per batch (constant)

--- Streaming with batch processing ---

  Processed: 500 rows in 5 fetches
  Sum of values: <varies>
  Batch size: 100 rows per fetch

--- Stream pipeline: query → transform → aggregate ---

  Aggregated 1000 sales records:

    Widget: 334 sales, $<total> total, $<avg> avg
    Gadget: 333 sales, $<total> total, $<avg> avg
    Doohickey: 333 sales, $<total> total, $<avg> avg

  Fetched in 5 batches (constant memory)
  ...
```

## Challenge

1. Implement a `streamToFile` function that streams query results to a CSV file, handling backpressure properly between the database cursor and the file write stream
2. What happens if the client connection is released before the stream finishes? Build a safety wrapper that ensures the client is only released after `end` or `error`
3. Compare memory usage of `pool.query()` vs cursor stream for 1M rows — measure with `process.memoryUsage()`

## Deep Dive

PostgreSQL cursors vs buffered queries:

| Aspect | `pool.query()` | Cursor stream |
|--------|----------------|---------------|
| Memory | All rows in RAM | Batch size rows |
| Latency to first row | High (waits for all) | Low (first batch) |
| Connection hold time | Short (single round-trip) | Long (entire stream) |
| Backpressure | None | Yes (Node.js streams) |
| Use case | Small results (<10K rows) | Large exports, ETL |

The cursor issues `DECLARE cursor_name CURSOR FOR ...` then `FETCH 100 FROM cursor_name` repeatedly. The connection must stay open and in the same transaction for the cursor to work.

## Common Mistakes

- Using `pool.query()` for large exports — loads everything into memory, crashes the process
- Forgetting to release the client after a stream ends — connection leaks from the pool
- Not handling stream errors — an error without a handler crashes the process
- Using cursor streams for small queries — the overhead of DECLARE/FETCH is slower than a single buffered query for small results
