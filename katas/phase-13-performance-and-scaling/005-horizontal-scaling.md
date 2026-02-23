---
id: horizontal-scaling
phase: 13
phase_title: Performance & Scaling
sequence: 5
title: Horizontal Scaling
difficulty: advanced
tags: [scaling, cluster, load-balancer, horizontal, vertical, stateless]
prerequisites: [load-testing]
estimated_minutes: 15
---

## Concept

When a single Node.js process can't handle the load, you scale:

**Vertical scaling** — bigger machine (more CPU, RAM):
- Simple but limited (there's a biggest machine)
- Node.js is single-threaded — more cores don't help a single process

**Horizontal scaling** — more processes/machines:
- Node.js cluster module — multiple processes on one machine
- Multiple machines behind a load balancer
- Scales indefinitely (add more machines)

**The cluster module:**
```js
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  const numWorkers = availableParallelism();
  for (let i = 0; i < numWorkers; i++) cluster.fork();
} else {
  createServer(handler).listen(6001); // Workers share the port!
}
```

**Requirements for horizontal scaling:**
1. **Stateless processes** — no in-memory sessions, caches, or state
2. **Shared storage** — database for state, Redis for sessions/cache
3. **Sticky sessions** (if needed) — WebSockets, file uploads
4. **Idempotent operations** — retries must be safe

## Key Insight

> Horizontal scaling works because Node.js processes are independent. Each worker has its own V8 heap, event loop, and connection pool. A load balancer distributes requests across workers, and since each request is handled by a single worker, there's no shared-memory contention. The constraint is that ALL state must be external (database, Redis, S3) — if you store anything in a module-level variable, other workers won't see it.

## Experiment

```js
console.log("=== Horizontal Scaling ===\n");

// --- Demo 1: Why single-process Node.js has a ceiling ---

console.log("--- Single process limitations ---\n");

const cpuCount = (await import("node:os")).availableParallelism();
console.log(`  CPU cores available: ${cpuCount}`);
console.log(`  Single Node.js process uses: 1 core`);
console.log(`  Utilization: ${((1 / cpuCount) * 100).toFixed(0)}% of available CPU\n`);

console.log(`  With cluster (${cpuCount} workers):`);
console.log(`  Utilization: ~100% of available CPU`);
console.log(`  Theoretical speedup: ~${cpuCount}x for CPU-bound work\n`);

// --- Demo 2: Simulated cluster ---

class SimulatedLoadBalancer {
  constructor(workers, strategy = "round-robin") {
    this.workers = workers;
    this.strategy = strategy;
    this.nextWorker = 0;
    this.requestLog = [];
  }

  route(request) {
    let worker;

    switch (this.strategy) {
      case "round-robin":
        worker = this.workers[this.nextWorker % this.workers.length];
        this.nextWorker++;
        break;
      case "least-connections":
        worker = this.workers.reduce((min, w) =>
          w.activeConnections < min.activeConnections ? w : min
        );
        break;
      case "random":
        worker = this.workers[Math.floor(Math.random() * this.workers.length)];
        break;
    }

    worker.handle(request);
    this.requestLog.push({ request: request.id, worker: worker.id });
    return worker;
  }

  getDistribution() {
    const dist = {};
    for (const entry of this.requestLog) {
      dist[`Worker ${entry.worker}`] = (dist[`Worker ${entry.worker}`] || 0) + 1;
    }
    return dist;
  }
}

class SimulatedWorker {
  constructor(id) {
    this.id = id;
    this.requestsHandled = 0;
    this.activeConnections = 0;
    this.totalLatency = 0;
  }

  handle(request) {
    this.activeConnections++;
    this.requestsHandled++;
    const latency = 5 + Math.random() * 20;
    this.totalLatency += latency;
    // Simulate processing
    this.activeConnections--;
    return latency;
  }

  avgLatency() {
    return this.requestsHandled > 0
      ? (this.totalLatency / this.requestsHandled).toFixed(1)
      : 0;
  }
}

// Create workers and load balancer
const workers = Array.from({ length: 4 }, (_, i) => new SimulatedWorker(i + 1));
const lb = new SimulatedLoadBalancer(workers, "round-robin");

// Simulate 1000 requests
for (let i = 0; i < 1000; i++) {
  lb.route({ id: i + 1, path: "/api/data" });
}

console.log("--- Load distribution (round-robin, 4 workers) ---\n");

const dist = lb.getDistribution();
for (const [worker, count] of Object.entries(dist)) {
  const bar = "█".repeat(Math.round(count / 20));
  console.log(`  ${worker}: ${String(count).padStart(4)} requests ${bar}`);
}

console.log(`\n  Total: ${lb.requestLog.length} requests across ${workers.length} workers`);
console.log(`  Per worker avg: ${Math.round(lb.requestLog.length / workers.length)} requests\n`);

// --- Demo 3: Load balancing strategies ---

console.log("--- Load balancing strategies ---\n");

const strategies = ["round-robin", "least-connections", "random"];

for (const strategy of strategies) {
  const ws = Array.from({ length: 4 }, (_, i) => new SimulatedWorker(i + 1));
  const testLb = new SimulatedLoadBalancer(ws, strategy);

  for (let i = 0; i < 1000; i++) testLb.route({ id: i });

  const d = testLb.getDistribution();
  const counts = Object.values(d);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const stddev = Math.sqrt(
    counts.reduce((sum, c) => sum + Math.pow(c - 250, 2), 0) / counts.length
  );

  console.log(`  ${strategy.padEnd(20)} min=${min} max=${max} stddev=${stddev.toFixed(1)}`);
}

// --- Demo 4: Stateless vs stateful ---

console.log("\n--- Stateless requirement ---\n");

// BAD: In-memory state
console.log("  BAD: In-memory state (breaks with multiple workers)\n");
console.log(`    // Worker 1 stores session
    sessions.set('abc123', { user: 'alice' });

    // Worker 2 gets the next request → session not found!
    sessions.get('abc123'); // undefined ← different process memory
  `);

// GOOD: External state
console.log("  GOOD: External state (works with any number of workers)\n");
console.log(`    // Any worker stores session in Redis
    await redis.set('session:abc123', JSON.stringify({ user: 'alice' }));

    // Any worker can read it
    const session = JSON.parse(await redis.get('session:abc123'));
  `);

// State that must be externalized
const stateTable = [
  ["State Type", "Bad (In-Memory)", "Good (External)"],
  ["Sessions", "Map in process memory", "Redis or database"],
  ["Cache", "Module-level Map", "Redis with TTL"],
  ["Rate limiting", "Counter in memory", "Redis INCR with EXPIRE"],
  ["File uploads", "Temp dir on disk", "S3 or shared storage"],
  ["WebSocket state", "Worker-local Map", "Redis pub/sub for cross-worker"],
  ["Job queue", "Array in memory", "Redis list or PostgreSQL table"],
];

console.log(`  ${stateTable[0][0].padEnd(16)} ${stateTable[0][1].padEnd(26)} ${stateTable[0][2]}`);
console.log(`  ${"-".repeat(70)}`);
for (const row of stateTable.slice(1)) {
  console.log(`  ${row[0].padEnd(16)} ${row[1].padEnd(26)} ${row[2]}`);
}

// --- Demo 5: Scaling math ---

console.log("\n--- Scaling math ---\n");

const scenarios = [
  { rpsPerWorker: 500, workers: 1 },
  { rpsPerWorker: 500, workers: 4 },
  { rpsPerWorker: 500, workers: 8 },
  { rpsPerWorker: 500, workers: 16 },
];

console.log(`  ${"Workers".padEnd(10)} ${"RPS/worker".padEnd(14)} ${"Total RPS".padEnd(12)} Notes`);
console.log(`  ${"-".repeat(60)}`);

for (const s of scenarios) {
  const total = s.rpsPerWorker * s.workers;
  const note = s.workers === 1 ? "Single process"
    : s.workers <= cpuCount ? `${s.workers} workers (1 machine)`
    : `${s.workers} workers (multiple machines)`;
  console.log(`  ${String(s.workers).padEnd(10)} ${String(s.rpsPerWorker).padEnd(14)} ${String(total).padEnd(12)} ${note}`);
}

// --- Demo 6: Cluster module pattern ---

console.log("\n=== Cluster Module Pattern ===\n");

console.log(`  import cluster from 'cluster';
  import { availableParallelism } from 'os';
  import http from 'http';

  if (cluster.isPrimary) {
    console.log('Primary ' + process.pid + ' is running');

    const numWorkers = availableParallelism();
    for (let i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.log('Worker ' + worker.process.pid + ' died');
      cluster.fork(); // Auto-restart
    });

  } else {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('Handled by worker ' + process.pid);
    });

    server.listen(6001);
    console.log('Worker ' + process.pid + ' started');
  }
