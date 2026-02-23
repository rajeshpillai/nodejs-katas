---
id: jsonb-usage
phase: 9.5
phase_title: Advanced PostgreSQL in Node.js
sequence: 4
title: JSONB in PostgreSQL
difficulty: intermediate
tags: [postgresql, jsonb, json, schemaless, indexing]
prerequisites: [pagination-strategies]
estimated_minutes: 15
---

## Concept

PostgreSQL's `jsonb` type stores JSON data in a binary format that supports indexing, querying, and partial updates. It bridges the gap between rigid relational schemas and flexible document stores.

**When to use JSONB:**
- User preferences, settings, metadata
- Event payloads, audit logs
- API response caching
- Schema-flexible fields alongside structured columns

**When NOT to use JSONB:**
- Data you query or join on frequently — use regular columns
- Data with a fixed, known schema — columns are faster and type-safe
- Large arrays that grow indefinitely — updates rewrite the entire field

**Key operators:**
```sql
-- Access a key
SELECT data->>'name' FROM events;           -- text result
SELECT data->'address'->'city' FROM users;   -- jsonb result

-- Filter
SELECT * FROM events WHERE data->>'type' = 'click';
SELECT * FROM events WHERE data @> '{"type": "click"}';  -- containment

-- Check key exists
SELECT * FROM events WHERE data ? 'error';

-- Index for fast queries
CREATE INDEX idx_events_type ON events USING GIN (data);
```

## Key Insight

> JSONB is not "MongoDB inside PostgreSQL." It's a column type — you still have tables, constraints, transactions, and indexes. Use regular columns for structured, queryable data and JSONB for flexible, semi-structured data within the same row. The `@>` containment operator with a GIN index makes JSONB queries fast even on millions of rows.

## Experiment

