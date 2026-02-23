---
id: postgresql-architecture
phase: 9
phase_title: PostgreSQL Integration
sequence: 1
title: PostgreSQL Architecture Overview
difficulty: intermediate
tags: [postgresql, database, architecture, client-server, processes]
prerequisites: [tcp-basics]
estimated_minutes: 12
---

## Concept

PostgreSQL is a client-server database system. Understanding its architecture helps you make better decisions about connection management, query optimization, and error handling in Node.js.

**How PostgreSQL works internally:**

1. **Postmaster** — the main process that listens for connections
2. **Backend processes** — one OS process per client connection (not threads!)
3. **Shared memory** — shared buffers, WAL buffers, lock tables
4. **WAL (Write-Ahead Log)** — every change is logged before it's applied, ensuring durability

**The connection lifecycle:**

```
Node.js → TCP connect to port 5432
        → Authentication (username, password, SSL)
        → Startup message exchange
        → Ready for queries
        → Query → Parse → Plan → Execute → Results
        → ... (more queries)
        → Terminate
```

Each connection gets its own dedicated backend process in PostgreSQL. This means:
- Connections are **expensive** to create (~10-100ms for TCP + auth + process fork)
- Each connection consumes **memory** (~5-10 MB per backend process)
- PostgreSQL has a **max_connections** limit (default 100)

This is why connection pooling is essential — you reuse a small pool of connections instead of creating new ones per request.

## Key Insight

> Every PostgreSQL connection is a separate OS process. Creating connections is expensive (fork + auth), and each one consumes real memory. A Node.js server handling 1000 concurrent requests must NOT open 1000 database connections — it should share 10-20 pooled connections. The pool queues requests, and each request borrows a connection briefly, then returns it.

## Experiment

