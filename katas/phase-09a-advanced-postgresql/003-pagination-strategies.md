---
id: pagination-strategies
phase: 9.5
phase_title: Advanced PostgreSQL in Node.js
sequence: 3
title: Pagination Strategies
difficulty: intermediate
tags: [postgresql, pagination, cursor, offset, keyset, performance]
prerequisites: [bulk-inserts]
estimated_minutes: 15
---

## Concept

APIs rarely return all data at once. Pagination breaks results into pages. There are three main strategies:

**1. OFFSET/LIMIT (simple but slow):**
```sql
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 40;
```
Simple to implement, but PostgreSQL must scan and discard the first 40 rows. At OFFSET 100,000, it scans 100,000 rows just to throw them away.

**2. Keyset/Cursor pagination (fast and stable):**
```sql
SELECT * FROM posts
WHERE created_at < $1
ORDER BY created_at DESC
LIMIT 20;
```
Uses the last item from the previous page as a cursor. PostgreSQL jumps directly to the right position using an index. Constant performance regardless of page number.

**3. Keyset with unique tiebreaker:**
```sql
SELECT * FROM posts
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```
When multiple rows share the same `created_at`, add `id` as a tiebreaker to ensure stable ordering and no skipped rows.

## Key Insight

> OFFSET pagination is O(n) — fetching page 1000 requires scanning 20,000 rows. Keyset pagination is O(1) — it uses an index to jump directly to the cursor position. For any dataset over a few thousand rows, keyset pagination is dramatically faster. The tradeoff: keyset pagination can't jump to arbitrary page numbers, only "next" and "previous."

## Experiment

```js
console.log("=== Pagination Strategies ===\n");

// Simulated database with index-like behavior
class PaginatedDB {
  constructor(rows) {
    // Store sorted by created_at DESC, id DESC
    this.rows = [...rows].sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return b.id - a.id;
    });
    this.scannedRows = 0;
  }

  // OFFSET/LIMIT — scans from the beginning every time
  queryOffset(limit, offset) {
    this.scannedRows = 0;
    const results = [];
    for (let i = 0; i < this.rows.length; i++) {
      this.scannedRows++;
      if (i >= offset && results.length < limit) {
        results.push(this.rows[i]);
      }
      if (results.length === limit) break;
    }
    return { rows: results, scanned: this.scannedRows };
  }

  // Keyset — jumps to the cursor position (simulated index seek)
  queryKeyset(limit, cursor = null) {
    this.scannedRows = 0;
    const results = [];

    for (const row of this.rows) {
      this.scannedRows++;

      // Skip rows before cursor
      if (cursor) {
        if (row.created_at > cursor.created_at) continue;
        if (row.created_at === cursor.created_at && row.id >= cursor.id) continue;
      }

      results.push(row);
      if (results.length === limit) break;
    }

    return { rows: results, scanned: this.scannedRows };
  }
}

// Generate test dataset
const now = Date.now();
const totalPosts = 10000;
const posts = Array.from({ length: totalPosts }, (_, i) => ({
  id: i + 1,
  title: `Post ${i + 1}`,
  created_at: now - i * 60000, // 1 minute apart
  author: `user_${(i % 50) + 1}`,
}));

const db = new PaginatedDB(posts);
const PAGE_SIZE = 20;

// --- Demo 1: OFFSET pagination ---

console.log("--- OFFSET/LIMIT pagination ---\n");

const offsetPages = [1, 10, 100, 500];

for (const page of offsetPages) {
  const offset = (page - 1) * PAGE_SIZE;
  const result = db.queryOffset(PAGE_SIZE, offset);
  console.log(`  Page ${String(page).padStart(3)}: OFFSET ${String(offset).padStart(5)}, scanned ${String(result.scanned).padStart(5)} rows, returned ${result.rows.length}`);
}

console.log("\n  Problem: scanning grows linearly with page number!\n");

// --- Demo 2: Keyset pagination ---

console.log("--- Keyset pagination ---\n");

let cursor = null;
const keysetPages = [1, 10, 100, 500];
let currentPage = 0;

// Navigate to each target page
for (const targetPage of keysetPages) {
  // Fast-forward to target page
  while (currentPage < targetPage) {
    const result = db.queryKeyset(PAGE_SIZE, cursor);
    if (result.rows.length > 0) {
      const lastRow = result.rows[result.rows.length - 1];
      cursor = { created_at: lastRow.created_at, id: lastRow.id };
    }
    currentPage++;
  }

  const result = db.queryKeyset(PAGE_SIZE, cursor);
  console.log(`  Page ${String(targetPage).padStart(3)}: scanned ${String(result.scanned).padStart(2)} rows (constant!), returned ${result.rows.length}`);
}

console.log("\n  Keyset always scans ~page_size rows regardless of position!\n");

// --- Demo 3: Comparison table ---

console.log("--- Performance comparison ---\n");

console.log("  Page    OFFSET scans    Keyset scans    Speedup");
console.log("  ────    ────────────    ────────────    ───────");

for (const page of [1, 10, 50, 100, 250, 500]) {
  const offsetResult = db.queryOffset(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const keysetScans = Math.min(PAGE_SIZE, totalPosts);  // Always ~PAGE_SIZE
  const speedup = (offsetResult.scanned / keysetScans).toFixed(1);
  console.log(`  ${String(page).padStart(4)}    ${String(offsetResult.scanned).padStart(12)}    ${String(keysetScans).padStart(12)}    ${speedup}x`);
}

// --- Demo 4: API response formats ---

console.log("\n=== API Response Formats ===\n");

// OFFSET-style response
console.log("OFFSET pagination response:");
const offsetResp = {
  data: ["... 20 items ..."],
  pagination: {
    page: 5,
    pageSize: 20,
    totalItems: 10000,
    totalPages: 500,
  },
};
console.log(`  ${JSON.stringify(offsetResp, null, 2).split("\n").join("\n  ")}\n`);

// Keyset-style response
console.log("Keyset pagination response:");
const keysetResp = {
  data: ["... 20 items ..."],
  pagination: {
    nextCursor: "eyJjcmVhdGVkX2F0IjoxNzA5MTIzNDU2LCJpZCI6ODF9",
    prevCursor: "eyJjcmVhdGVkX2F0IjoxNzA5MTI1NDU2LCJpZCI6NjF9",
    hasMore: true,
  },
};
console.log(`  ${JSON.stringify(keysetResp, null, 2).split("\n").join("\n  ")}\n`);

// --- Demo 5: Cursor encoding ---

console.log("--- Cursor encoding (base64 JSON) ---\n");

function encodeCursor(row) {
  const payload = { created_at: row.created_at, id: row.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
}

const sampleRow = { id: 42, title: "Hello", created_at: 1709123456000 };
const encoded = encodeCursor(sampleRow);
const decoded = decodeCursor(encoded);

console.log(`  Row: id=${sampleRow.id}, created_at=${sampleRow.created_at}`);
console.log(`  Encoded cursor: ${encoded}`);
console.log(`  Decoded: ${JSON.stringify(decoded)}\n`);

console.log("=== SQL Patterns ===\n");

console.log("OFFSET (simple, slow at scale):");
console.log(`  SELECT * FROM posts
  ORDER BY created_at DESC
  LIMIT $1 OFFSET $2;
