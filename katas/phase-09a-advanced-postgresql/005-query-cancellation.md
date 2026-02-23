---
id: query-cancellation
phase: 9.5
phase_title: Advanced PostgreSQL in Node.js
sequence: 5
title: Query Cancellation and Timeouts
difficulty: intermediate
tags: [postgresql, timeout, cancellation, long-queries, performance]
prerequisites: [jsonb-usage]
estimated_minutes: 15
---

## Concept

Long-running queries can block connections, starve the pool, and degrade your entire application. PostgreSQL provides several mechanisms to limit query execution:

**1. `statement_timeout` (per session or per query):**
```sql
SET statement_timeout = '5000';  -- 5 seconds max per query
```

**2. `idle_in_transaction_session_timeout`:**
```sql
SET idle_in_transaction_session_timeout = '30000';  -- Kill idle transactions after 30s
```

**3. Cancel from Node.js using `pg`:**
```js
const client = await pool.connect();
const timeout = setTimeout(() => {
  // Send cancel signal to PostgreSQL backend
  client.query('SELECT pg_cancel_backend(pg_backend_pid())');
}, 5000);

try {
  const result = await client.query('SELECT * FROM huge_table');
  clearTimeout(timeout);
} catch (err) {
  if (err.code === '57014') {
    console.log('Query cancelled due to timeout');
  }
}
```

**4. AbortController (modern approach):**
```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  await pool.query({ text: 'SELECT ...', signal: controller.signal });
} catch (err) {
  // Handles both abort and timeout
}
```

## Key Insight

> A query timeout kills the query, not the connection. The connection returns to the pool ready for the next query. But an `idle_in_transaction` timeout kills the session entirely — the connection is destroyed. Always set `statement_timeout` as a safety net: without it, a missing WHERE clause on a 100M row table will lock a pool connection for minutes.

## Experiment

