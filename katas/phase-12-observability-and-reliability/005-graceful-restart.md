---
id: graceful-restart
phase: 12
phase_title: Observability & Reliability
sequence: 5
title: Graceful Restart and Zero-Downtime Deploys
difficulty: intermediate
tags: [graceful, restart, deploy, cluster, zero-downtime, rolling]
prerequisites: [crash-handling]
estimated_minutes: 15
---

## Concept

A graceful restart ensures no requests are dropped during deployments:

1. **New version starts** alongside the old version
2. **Load balancer** shifts traffic to the new version
3. **Old version** stops accepting new connections
4. **Old version** finishes in-flight requests
5. **Old version** exits cleanly

**Node.js cluster module** can achieve this within a single server:

```js
import cluster from 'node:cluster';
import { cpus } from 'node:os';

if (cluster.isPrimary) {
  // Fork workers
  for (let i = 0; i < cpus().length; i++) {
    cluster.fork();
  }

  // Graceful restart: replace workers one by one
  cluster.on('exit', (worker) => {
    if (!worker.exitedAfterDisconnect) {
      cluster.fork(); // Worker crashed — restart
    }
  });
} else {
  // Worker: run the HTTP server
  createServer(handler).listen(6001);
}
```

**Rolling restart pattern:**
1. Send `SIGUSR2` to the primary process
2. Primary forks new workers (with new code)
3. Once new workers are listening, disconnect old workers
4. Old workers finish in-flight requests and exit
5. Result: zero dropped connections

## Key Insight

> Zero-downtime deployment in Node.js requires running old and new workers simultaneously during the transition. The cluster module's `disconnect()` method tells a worker to stop accepting new connections but keep processing existing ones. Combined with the `listening` event on new workers, you can orchestrate a rolling restart where at least one healthy worker is always available.

## Experiment

```js
console.log("=== Graceful Restart and Zero-Downtime ===\n");

// Simulate the cluster module's rolling restart behavior

class SimulatedWorker {
  constructor(id, version) {
    this.id = id;
    this.version = version;
    this.state = "starting";
    this.connections = 0;
    this.totalRequests = 0;
    this.startedAt = Date.now();
  }

  listen() {
    this.state = "listening";
  }

  acceptRequest() {
    if (this.state !== "listening") return false;
    this.connections++;
    this.totalRequests++;
    return true;
  }

  finishRequest() {
    this.connections--;
  }

  disconnect() {
    this.state = "draining";
  }

  isDrained() {
    return this.state === "draining" && this.connections === 0;
  }

  exit() {
    this.state = "exited";
  }

  toString() {
    return `Worker#${this.id}(v${this.version}, ${this.state}, conns=${this.connections})`;
  }
}

class SimulatedCluster {
  constructor() {
    this.workers = [];
    this.nextId = 1;
    this.version = 1;
    this.logs = [];
  }

  log(msg) {
    this.logs.push(`  [${this.getTime()}] ${msg}`);
  }

  getTime() {
    return String(this.logs.length).padStart(3, "0");
  }

  fork() {
    const worker = new SimulatedWorker(this.nextId++, this.version);
    this.workers.push(worker);
    this.log(`Fork: ${worker}`);
    return worker;
  }

  startWorker(worker) {
    worker.listen();
    this.log(`Listening: ${worker}`);
  }

  getActiveWorkers() {
    return this.workers.filter(w => w.state === "listening");
  }

  getDrainingWorkers() {
    return this.workers.filter(w => w.state === "draining");
  }

