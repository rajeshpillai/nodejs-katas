---
id: health-checks
phase: 12
phase_title: Observability & Reliability
sequence: 2
title: Health Checks and Readiness Probes
difficulty: intermediate
tags: [health, readiness, liveness, kubernetes, monitoring]
prerequisites: [structured-logging]
estimated_minutes: 12
---

## Concept

Health checks answer the question: "Is this service working?" There are two kinds:

**Liveness probe** — "Is the process alive and not stuck?"
- Returns 200 if the event loop is responsive
- If it fails, the orchestrator restarts the process
- Should be fast and have no side effects
- Endpoint: `GET /health` or `GET /healthz`

**Readiness probe** — "Can this service handle requests?"
- Checks dependencies: database, cache, external services
- If it fails, the load balancer stops sending traffic
- Can be slow (database ping, cache check)
- Endpoint: `GET /ready` or `GET /readyz`

```js
// Liveness: just check the event loop responds
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: check all dependencies
app.get('/readyz', async (req, res) => {
  const db = await checkDatabase();
  const cache = await checkCache();
  const status = db.ok && cache.ok ? 200 : 503;
  res.status(status).json({ db, cache });
});
```

## Key Insight

> A liveness check should never call the database. Its only job is to prove the event loop isn't stuck. A readiness check should verify all dependencies because it determines whether the service can actually serve requests. If your readiness check calls the database and the database is down, the load balancer routes traffic away from this instance — which is exactly what you want. If your liveness check calls the database, a database outage causes all instances to restart, making things worse.

## Experiment