```js
console.log("=== JSONB in PostgreSQL ===\n");

// Simulated JSONB storage and query engine
class JsonbDB {
  constructor() {
    this.tables = new Map();
  }

  createTable(name) {
    this.tables.set(name, []);
  }

  insert(table, row) {
    this.tables.get(table).push(row);
  }

  // Simulate JSONB operators
  query(table, filter = null) {
    const rows = this.tables.get(table) || [];
    if (!filter) return rows;
    return rows.filter(filter);
  }

  // Simulate -> operator (get jsonb value)
  static jsonGet(obj, ...path) {
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  // Simulate ->> operator (get text value)
  static jsonGetText(obj, ...path) {
    const val = JsonbDB.jsonGet(obj, ...path);
    return val !== undefined ? String(val) : null;
  }

  // Simulate @> operator (containment)
  static jsonContains(obj, pattern) {
    for (const [key, val] of Object.entries(pattern)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        if (!JsonbDB.jsonContains(obj[key] || {}, val)) return false;
      } else if (Array.isArray(val)) {
        const arr = obj[key];
        if (!Array.isArray(arr)) return false;
        for (const item of val) {
          if (!arr.some(a => JSON.stringify(a) === JSON.stringify(item))) return false;
        }
      } else {
        if (obj[key] !== val) return false;
      }
    }
    return true;
  }

  // Simulate ? operator (key exists)
  static jsonHasKey(obj, key) {
    return obj !== null && obj !== undefined && key in obj;
  }
}

const db = new JsonbDB();

// --- Demo 1: Events with JSONB payload ---

console.log("--- Events with JSONB data column ---\n");

db.createTable("events");

const events = [
  { id: 1, type: "page_view", timestamp: "2024-01-15T10:30:00Z",
    data: { url: "/home", referrer: "https://google.com", duration_ms: 3200, user_agent: "Chrome/120" } },
  { id: 2, type: "click", timestamp: "2024-01-15T10:30:15Z",
    data: { element: "button#signup", url: "/home", position: { x: 450, y: 320 } } },
  { id: 3, type: "purchase", timestamp: "2024-01-15T10:31:00Z",
    data: { product_id: 42, amount: 29.99, currency: "USD", items: [{ sku: "WDG-001", qty: 2 }] } },
  { id: 4, type: "error", timestamp: "2024-01-15T10:31:30Z",
    data: { message: "Failed to load resource", code: 404, url: "/api/missing", stack: "Error at fetch..." } },
  { id: 5, type: "page_view", timestamp: "2024-01-15T10:32:00Z",
    data: { url: "/pricing", referrer: "/home", duration_ms: 8500 } },
];

for (const event of events) {
  db.insert("events", event);
}

console.log("  Inserted 5 events with different JSONB payloads\n");

// Query: data->>'url' (text access)
console.log("  Query: data->>'url' for page_view events:");
const pageViews = db.query("events", row =>
  row.type === "page_view"
);
for (const pv of pageViews) {
  const url = JsonbDB.jsonGetText(pv.data, "url");
  const duration = JsonbDB.jsonGet(pv.data, "duration_ms");
  console.log(`    ${url} (${duration}ms)`);
}

// Query: data->'position'->'x' (nested access)
console.log("\n  Query: data->'position'->'x' for click events:");
const clicks = db.query("events", row => row.type === "click");
for (const click of clicks) {
  const x = JsonbDB.jsonGet(click.data, "position", "x");
  const y = JsonbDB.jsonGet(click.data, "position", "y");
  console.log(`    Clicked ${click.data.element} at (${x}, ${y})`);
}

// Query: @> containment
console.log("\n  Query: data @> '{\"currency\": \"USD\"}' (containment):");
const usdPurchases = db.query("events", row =>
  JsonbDB.jsonContains(row.data, { currency: "USD" })
);
for (const p of usdPurchases) {
  console.log(`    Purchase: $${p.data.amount} ${p.data.currency}`);
}

// Query: ? key exists
console.log("\n  Query: data ? 'stack' (has error stack):");
const withStack = db.query("events", row =>
  JsonbDB.jsonHasKey(row.data, "stack")
);
for (const e of withStack) {
  console.log(`    ${e.type}: ${e.data.message}`);
}

// --- Demo 2: User settings with JSONB ---

console.log("\n--- User settings with JSONB column ---\n");

db.createTable("users");

const users = [
  { id: 1, name: "Alice", email: "alice@test.com",
    settings: { theme: "dark", language: "en", notifications: { email: true, push: false } } },
  { id: 2, name: "Bob", email: "bob@test.com",
    settings: { theme: "light", language: "fr", notifications: { email: true, push: true }, timezone: "Europe/Paris" } },
  { id: 3, name: "Charlie", email: "charlie@test.com",
    settings: { theme: "dark", language: "en" } },
];

for (const user of users) {
  db.insert("users", user);
}

// Read settings
console.log("  User settings:");
for (const user of db.query("users")) {
  console.log(`    ${user.name}: theme=${user.settings.theme}, lang=${user.settings.language}`);
}

// Query by nested JSONB
console.log("\n  Dark theme users:");
const darkUsers = db.query("users", row =>
  JsonbDB.jsonContains(row.settings, { theme: "dark" })
);
for (const u of darkUsers) {
  console.log(`    ${u.name}`);
}

// Merge/update JSONB
console.log("\n  JSONB merge (||) — update Alice's settings:");
const alice = db.query("users", r => r.name === "Alice")[0];
const updatedSettings = { ...alice.settings, theme: "light", fontSize: 16 };
console.log(`    Before: ${JSON.stringify(alice.settings)}`);
console.log(`    Merge:  ${JSON.stringify({ theme: "light", fontSize: 16 })}`);
console.log(`    After:  ${JSON.stringify(updatedSettings)}`);

// --- Demo 3: JSONB vs columns comparison ---

console.log("\n--- When to use JSONB vs columns ---\n");

const comparison = [
  ["Aspect", "Regular Column", "JSONB"],
  ["Type safety", "Enforced by DB", "None (runtime)"],
  ["Query speed", "Direct index", "GIN/expression index"],
  ["JOIN support", "Native", "Possible but slow"],
  ["Schema changes", "ALTER TABLE (migration)", "Just store new keys"],
  ["NULL handling", "Per column", "Key absent or null"],
  ["Aggregation", "Fast (SUM, AVG)", "Slower (extract first)"],
  ["Storage size", "Minimal", "Larger (key names stored)"],
];

for (const [aspect, col, jsonb] of comparison) {
  console.log(`  ${aspect.padEnd(16)} ${col.padEnd(24)} ${jsonb}`);
}

// --- Demo 4: SQL patterns ---

console.log("\n=== JSONB SQL Patterns ===\n");

console.log("Create table with JSONB:");
console.log(`  CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  );
`);

console.log("Insert JSONB from Node.js:");
console.log(`  await pool.query(
    'INSERT INTO events (type, data) VALUES ($1, $2)',
    ['click', JSON.stringify({ url: '/home', x: 100, y: 200 })]
  );