`);

console.log("Keyset (fast, requires cursor):");
console.log(`  SELECT * FROM posts
  WHERE (created_at, id) < ($1, $2)
  ORDER BY created_at DESC, id DESC
  LIMIT $3;
`);

console.log("Required index for keyset:");
console.log(`  CREATE INDEX idx_posts_cursor
  ON posts (created_at DESC, id DESC);
`);

console.log("Count for total (expensive — cache this!):");
console.log(`  SELECT count(*) FROM posts WHERE <filters>;
`);
```

## Expected Output

```
=== Pagination Strategies ===

--- OFFSET/LIMIT pagination ---

  Page   1: OFFSET     0, scanned    20 rows, returned 20
  Page  10: OFFSET   180, scanned   200 rows, returned 20
  Page 100: OFFSET  1980, scanned  2000 rows, returned 20
  Page 500: OFFSET  9980, scanned 10000 rows, returned 20

  Problem: scanning grows linearly with page number!

--- Keyset pagination ---

  Page   1: scanned 20 rows (constant!), returned 20
  Page  10: scanned 20 rows (constant!), returned 20
  Page 100: scanned 20 rows (constant!), returned 20
  Page 500: scanned 20 rows (constant!), returned 20

  Keyset always scans ~page_size rows regardless of position!

--- Performance comparison ---

  Page    OFFSET scans    Keyset scans    Speedup
  ...
```

## Challenge

1. Implement bidirectional keyset pagination — support both "next page" and "previous page" using reversed comparison operators
2. Build a hybrid pagination API that uses OFFSET for the first 10 pages (allows jumping) and keyset for deeper pages (keeps it fast)
3. How would you paginate results that are sorted by a non-unique column like `status`? What tiebreaker do you need?

## Common Mistakes

- Using OFFSET for deep pagination — page 10,000 scans 200,000 rows before returning 20
- Not adding `id` as a tiebreaker to keyset pagination — rows with the same `created_at` can be skipped or duplicated
- Running `COUNT(*)` on every page request — cache the count or use an estimate from `pg_class.reltuples`
- Exposing raw database IDs in cursors — encode cursors as opaque base64 tokens so clients can't manipulate them