`);

console.log("  How workers share a port:");
console.log("    - Primary creates the server socket");
console.log("    - Primary passes the socket fd to each worker");
console.log("    - OS distributes connections across workers");
console.log("    - On Linux: round-robin (since Node 12+)");
console.log("    - On macOS: least-loaded (kernel decides)");
```

## Expected Output

```
=== Horizontal Scaling ===

--- Single process limitations ---

  CPU cores available: <N>
  Single Node.js process uses: 1 core
  Utilization: <100/N>% of available CPU

--- Load distribution (round-robin, 4 workers) ---

  Worker 1:  250 requests ████████████
  Worker 2:  250 requests ████████████
  Worker 3:  250 requests ████████████
  Worker 4:  250 requests ████████████

--- Load balancing strategies ---

  round-robin          min=250 max=250 stddev=0.0
  least-connections    min=~245 max=~255 stddev=~3
  random               min=~230 max=~270 stddev=~10
  ...
```

## Challenge

1. Implement a cluster-based HTTP server that forks one worker per CPU core, auto-restarts crashed workers, and distributes traffic. Measure throughput vs a single-process server
2. Build a "sticky session" load balancer that hashes the session cookie to consistently route the same client to the same worker — needed for WebSocket connections
3. Design a scaling strategy for an API that handles 10,000 RPS with a p99 of 50ms. How many workers do you need? How many machines? What are the bottlenecks?

## Common Mistakes

- Storing session data in process memory — the next request may hit a different worker
- Forking too many workers — more workers than CPU cores causes context switching overhead
- Not auto-restarting crashed workers — a single uncaught exception permanently reduces capacity
- Assuming linear scaling — database connections, shared caches, and network become bottlenecks. 8 workers doesn't mean 8x throughput