```js
console.log("=== Query Cancellation and Timeouts ===\n");

// Simulated query executor with timeout support
class QueryExecutor {
  constructor() {
    this.activeQueries = new Map();
    this.nextId = 1;
    this.cancelledCount = 0;
    this.completedCount = 0;
    this.timedOutCount = 0;
  }

  async execute(sql, options = {}) {
    const { timeout = 0, label = sql.slice(0, 40) } = options;
    const queryId = this.nextId++;
    const startTime = performance.now();

    // Register the query
    const queryInfo = {
      id: queryId,
      sql: label,
      startTime,
      cancelled: false,
    };
    this.activeQueries.set(queryId, queryInfo);

    // Set up timeout
    let timeoutHandle = null;
    const timeoutPromise = timeout > 0
      ? new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            queryInfo.cancelled = true;
            this.timedOutCount++;
            reject(new QueryError("57014", "canceling statement due to statement timeout"));
          }, timeout);
        })
      : null;

    // Simulate query execution
    const duration = options.simulatedDuration || 100;
    const queryPromise = new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (queryInfo.cancelled) {
          clearInterval(check);
          reject(new QueryError("57014", "query cancelled"));
        }
      }, 10);

      setTimeout(() => {
        clearInterval(check);
        if (!queryInfo.cancelled) {
          resolve({ rows: [{ result: "ok" }], rowCount: 1 });
        }
      }, duration);
    });

    try {
      const result = timeoutPromise
        ? await Promise.race([queryPromise, timeoutPromise])
        : await queryPromise;

      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.activeQueries.delete(queryId);
      this.completedCount++;

      const elapsed = performance.now() - startTime;
      return { ...result, elapsed };
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.activeQueries.delete(queryId);

      const elapsed = performance.now() - startTime;
      err.elapsed = elapsed;
      throw err;
    }
  }

  cancel(queryId) {
    const query = this.activeQueries.get(queryId);
    if (query) {
      query.cancelled = true;
      this.cancelledCount++;
      return true;
    }
    return false;
  }

  getActive() {
    return Array.from(this.activeQueries.values()).map(q => ({
      id: q.id,
      sql: q.sql,
      runningMs: Math.round(performance.now() - q.startTime),
    }));
  }

  getStats() {
    return {
      active: this.activeQueries.size,
      completed: this.completedCount,
      cancelled: this.cancelledCount,
      timedOut: this.timedOutCount,
    };
  }
}

class QueryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.severity = "ERROR";
  }
}

const executor = new QueryExecutor();

// --- Demo 1: Query with statement_timeout ---

console.log("--- statement_timeout behavior ---\n");

// Fast query — completes within timeout
console.log("  Query 1: Fast query (50ms) with 200ms timeout");
try {
  const r = await executor.execute("SELECT * FROM small_table", {
    simulatedDuration: 50,
    timeout: 200,
    label: "Fast query",
  });
  console.log(`    ✓ Completed in ${r.elapsed.toFixed(0)}ms\n`);
} catch (err) {
  console.log(`    ✗ ${err.message}\n`);
}

// Slow query — exceeds timeout
console.log("  Query 2: Slow query (500ms) with 100ms timeout");
try {
  const r = await executor.execute("SELECT * FROM huge_table WHERE no_index", {
    simulatedDuration: 500,
    timeout: 100,
    label: "Slow query",
  });
  console.log(`    ✓ Completed in ${r.elapsed.toFixed(0)}ms\n`);
} catch (err) {
  console.log(`    ✗ ${err.message} (after ${err.elapsed.toFixed(0)}ms)`);
  console.log(`    Error code: ${err.code} (57014 = query cancelled)\n`);
}

console.log(`  Stats: ${JSON.stringify(executor.getStats())}\n`);

// --- Demo 2: Multiple concurrent queries with timeouts ---

console.log("--- Concurrent queries with different timeouts ---\n");

const queries = [
  { sql: "Quick lookup", duration: 30, timeout: 1000 },
  { sql: "Medium join", duration: 150, timeout: 200 },
  { sql: "Slow report", duration: 800, timeout: 100 },
  { sql: "Aggregation", duration: 200, timeout: 500 },
  { sql: "Full scan (no timeout!)", duration: 400, timeout: 0 },
];

const results = await Promise.allSettled(
  queries.map(q =>
    executor.execute(q.sql, {
      simulatedDuration: q.duration,
      timeout: q.timeout,
      label: q.sql,
    })
  )
);

for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const r = results[i];
  const timeoutStr = q.timeout ? `${q.timeout}ms` : "none";
  if (r.status === "fulfilled") {
    console.log(`  ✓ "${q.sql}" (${q.duration}ms, timeout=${timeoutStr}) — completed`);
  } else {
    console.log(`  ✗ "${q.sql}" (${q.duration}ms, timeout=${timeoutStr}) — ${r.reason.message}`);
  }
}

console.log(`\n  Stats: ${JSON.stringify(executor.getStats())}\n`);

// --- Demo 3: AbortController pattern ---

console.log("--- AbortController pattern ---\n");

async function queryWithAbort(executor, sql, options = {}) {
  const { timeoutMs = 5000, simulatedDuration = 100 } = options;
  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // In real pg, you'd pass signal: controller.signal
    const result = await executor.execute(sql, {
      simulatedDuration,
      timeout: timeoutMs,
      label: sql,
    });
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      console.log(`    Request aborted after ${timeoutMs}ms`);
    }
    throw err;
  }
}

try {
  const r = await queryWithAbort(executor, "SELECT with abort", {
    timeoutMs: 50,
    simulatedDuration: 200,
  });
  console.log(`  Completed: ${JSON.stringify(r)}`);
} catch (err) {
  console.log(`  Correctly timed out: ${err.code}\n`);
}

// --- Demo 4: Monitoring long-running queries ---

console.log("--- Monitoring active queries ---\n");

console.log("  PostgreSQL query to find long-running queries:");
console.log(`
    SELECT pid, now() - pg_stat_activity.query_start AS duration,
           query, state
    FROM pg_stat_activity
    WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
      AND state != 'idle'
    ORDER BY duration DESC;
  `);

console.log("  Cancel a specific query by PID:");
console.log(`
    SELECT pg_cancel_backend(12345);     -- Sends cancel signal (graceful)
    SELECT pg_terminate_backend(12345);  -- Kills the connection (forceful)
  `);

// --- Demo 5: Timeout configuration levels ---

console.log("--- Timeout configuration levels ---\n");

const levels = [
  ["Level", "Setting", "Scope"],
  ["postgresql.conf", "statement_timeout = '30s'", "All sessions (server-wide default)"],
  ["Role", "ALTER ROLE app SET statement_timeout = '10s'", "All sessions for this role"],
  ["Session", "SET statement_timeout = '5s'", "Current connection only"],
  ["Transaction", "SET LOCAL statement_timeout = '2s'", "Current transaction only"],
  ["Query (pg)", "pool.query({ text: sql, timeout: 5000 })", "Node.js client timeout"],
];

for (const [level, setting, scope] of levels) {
  console.log(`  ${level.padEnd(18)} ${scope}`);
  console.log(`    ${setting}\n`);
}

console.log("=== Recommended timeout strategy ===\n");

console.log(`  // Pool configuration with timeouts
  const pool = new Pool({
    max: 20,
    connectionTimeoutMillis: 5000,     // Wait max 5s for a connection
    idleTimeoutMillis: 30000,          // Close idle connections after 30s
    statement_timeout: 30000,          // Kill queries after 30s
    query_timeout: 30000,              // Node.js-side timeout
    idle_in_transaction_session_timeout: 60000,  // Kill idle transactions
  });
