---
id: connection-pooling
phase: 9
phase_title: PostgreSQL Integration
sequence: 2
title: Connection Pooling
difficulty: intermediate
tags: [postgresql, pooling, connections, pg, performance]
prerequisites: [postgresql-architecture]
estimated_minutes: 15
---

## Concept

A connection pool maintains a set of open database connections and lends them to requests on demand. When a request is done, the connection goes back to the pool — not closed.

The `pg` library (node-postgres) provides `Pool`, which:
- Opens connections lazily (on first query, not at startup)
- Reuses idle connections for subsequent queries
- Queues requests when all connections are busy
- Removes broken connections and creates replacements
- Respects `max` connections limit

Pool configuration:

```js
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'myapp',
  password: 'secret',
  max: 20,              // Maximum pool size
  idleTimeoutMillis: 30000,  // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail if can't connect in 5s
});
```

The pool size is a balance:
- **Too small** (2-5) — requests queue waiting for connections, high latency under load
- **Too large** (100+) — each connection uses memory in both Node.js and PostgreSQL, diminishing returns
- **Sweet spot** — typically `max(2, cpu_cores * 2)` for CPU-bound, or 10-30 for I/O-bound apps

## Key Insight

> A pool of 10 connections can serve thousands of concurrent requests because each request only holds a connection for the duration of its query (~1-50ms), not the entire HTTP request (~50-500ms). The pool is a multiplexer: it maps many short-lived borrows onto a few long-lived connections.

## Experiment

```js
// This kata simulates the pg Pool behavior without requiring a running database.
// In production, replace SimulatedPool with pg.Pool.

console.log("=== Connection Pool Simulation ===\n");

class SimulatedConnection {
  constructor(id) {
    this.id = id;
    this.inUse = false;
    this.queryCount = 0;
    this.createdAt = Date.now();
  }

  async query(sql, params) {
    this.queryCount++;
    // Simulate query latency
    await new Promise(r => setTimeout(r, 5 + Math.random() * 10));
    return { rows: [{ result: "simulated" }], rowCount: 1 };
  }

  release() {
    this.inUse = false;
  }
}

class SimulatedPool {
  constructor(config = {}) {
    this.max = config.max || 10;
    this.idleTimeoutMillis = config.idleTimeoutMillis || 30000;
    this.connectionTimeoutMillis = config.connectionTimeoutMillis || 5000;

    this.connections = [];
    this.waitQueue = [];  // Callbacks waiting for a connection
    this.totalConnections = 0;
    this.totalQueries = 0;
    this.peakActive = 0;
    this.totalWaitTime = 0;
    this.waitCount = 0;
  }

  async connect() {
    // Try to find an idle connection
    const idle = this.connections.find(c => !c.inUse);
    if (idle) {
      idle.inUse = true;
      this.updatePeakActive();
      return idle;
    }

    // Create a new connection if under the limit
    if (this.connections.length < this.max) {
      const conn = new SimulatedConnection(this.connections.length + 1);
      conn.inUse = true;
      this.connections.push(conn);
      this.totalConnections++;
      this.updatePeakActive();
      return conn;
    }

    // Wait for a connection to become available
    const waitStart = Date.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, this.connectionTimeoutMillis);

      this.waitQueue.push((conn) => {
        clearTimeout(timeout);
        this.totalWaitTime += Date.now() - waitStart;
        this.waitCount++;
        resolve(conn);
      });
    });
  }

  release(conn) {
    conn.inUse = false;

    // If someone is waiting, give them this connection
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      conn.inUse = true;
      waiter(conn);
    }
  }

  // Convenience: borrow a connection, run a query, release
  async query(sql, params) {
    const conn = await this.connect();
    try {
      this.totalQueries++;
      return await conn.query(sql, params);
    } finally {
      this.release(conn);
    }
  }

  updatePeakActive() {
    const active = this.connections.filter(c => c.inUse).length;
    if (active > this.peakActive) this.peakActive = active;
  }

  getStatus() {
    const active = this.connections.filter(c => c.inUse).length;
    const idle = this.connections.length - active;
    return {
      total: this.connections.length,
      active,
      idle,
      max: this.max,
      waiting: this.waitQueue.length,
      peakActive: this.peakActive,
      totalQueries: this.totalQueries,
      totalConnections: this.totalConnections,
      avgWaitMs: this.waitCount > 0 ? (this.totalWaitTime / this.waitCount).toFixed(1) : 0,
    };
  }

  async end() {
    this.connections.length = 0;
    this.waitQueue.length = 0;
  }
}

// --- Demo: Pool behavior under load ---

const pool = new SimulatedPool({ max: 5 });

console.log("Pool config: max=5\n");

// Sequential queries (connections reused)
console.log("--- Sequential queries ---\n");

for (let i = 0; i < 10; i++) {
  await pool.query(`SELECT ${i}`);
}
console.log("After 10 sequential queries:", pool.getStatus());

// Parallel queries (pool grows to max, then queues)
console.log("\n--- 20 parallel queries (pool max=5) ---\n");

const startTime = performance.now();
const promises = Array.from({ length: 20 }, (_, i) =>
  pool.query(`SELECT ${i}`)
);

await Promise.all(promises);
const elapsed = performance.now() - startTime;

console.log(`Completed in ${elapsed.toFixed(0)}ms`);
console.log("Status:", pool.getStatus());

// Show pool under pressure
console.log("\n--- 100 parallel queries (pool max=5) ---\n");

const pool2 = new SimulatedPool({ max: 5 });
const start2 = performance.now();

const burst = Array.from({ length: 100 }, (_, i) =>
  pool2.query(`SELECT ${i}`)
);

await Promise.all(burst);
const elapsed2 = performance.now() - start2;

console.log(`Completed 100 queries in ${elapsed2.toFixed(0)}ms`);
console.log("Status:", pool2.getStatus());
console.log(`Average wait time: ${pool2.getStatus().avgWaitMs}ms`);

// Compare different pool sizes
console.log("\n=== Pool Size Comparison ===\n");

for (const maxSize of [2, 5, 10, 20]) {
  const testPool = new SimulatedPool({ max: maxSize });
  const start = performance.now();

  await Promise.all(
    Array.from({ length: 100 }, () => testPool.query("SELECT 1"))
  );

  const time = performance.now() - start;
  const status = testPool.getStatus();

  console.log(`  max=${String(maxSize).padStart(2)}: ${time.toFixed(0).padStart(4)}ms, peak_active=${status.peakActive}, total_created=${status.totalConnections}`);
}

console.log("\n=== Pool Usage Pattern ===\n");

console.log("Correct: pool.query() (auto acquire/release)");
console.log("  await pool.query('SELECT * FROM users WHERE id = $1', [42]);\n");

console.log("Manual: connect() + release() (for transactions)");
console.log("  const client = await pool.connect();");
console.log("  try {");
console.log("    await client.query('BEGIN');");
console.log("    await client.query('INSERT INTO ...');");
console.log("    await client.query('COMMIT');");
console.log("  } catch (err) {");
console.log("    await client.query('ROLLBACK');");
console.log("    throw err;");
console.log("  } finally {");
console.log("    client.release();  // ALWAYS release!");
console.log("  }");

await pool.end();
await pool2.end();
console.log("\nDone");
```

