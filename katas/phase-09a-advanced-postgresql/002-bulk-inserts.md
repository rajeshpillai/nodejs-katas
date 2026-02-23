---
id: bulk-inserts
phase: 9.5
phase_title: Advanced PostgreSQL in Node.js
sequence: 2
title: Bulk Inserts and COPY
difficulty: intermediate
tags: [postgresql, bulk, copy, performance, batch]
prerequisites: [streaming-query-results]
estimated_minutes: 15
---

## Concept

Inserting rows one at a time is slow. Each `INSERT` is a separate round-trip to the database, and each round-trip includes network latency, query parsing, and WAL logging overhead.

**Slow — one row at a time:**
```js
for (const user of users) {
  await pool.query('INSERT INTO users (name, email) VALUES ($1, $2)', [user.name, user.email]);
}
// 10,000 users = 10,000 round-trips = slow
```

**Fast — multi-row INSERT:**
```js
// INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4), ($5, $6), ...
const values = [];
const params = [];
users.forEach((u, i) => {
  values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
  params.push(u.name, u.email);
});
await pool.query(`INSERT INTO users (name, email) VALUES ${values.join(', ')}`, params);
// 1 round-trip regardless of row count
```

**Fastest — COPY protocol:**
```js
import { from as copyFrom } from 'pg-copy-streams';

const client = await pool.connect();
const stream = client.query(copyFrom('COPY users (name, email) FROM STDIN WITH CSV'));
for (const user of users) {
  stream.write(`${user.name},${user.email}\n`);
}
stream.end();
```

`COPY` bypasses the SQL parser entirely and streams raw data directly into the table. It's 5-10x faster than multi-row INSERT for large datasets.

## Key Insight

> Single-row INSERTs pay the full query processing cost per row. Multi-row INSERTs amortize parsing/planning over many rows in one statement. COPY bypasses SQL entirely — it streams raw CSV/binary directly into the table's storage. For 100K+ rows, COPY is the only reasonable choice. The tradeoff: COPY is all-or-nothing (no partial success) and doesn't return generated IDs.

## Experiment

```js
console.log("=== Bulk Insert Strategies ===\n");

// Simulated database for benchmarking
class BulkDB {
  constructor() {
    this.tables = new Map();
    this.queryCount = 0;
    this.totalRows = 0;
  }

  createTable(name) {
    this.tables.set(name, []);
  }

  // Simulate single INSERT
  insertOne(table, row) {
    this.queryCount++;
    this.tables.get(table).push(row);
    this.totalRows++;
  }

  // Simulate multi-row INSERT
  insertMany(table, rows) {
    this.queryCount++;
    this.tables.get(table).push(...rows);
    this.totalRows += rows.length;
  }

  // Simulate COPY (bulk stream)
  copyIn(table, rows) {
    this.queryCount++;  // Single COPY command
    this.tables.get(table).push(...rows);
    this.totalRows += rows.length;
  }

  getRowCount(table) {
    return this.tables.get(table).length;
  }

  reset(table) {
    this.tables.set(table, []);
    this.queryCount = 0;
    this.totalRows = 0;
  }
}

// Generate test data
function generateUsers(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `user_${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
  }));
}

const db = new BulkDB();
db.createTable("users");

const testSizes = [100, 1000, 5000];

console.log("--- Strategy 1: Single-row INSERT (one at a time) ---\n");

for (const size of testSizes) {
  db.reset("users");
  const users = generateUsers(size);
  const start = performance.now();

  for (const user of users) {
    db.insertOne("users", user);
  }

  const elapsed = performance.now() - start;
  console.log(`  ${size} rows: ${db.queryCount} queries, ${elapsed.toFixed(2)}ms`);
}

console.log("\n--- Strategy 2: Multi-row INSERT (batched) ---\n");

function buildMultiRowInsert(rows, columns) {
  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const row of rows) {
    const placeholders = columns.map(() => `$${paramIdx++}`);
    values.push(`(${placeholders.join(", ")})`);
    for (const col of columns) {
      params.push(row[col]);
    }
  }

  return {
    sql: `INSERT INTO users (${columns.join(", ")}) VALUES ${values.join(", ")}`,
    params,
    paramCount: params.length,
  };
}

// Show the SQL for a small batch
const smallBatch = generateUsers(3);
const query = buildMultiRowInsert(smallBatch, ["name", "email", "age"]);
console.log("  Example SQL (3 rows):");
console.log(`    ${query.sql}`);
console.log(`    Params: [${query.params.slice(0, 9).map(p => JSON.stringify(p)).join(", ")}]`);
console.log(`    Total params: ${query.paramCount}\n`);

// Benchmark batched inserts
const BATCH_SIZE = 500;  // PostgreSQL parameter limit is 65535

for (const size of testSizes) {
  db.reset("users");
  const users = generateUsers(size);
  const start = performance.now();

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    db.insertMany("users", batch);
  }

  const elapsed = performance.now() - start;
  console.log(`  ${size} rows: ${db.queryCount} queries (batch=${BATCH_SIZE}), ${elapsed.toFixed(2)}ms`);
}

console.log("\n--- Strategy 3: COPY (streaming bulk load) ---\n");

// Simulate COPY FROM STDIN format
function formatCopyRow(row, columns) {
  return columns.map(col => {
    const val = row[col];
    if (val === null || val === undefined) return "\\N";
    const str = String(val);
    // Escape tabs and newlines for COPY format
    return str.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
  }).join("\t");
}