`);
```

## Expected Output

```
=== Query Cancellation and Timeouts ===

--- statement_timeout behavior ---

  Query 1: Fast query (50ms) with 200ms timeout
    ✓ Completed in 50ms

  Query 2: Slow query (500ms) with 100ms timeout
    ✗ canceling statement due to statement timeout (after 100ms)
    Error code: 57014 (57014 = query cancelled)

  Stats: {"active":0,"completed":1,"cancelled":0,"timedOut":1}

--- Concurrent queries with different timeouts ---

  ✓ "Quick lookup" (30ms, timeout=1000ms) — completed
  ✓ "Medium join" (150ms, timeout=200ms) — completed
  ✗ "Slow report" (800ms, timeout=100ms) — cancelled
  ✓ "Aggregation" (200ms, timeout=500ms) — completed
  ✓ "Full scan (no timeout!)" (400ms, timeout=none) — completed
  ...
```

## Challenge

1. Build a query wrapper that sets `statement_timeout` per query and restores the original value after — useful for giving reports longer timeouts than API queries
2. Implement a "query watchdog" that monitors `pg_stat_activity` and cancels any query running longer than a threshold
3. What happens to a transaction when a query inside it is cancelled by `statement_timeout`? Is the transaction rolled back, or is it still open?

## Deep Dive

PostgreSQL timeout hierarchy:

| Timeout | Kills | Behavior |
|---------|-------|----------|
| `statement_timeout` | Query | Query cancelled, connection reusable |
| `lock_timeout` | Lock wait | Give up waiting for a lock |
| `idle_in_transaction_session_timeout` | Session | Connection terminated |
| `idle_session_timeout` | Session | Idle connection terminated (PG 14+) |
| Node.js `query_timeout` | Client-side | Connection still busy server-side! |

Important: Node.js `query_timeout` stops waiting but **does not cancel the PostgreSQL query**. The query continues running on the server until it finishes or `statement_timeout` kills it. Always pair client-side timeouts with `statement_timeout`.

## Common Mistakes

- Not setting `statement_timeout` at all — a runaway query can hold a connection for hours
- Relying only on Node.js client timeout — the query keeps running on PostgreSQL even after the client stops waiting
- Setting timeouts too aggressively — legitimate complex queries fail. Use per-query timeouts for reports
- Forgetting `idle_in_transaction_session_timeout` — a crashed Node.js process leaves connections "idle in transaction," holding locks