```js
// This kata is conceptual — it explains PostgreSQL architecture
// without requiring a running database. The code demonstrates
// the concepts through simulation.

console.log("=== PostgreSQL Architecture ===\n");

// Simulate PostgreSQL's architecture
class SimulatedPostgreSQL {
  constructor(config = {}) {
    this.maxConnections = config.maxConnections || 100;
    this.backends = new Map();  // connectionId → backend process
    this.nextId = 1;
    this.sharedBuffers = new Map();  // Simulated shared memory
    this.wal = [];  // Write-ahead log
  }

  connect(user) {
    if (this.backends.size >= this.maxConnections) {
      throw new Error(`too many connections (max ${this.maxConnections})`);
    }

    const id = this.nextId++;
    const backend = {
      id,
      user,
      pid: 1000 + id,  // Simulated OS PID
      memory: Math.round(5 + Math.random() * 5),  // 5-10 MB per backend
      state: "idle",
      connectedAt: Date.now(),
      queriesRun: 0,
    };

    this.backends.set(id, backend);
    return { connectionId: id, pid: backend.pid };
  }

  query(connectionId, sql) {
    const backend = this.backends.get(connectionId);
    if (!backend) throw new Error("Connection not found");

    backend.state = "active";
    backend.queriesRun++;

    // Simulate query processing
    // 1. Parse SQL
    // 2. Plan execution
    // 3. Execute
    // 4. Return results

    // Log to WAL (if it's a write)
    if (sql.match(/^(INSERT|UPDATE|DELETE)/i)) {
      this.wal.push({
        lsn: this.wal.length + 1,
        sql: sql.slice(0, 50),
        timestamp: Date.now(),
      });
    }

    backend.state = "idle";
    return { rows: [], rowCount: 0 };
  }

  disconnect(connectionId) {
    this.backends.delete(connectionId);
  }

  getStatus() {
    let totalMemory = 0;
    let activeCount = 0;
    let idleCount = 0;

    for (const backend of this.backends.values()) {
      totalMemory += backend.memory;
      if (backend.state === "active") activeCount++;
      else idleCount++;
    }

    return {
      connections: this.backends.size,
      maxConnections: this.maxConnections,
      active: activeCount,
      idle: idleCount,
      totalMemoryMB: totalMemory,
      walEntries: this.wal.length,
    };
  }
}

const pg = new SimulatedPostgreSQL({ maxConnections: 10 });

// Demonstrate connection lifecycle
console.log("--- Connection lifecycle ---\n");

const conn1 = pg.connect("app_user");
console.log("Connected:", conn1);

pg.query(conn1.connectionId, "SELECT * FROM users WHERE id = 1");
pg.query(conn1.connectionId, "INSERT INTO logs (message) VALUES ('hello')");

console.log("Status:", pg.getStatus());

pg.disconnect(conn1.connectionId);
console.log("Disconnected. Status:", pg.getStatus());

console.log("\n--- Connection cost demonstration ---\n");

// Show why connections are expensive
const connections = [];
const startTime = performance.now();

for (let i = 0; i < 10; i++) {
  connections.push(pg.connect("user_" + i));
}

console.log(`Created 10 connections`);
console.log("Status:", pg.getStatus());
console.log(`Memory used by backends: ~${pg.getStatus().totalMemoryMB} MB`);

// What happens when you hit the limit?
console.log("\n--- Connection limit ---\n");

try {
  // Already have 10 connections, max is 10
  pg.connect("one_too_many");
} catch (err) {
  console.log("Error:", err.message);
  console.log("(This is what happens in production without connection pooling!)");
}

// Clean up
for (const conn of connections) {
  pg.disconnect(conn.connectionId);
}

console.log("\n=== Why Connection Pooling Matters ===\n");

// Without pooling: 1 connection per request
const requestCount = 100;
const connTime = 50;  // ms to create connection
const queryTime = 5;   // ms to run query

const withoutPool = requestCount * (connTime + queryTime);
console.log(`Without pooling (${requestCount} requests):`);
console.log(`  Each request: ${connTime}ms connect + ${queryTime}ms query = ${connTime + queryTime}ms`);
console.log(`  Total: ${withoutPool}ms`);
console.log(`  Peak connections: ${requestCount}`);

// With pooling: reuse connections
const poolSize = 10;
const withPool = requestCount * queryTime;  // No connection overhead
console.log(`\nWith pooling (pool size ${poolSize}):`);
console.log(`  Each request: ${queryTime}ms query (connection already open)`);
console.log(`  Total: ~${withPool}ms (queries run through ${poolSize} connections)`);
console.log(`  Peak connections: ${poolSize}`);
console.log(`  Speedup: ~${(withoutPool / (withPool / poolSize * requestCount / poolSize)).toFixed(0)}x`);

console.log("\n=== PostgreSQL Wire Protocol ===\n");

// Show the message types in the PostgreSQL protocol
const messages = [
  { direction: "→", name: "StartupMessage", desc: "Client sends version, user, database" },
  { direction: "←", name: "AuthenticationOk", desc: "Server accepts credentials" },
  { direction: "←", name: "ReadyForQuery", desc: "Server ready to accept SQL" },
  { direction: "→", name: "Query", desc: "Client sends SQL string" },
  { direction: "←", name: "RowDescription", desc: "Column names and types" },
  { direction: "←", name: "DataRow", desc: "One row of results (repeated)" },
  { direction: "←", name: "CommandComplete", desc: "Query finished" },
  { direction: "←", name: "ReadyForQuery", desc: "Ready for next query" },
  { direction: "→", name: "Terminate", desc: "Client closing connection" },
];

console.log("PostgreSQL wire protocol (simplified):");
for (const msg of messages) {
  console.log(`  ${msg.direction} ${msg.name.padEnd(20)} ${msg.desc}`);
}

console.log("\n=== Key Configuration Parameters ===\n");

const params = [
  ["max_connections", "100", "Max simultaneous connections"],
  ["shared_buffers", "128MB", "Shared memory for caching"],
  ["work_mem", "4MB", "Memory per sort/hash operation"],
  ["wal_level", "replica", "WAL detail level"],
  ["checkpoint_timeout", "5min", "Time between WAL checkpoints"],
  ["statement_timeout", "0", "Max query execution time (0=unlimited)"],
];

console.log("Important PostgreSQL settings:");
for (const [name, default_, desc] of params) {
  console.log(`  ${name.padEnd(22)} ${default_.padEnd(10)} ${desc}`);
}
```

## Expected Output

```
=== PostgreSQL Architecture ===

--- Connection lifecycle ---

Connected: { connectionId: 1, pid: 1001 }
Status: { connections: 1, maxConnections: 10, active: 0, idle: 1, ... }
Disconnected. Status: { connections: 0, ... }

--- Connection cost demonstration ---

Created 10 connections
Status: { connections: 10, maxConnections: 10, ... }
Memory used by backends: ~75 MB

--- Connection limit ---

Error: too many connections (max 10)
(This is what happens in production without connection pooling!)

=== Why Connection Pooling Matters ===

Without pooling (100 requests):
  Each request: 50ms connect + 5ms query = 55ms
  Total: 5500ms
  Peak connections: 100

With pooling (pool size 10):
  Each request: 5ms query (connection already open)
  ...

=== PostgreSQL Wire Protocol ===

...
```

## Challenge

1. Research the actual PostgreSQL wire protocol: what does the `StartupMessage` look like as raw bytes? It starts with a 4-byte length, then a 4-byte protocol version (196608 = 3.0)
2. Why does PostgreSQL use one process per connection instead of threads? What are the tradeoffs?
3. Calculate the maximum number of connections your server should use: `max_connections - superuser_reserved_connections - replication_slots`

## Common Mistakes

- Opening a new connection per HTTP request — creates hundreds of connections and hits `max_connections`
- Not setting `statement_timeout` — a runaway query can hold a connection and a backend process forever
- Setting `max_connections` very high (500+) — each connection uses 5-10 MB of RAM in the PostgreSQL process
- Assuming database connections are free — they're expensive OS resources that must be pooled and managed