## Expected Output

```
=== Connection Pool Simulation ===

Pool config: max=5

--- Sequential queries ---

After 10 sequential queries: { total: 1, active: 0, idle: 1, ... totalQueries: 10 }

--- 20 parallel queries (pool max=5) ---

Completed in <ms>
Status: { total: 5, active: 0, idle: 5, peakActive: 5, totalQueries: 30, ... }

--- 100 parallel queries (pool max=5) ---

Completed 100 queries in <ms>
Status: { total: 5, peakActive: 5, totalQueries: 100, ... }

=== Pool Size Comparison ===

  max= 2: <ms>, peak_active=2, total_created=2
  max= 5: <ms>, peak_active=5, total_created=5
  max=10: <ms>, peak_active=10, total_created=10
  max=20: <ms>, peak_active=<≤20>, total_created=<≤20>

...
```

## Challenge

1. Add connection health checks to the pool: before lending a connection, run `SELECT 1` to verify it's alive. Remove dead connections
2. Implement pool drain: when shutting down, stop lending connections, wait for all active connections to be returned, then close them
3. What happens if you forget to call `client.release()` after `pool.connect()`? Simulate a connection leak and observe the pool exhausting

## Common Mistakes

- Forgetting `client.release()` — the connection is never returned to the pool, eventually exhausting all connections (connection leak)
- Using `pool.connect()` when `pool.query()` suffices — manual connect/release is only needed for transactions
- Setting pool max too high — PostgreSQL's `max_connections` is shared by all clients. If you have 5 Node.js processes each with max=50, that's 250 possible connections
- Not handling pool exhaustion errors — when all connections are busy and the queue times out, handle the error gracefully instead of crashing