  // Rolling restart: replace workers one at a time
  rollingRestart(newVersion) {
    this.version = newVersion;
    this.log(`--- Rolling restart to v${newVersion} ---`);

    const oldWorkers = this.getActiveWorkers();
    this.log(`Old workers to replace: ${oldWorkers.length}`);

    const steps = [];

    for (const oldWorker of oldWorkers) {
      // 1. Fork new worker
      const newWorker = this.fork();
      this.startWorker(newWorker);

      // 2. Disconnect old worker
      oldWorker.disconnect();
      this.log(`Disconnecting: ${oldWorker}`);

      // 3. Wait for drain
      if (oldWorker.connections > 0) {
        this.log(`Draining: ${oldWorker} (${oldWorker.connections} in-flight)`);
      }

      // Simulate finishing in-flight requests
      while (oldWorker.connections > 0) {
        oldWorker.finishRequest();
      }

      // 4. Exit old worker
      oldWorker.exit();
      this.log(`Exited: ${oldWorker}`);

      steps.push({
        replaced: oldWorker.id,
        replacedWith: newWorker.id,
      });
    }

    this.log(`--- Rolling restart complete (v${newVersion}) ---`);
    return steps;
  }

  status() {
    const active = this.getActiveWorkers();
    const draining = this.getDrainingWorkers();
    return {
      active: active.map(w => `W#${w.id}(v${w.version})`).join(", "),
      draining: draining.length,
      total: this.workers.filter(w => w.state !== "exited").length,
    };
  }

  printLogs() {
    for (const log of this.logs) {
      console.log(log);
    }
    this.logs = [];
  }
}

const cluster = new SimulatedCluster();

// --- Demo 1: Initial cluster startup ---

console.log("--- Initial cluster startup ---\n");

const workers = [];
for (let i = 0; i < 4; i++) {
  const w = cluster.fork();
  cluster.startWorker(w);
  workers[i] = w;
}

cluster.printLogs();
console.log(`\n  Status: ${JSON.stringify(cluster.status())}\n`);

// Simulate some traffic
for (const w of workers) {
  for (let i = 0; i < 3; i++) w.acceptRequest();
}
console.log("  Simulated traffic: 3 connections per worker\n");

// --- Demo 2: Rolling restart ---

console.log("--- Rolling restart (v1 → v2) ---\n");

// Simulate some in-flight requests
for (const w of cluster.getActiveWorkers()) {
  w.acceptRequest();
  w.acceptRequest();
}

cluster.rollingRestart(2);
cluster.printLogs();
console.log(`\n  Status: ${JSON.stringify(cluster.status())}\n`);

// --- Demo 3: Worker crash recovery ---

console.log("--- Worker crash recovery ---\n");

const crashWorker = cluster.getActiveWorkers()[0];
cluster.log(`CRASH: ${crashWorker} — uncaught exception`);
crashWorker.exit();

// Auto-restart crashed worker
const replacement = cluster.fork();
cluster.startWorker(replacement);
cluster.log("Crash recovery complete");

cluster.printLogs();
console.log(`\n  Status: ${JSON.stringify(cluster.status())}\n`);

// --- Demo 4: Zero-downtime during restart ---

console.log("--- Zero-downtime proof ---\n");

const timeline = [];
const testCluster = new SimulatedCluster();

// Start 2 workers
const w1 = testCluster.fork();
testCluster.startWorker(w1);
const w2 = testCluster.fork();
testCluster.startWorker(w2);

// Track available workers at each step
timeline.push({ step: "Initial", active: testCluster.getActiveWorkers().length });

// Simulate rolling restart
testCluster.version = 2;

// Replace w1
const w3 = testCluster.fork();
testCluster.startWorker(w3);
timeline.push({ step: "New W3 started", active: testCluster.getActiveWorkers().length });

w1.disconnect();
w1.exit();
timeline.push({ step: "Old W1 exited", active: testCluster.getActiveWorkers().length });

// Replace w2
const w4 = testCluster.fork();
testCluster.startWorker(w4);
timeline.push({ step: "New W4 started", active: testCluster.getActiveWorkers().length });

w2.disconnect();
w2.exit();
timeline.push({ step: "Old W2 exited", active: testCluster.getActiveWorkers().length });

console.log("  Step                    Active Workers");
console.log("  ────                    ──────────────");
for (const t of timeline) {
  const bar = "█".repeat(t.active) + "░".repeat(4 - t.active);
  console.log(`  ${t.step.padEnd(22)}  ${bar} (${t.active})`);
}
console.log("\n  Active workers never dropped to 0 → zero downtime!\n");

// --- Demo 5: Implementation patterns ---