```js
console.log("=== Health Checks and Readiness Probes ===\n");

// --- Simulated service with health checks ---

class HealthChecker {
  constructor() {
    this.startedAt = Date.now();
    this.dependencies = new Map();
    this.checks = [];
  }

  // Register a dependency check
  addCheck(name, checkFn, options = {}) {
    this.checks.push({
      name,
      checkFn,
      critical: options.critical !== false, // default: critical
      timeout: options.timeout || 3000,
    });
  }

  // Liveness: is the process responsive?
  liveness() {
    return {
      status: "ok",
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      pid: process.pid,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  // Readiness: can we serve requests?
  async readiness() {
    const results = {};
    let allHealthy = true;

    for (const check of this.checks) {
      const start = performance.now();
      try {
        const result = await Promise.race([
          check.checkFn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), check.timeout)
          ),
        ]);
        results[check.name] = {
          status: "ok",
          latencyMs: Math.round(performance.now() - start),
          ...result,
        };
      } catch (err) {
        results[check.name] = {
          status: "error",
          error: err.message,
          latencyMs: Math.round(performance.now() - start),
        };
        if (check.critical) allHealthy = false;
      }
    }

    return {
      status: allHealthy ? "ok" : "degraded",
      httpStatus: allHealthy ? 200 : 503,
      checks: results,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  // Detailed: full system info
  async detailed() {
    const readiness = await this.readiness();
    const mem = process.memoryUsage();

    return {
      ...readiness,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
          rss: Math.round(mem.rss / 1024 / 1024) + "MB",
          external: Math.round(mem.external / 1024 / 1024) + "MB",
        },
        uptime: Math.floor((Date.now() - this.startedAt) / 1000) + "s",
      },
    };
  }
}

const health = new HealthChecker();

// --- Demo 1: Liveness check ---

console.log("--- Liveness check (GET /healthz) ---\n");

const liveness = health.liveness();
console.log(`  Response: ${JSON.stringify(liveness, null, 2).split("\n").join("\n  ")}\n`);

// --- Demo 2: Readiness with all dependencies healthy ---

console.log("--- Readiness check (all healthy) ---\n");

// Simulate dependency checks
health.addCheck("database", async () => {
  await new Promise(r => setTimeout(r, 5));
  return { connections: 8, maxConnections: 20 };
});

health.addCheck("cache", async () => {
  await new Promise(r => setTimeout(r, 2));
  return { hitRate: 0.94 };
});

health.addCheck("storage", async () => {
  await new Promise(r => setTimeout(r, 3));
  return { availableGB: 42 };
}, { critical: false }); // Non-critical

const readyResult = await health.readiness();
console.log(`  Status: ${readyResult.status} (HTTP ${readyResult.httpStatus})`);
console.log(`  Checks:`);
for (const [name, result] of Object.entries(readyResult.checks)) {
  console.log(`    ${name}: ${result.status} (${result.latencyMs}ms)`);
}

// --- Demo 3: Readiness with failed dependency ---

console.log("\n--- Readiness check (database down) ---\n");

const health2 = new HealthChecker();

health2.addCheck("database", async () => {
  throw new Error("ECONNREFUSED: connection refused");
});

health2.addCheck("cache", async () => {
  await new Promise(r => setTimeout(r, 2));
  return { hitRate: 0.91 };
});

health2.addCheck("storage", async () => {
  return { availableGB: 42 };
}, { critical: false });

const degradedResult = await health2.readiness();
console.log(`  Status: ${degradedResult.status} (HTTP ${degradedResult.httpStatus})`);
console.log(`  Checks:`);
for (const [name, result] of Object.entries(degradedResult.checks)) {
  const icon = result.status === "ok" ? "✓" : "✗";
  const extra = result.error ? ` — ${result.error}` : "";
  console.log(`    ${icon} ${name}: ${result.status}${extra}`);
}
console.log(`\n  Load balancer should stop sending traffic (503)\n`);

// --- Demo 4: Timeout handling ---

console.log("--- Dependency timeout ---\n");

const health3 = new HealthChecker();

health3.addCheck("slow-service", async () => {
  await new Promise(r => setTimeout(r, 5000)); // Takes 5s
  return { ok: true };
}, { timeout: 100 }); // But timeout is 100ms

const timeoutResult = await health3.readiness();
console.log(`  Status: ${timeoutResult.status}`);
for (const [name, result] of Object.entries(timeoutResult.checks)) {
  console.log(`  ${name}: ${result.status} — ${result.error || "ok"} (${result.latencyMs}ms)`);
}

// --- Demo 5: Detailed health endpoint ---

console.log("\n--- Detailed health (GET /health/detailed) ---\n");

const detailed = await health.detailed();
console.log(`  ${JSON.stringify(detailed, null, 2).split("\n").join("\n  ")}`);

// --- Demo 6: HTTP server implementation ---

console.log("\n=== Implementation Pattern ===\n");

console.log(`  // Health check routes
  const healthChecker = new HealthChecker();
  healthChecker.addCheck('db', () => pool.query('SELECT 1'));
  healthChecker.addCheck('redis', () => redis.ping());

  // Liveness: lightweight, no dependencies
  router.get('/healthz', (req, res) => {
    res.json(healthChecker.liveness());
  });

  // Readiness: checks all dependencies
  router.get('/readyz', async (req, res) => {
    const result = await healthChecker.readiness();
    res.status(result.httpStatus).json(result);
  });

  // Kubernetes probe config:
  // livenessProbe:
  //   httpGet: { path: /healthz, port: 6001 }
  //   initialDelaySeconds: 5
  //   periodSeconds: 10
  // readinessProbe:
  //   httpGet: { path: /readyz, port: 6001 }
  //   initialDelaySeconds: 10
  //   periodSeconds: 5
`);
```

## Expected Output

```
=== Health Checks and Readiness Probes ===

--- Liveness check (GET /healthz) ---

  Response: {
    "status": "ok",
    "uptime": 0,
    "pid": <pid>,
    "memory": <MB>
  }

--- Readiness check (all healthy) ---

  Status: ok (HTTP 200)
  Checks:
    database: ok (5ms)
    cache: ok (2ms)
    storage: ok (3ms)

--- Readiness check (database down) ---

  Status: degraded (HTTP 503)
  Checks:
    ✗ database: error — ECONNREFUSED: connection refused
    ✓ cache: ok
    ✓ storage: ok

  Load balancer should stop sending traffic (503)
  ...
```

## Challenge

1. Implement a startup probe: the service reports "not ready" until all dependencies are connected and initial data is loaded, then switches to "ready"
2. Build a circuit breaker for health checks: if a dependency fails N times in a row, stop checking it for a cooldown period and report it as "circuit open"
3. What should happen if the health check endpoint itself is slow (e.g., database ping takes 10 seconds)? How do you prevent a slow dependency from making the health check timeout?

## Common Mistakes

- Making the liveness probe check the database — if the DB is down, all instances restart, causing a cascade failure
- Not setting timeouts on health check dependencies — a slow dependency makes the entire health check timeout
- Exposing detailed health information publicly — internal status should be on an internal port or behind authentication
- Returning 200 when dependencies are down — the load balancer will keep routing traffic to a broken instance