const sampleUsers = generateUsers(5);
const columns = ["name", "email", "age"];

console.log("  COPY format (tab-separated, first 5 rows):");
for (const user of sampleUsers) {
  console.log(`    ${formatCopyRow(user, columns)}`);
}

console.log();

for (const size of testSizes) {
  db.reset("users");
  const users = generateUsers(size);
  const start = performance.now();

  db.copyIn("users", users);

  const elapsed = performance.now() - start;
  console.log(`  ${size} rows: ${db.queryCount} query (COPY), ${elapsed.toFixed(2)}ms`);
}

console.log("\n--- Query count comparison ---\n");

const compareSize = 5000;

console.log(`  For ${compareSize} rows:`);
console.log(`    Single INSERT: ${compareSize} queries`);
console.log(`    Multi-row (batch=${BATCH_SIZE}): ${Math.ceil(compareSize / BATCH_SIZE)} queries`);
console.log(`    COPY: 1 query`);

console.log("\n--- PostgreSQL parameter limit ---\n");

// PostgreSQL max parameter index is 65535
const maxParams = 65535;
const columnsPerRow = 5;
const maxRowsPerInsert = Math.floor(maxParams / columnsPerRow);

console.log(`  Max parameter index: $${maxParams}`);
console.log(`  With ${columnsPerRow} columns per row: max ${maxRowsPerInsert} rows per INSERT`);
console.log(`  For 100K rows: need ${Math.ceil(100000 / maxRowsPerInsert)} batches`);
console.log(`  COPY has no such limit — it streams indefinitely`);

console.log("\n=== Bulk Insert Patterns (pg Library) ===\n");

console.log("Pattern 1: Batched multi-row INSERT with RETURNING");
console.log(`
  async function bulkInsert(pool, table, columns, rows, batchSize = 500) {
    const results = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const params = [];
      let idx = 1;

      for (const row of batch) {
        const placeholders = columns.map(() => \`$\${idx++}\`);
        values.push(\`(\${placeholders.join(', ')})\`);
        for (const col of columns) params.push(row[col]);
      }

      const sql = \`INSERT INTO \${table} (\${columns.join(', ')})
        VALUES \${values.join(', ')} RETURNING id\`;
      const res = await pool.query(sql, params);
      results.push(...res.rows);
    }
    return results;
  }
`);

console.log("Pattern 2: COPY with pg-copy-streams");
console.log(`
  import { from as copyFrom } from 'pg-copy-streams';

  const client = await pool.connect();
  try {
    const stream = client.query(
      copyFrom('COPY users (name, email) FROM STDIN WITH (FORMAT csv)')
    );

    for (const user of users) {
      // Properly escape CSV values
      stream.write(\`"\${user.name}","\${user.email}"\\n\`);
    }

    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.end();
    });
  } finally {
    client.release();
  }
`);

console.log("Pattern 3: COPY from a Readable stream (pipeline)");
console.log(`
  import { pipeline } from 'stream/promises';
  import { Readable, Transform } from 'stream';
  import { from as copyFrom } from 'pg-copy-streams';

  const client = await pool.connect();
  const ingest = client.query(
    copyFrom('COPY events FROM STDIN WITH CSV')
  );

  const source = Readable.from(eventGenerator());  // async generator
  const toCsv = new Transform({
    objectMode: true,
    transform(event, enc, cb) {
      cb(null, \`\${event.type},\${event.timestamp},\${event.data}\\n\`);
    }
  });

  await pipeline(source, toCsv, ingest);
  client.release();
`);
```

## Expected Output

```
=== Bulk Insert Strategies ===

--- Strategy 1: Single-row INSERT (one at a time) ---

  100 rows: 100 queries, <ms>
  1000 rows: 1000 queries, <ms>
  5000 rows: 5000 queries, <ms>

--- Strategy 2: Multi-row INSERT (batched) ---

  Example SQL (3 rows):
    INSERT INTO users (name, email, age) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)
    Params: ["user_0", "user0@example.com", 20, "user_1", ...]
    Total params: 9

  100 rows: 1 queries (batch=500), <ms>
  1000 rows: 2 queries (batch=500), <ms>
  5000 rows: 10 queries (batch=500), <ms>

--- Strategy 3: COPY (streaming bulk load) ---

  COPY format (tab-separated, first 5 rows):
    user_0	user0@example.com	20
    ...

  100 rows: 1 query (COPY), <ms>
  1000 rows: 1 query (COPY), <ms>
  5000 rows: 1 query (COPY), <ms>
  ...
```

## Challenge

1. Build a CSV file importer that streams a CSV file line-by-line into PostgreSQL using COPY — handle proper CSV escaping (quotes, commas, newlines in values)
2. Implement a `bulkUpsert` function that uses `INSERT ... ON CONFLICT DO UPDATE` with multi-row values — this is the bulk equivalent of "create or update"
3. What's the maximum number of parameters you can use in a single PostgreSQL query? What error do you get when you exceed it?

## Common Mistakes

- Inserting rows in a loop without batching — 100K individual INSERTs can take minutes instead of seconds
- Exceeding the parameter limit ($65535) — split large batches to stay under the limit
- Not using a transaction for bulk inserts — without a transaction, each INSERT is separately committed (WAL flush), which is much slower
- Forgetting that COPY doesn't return generated IDs — if you need the IDs, use multi-row INSERT with RETURNING