`);

console.log("Query JSONB fields:");
console.log(`  -- Text value
  SELECT data->>'url' AS url FROM events;

  -- Nested path
  SELECT data->'position'->>'x' AS x FROM events;

  -- Containment (uses GIN index)
  SELECT * FROM events WHERE data @> '{"type": "click"}';

  -- Existence
  SELECT * FROM events WHERE data ? 'error';

  -- Path exists
  SELECT * FROM events WHERE data #> '{address,city}' IS NOT NULL;
`);

console.log("Update JSONB (partial):");
console.log(`  -- Merge keys (PostgreSQL 16+)
  UPDATE users SET settings = settings || '{"theme": "dark"}'
  WHERE id = $1;

  -- Set nested path
  UPDATE users SET settings = jsonb_set(
    settings, '{notifications,push}', 'true'
  ) WHERE id = $1;

  -- Remove a key
  UPDATE users SET settings = settings - 'deprecated_key'
  WHERE id = $1;
`);

console.log("Index JSONB:");
console.log(`  -- GIN index (all keys and values, supports @>, ?, ?|, ?&)
  CREATE INDEX idx_events_data ON events USING GIN (data);

  -- Expression index (specific key, faster for equality)
  CREATE INDEX idx_events_type ON events ((data->>'type'));
`);
```

## Expected Output

```
=== JSONB in PostgreSQL ===

--- Events with JSONB data column ---

  Inserted 5 events with different JSONB payloads

  Query: data->>'url' for page_view events:
    /home (3200ms)
    /pricing (8500ms)

  Query: data->'position'->'x' for click events:
    Clicked button#signup at (450, 320)

  Query: data @> '{"currency": "USD"}' (containment):
    Purchase: $29.99 USD

  Query: data ? 'stack' (has error stack):
    error: Failed to load resource

--- User settings with JSONB column ---

  User settings:
    Alice: theme=dark, lang=en
    Bob: theme=light, lang=fr
    Charlie: theme=dark, lang=en
  ...
```

## Challenge

1. Build a function that converts a flat query object like `{ "data.type": "click", "data.position.x__gt": 100 }` into a PostgreSQL query with JSONB operators
2. Implement a schema validator that checks JSONB data against a JSON Schema before inserting — PostgreSQL doesn't enforce JSONB structure, so your app must
3. When should you promote a JSONB field to a regular column? Build a query that identifies the most-queried JSONB keys from `pg_stat_statements`

## Common Mistakes

- Storing everything in JSONB to "avoid migrations" — you lose type safety, foreign keys, and query performance
- Querying JSONB without indexes — `WHERE data->>'type' = 'click'` does a full table scan without an expression index
- Using `json` instead of `jsonb` — `json` preserves whitespace and key order but can't be indexed or use operators like `@>`
- Updating JSONB by replacing the entire column — use `jsonb_set()` or `||` to update specific keys instead