console.log("=== Implementation Patterns ===\n");

console.log("Pattern 1: cluster module with graceful restart");
console.log(`
  import cluster from 'cluster';
  import { cpus } from 'os';

  if (cluster.isPrimary) {
    const numWorkers = cpus().length;

    for (let i = 0; i < numWorkers; i++) cluster.fork();

    // Rolling restart on SIGUSR2
    process.on('SIGUSR2', () => {
      const workers = Object.values(cluster.workers);
      let i = 0;

      function replaceNext() {
        if (i >= workers.length) return;
        const old = workers[i++];

        const replacement = cluster.fork();
        replacement.on('listening', () => {
          old.disconnect();
          old.on('exit', replaceNext);
        });
      }

      replaceNext();
    });

    // Auto-restart crashed workers
    cluster.on('exit', (worker, code) => {
      if (!worker.exitedAfterDisconnect) {
        console.log('Worker crashed, restarting...');
        cluster.fork();
      }
    });
  } else {
    // Worker
    const server = createServer(handler);
    server.listen(6001);

    // Graceful shutdown on disconnect
    process.on('disconnect', () => {
      server.close(() => process.exit(0));
    });
  }
`);

console.log("Pattern 2: PM2 cluster mode (simpler)");
console.log(`
  // ecosystem.config.cjs
  module.exports = {
    apps: [{
      name: 'api',
      script: 'server.js',
      instances: 'max',      // One per CPU
      exec_mode: 'cluster',
      max_restarts: 10,
      min_uptime: 5000,
      listen_timeout: 3000,
      kill_timeout: 5000,    // Time for graceful shutdown
    }]
  };

  // Zero-downtime restart:
  // pm2 reload api
`);
```

## Expected Output

```
=== Graceful Restart and Zero-Downtime ===

--- Initial cluster startup ---

  [000] Fork: Worker#1(v1, starting, conns=0)
  [001] Listening: Worker#1(v1, listening, conns=0)
  ...

--- Rolling restart (v1 → v2) ---

  [008] --- Rolling restart to v2 ---
  [009] Fork: Worker#5(v2, starting, conns=0)
  [010] Listening: Worker#5(v2, listening, conns=0)
  [011] Disconnecting: Worker#1(v1, draining, conns=2)
  [012] Draining: Worker#1(...) (2 in-flight)
  [013] Exited: Worker#1(v1, exited, conns=0)
  ...

--- Zero-downtime proof ---

  Step                    Active Workers
  ────                    ──────────────
  Initial                 ██░░ (2)
  New W3 started          ███░ (3)
  Old W1 exited           ██░░ (2)
  New W4 started          ███░ (3)
  Old W2 exited           ██░░ (2)

  Active workers never dropped to 0 → zero downtime!
```

## Challenge

1. Implement a complete rolling restart system using the `cluster` module that handles: SIGUSR2 for restart, worker crash recovery, and a configurable drain timeout
2. Build a health-check-aware restart: only disconnect the old worker after the new worker passes its readiness probe
3. What happens to WebSocket connections during a rolling restart? How would you implement connection draining for long-lived WebSocket connections?

## Deep Dive

Deployment strategies:

| Strategy | How it works | Downtime | Rollback |
|----------|-------------|----------|----------|
| Rolling restart | Replace workers one by one | Zero | Restart with old version |
| Blue/green | Run old+new, switch all at once | Zero | Switch back to blue |
| Canary | Route 5% to new, then gradually increase | Zero | Remove canary |
| Recreate | Stop old, start new | Yes (brief) | Redeploy old |

Node.js cluster module supports rolling restart natively. Blue/green and canary require a load balancer (Nginx, Kubernetes, etc.).

## Common Mistakes

- Killing workers immediately on deploy — drops in-flight requests. Always disconnect first and wait for drain
- Not auto-restarting crashed workers — one uncaught exception permanently reduces your worker count
- Setting the drain timeout too high — a single slow request can block the entire deploy
- Forgetting to handle SIGTERM in workers — Kubernetes sends SIGTERM before SIGKILL. Workers must shut down gracefully within the termination grace period
