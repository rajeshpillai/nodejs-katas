---
id: metrics
phase: 12
phase_title: Observability & Reliability
sequence: 3
title: Application Metrics
difficulty: intermediate
tags: [metrics, counters, histograms, prometheus, monitoring]
prerequisites: [health-checks]
estimated_minutes: 15
---

## Concept

Metrics are numbers that describe the behavior of your system over time. The three fundamental metric types:

**Counter** — a value that only increases (resets on restart):
- Total HTTP requests
- Total errors
- Total bytes processed

**Gauge** — a value that goes up and down:
- Active connections
- Memory usage
- Queue depth

**Histogram** — measures the distribution of values:
- Request latency (p50, p95, p99)
- Response size
- Query duration

**RED method** (for request-driven services):
- **R**ate — requests per second
- **E**rrors — errors per second
- **D**uration — latency distribution

**USE method** (for resources):
- **U**tilization — how busy is it? (CPU %, pool connections in use)
- **S**aturation — how much work is waiting? (queue depth)
- **E**rrors — error count

## Key Insight

> Logs tell you *what happened* to a specific request. Metrics tell you *how the system is behaving* overall. A single slow query shows up in logs; a trend of increasing p99 latency shows up in metrics. You need both: metrics for alerting and dashboards, logs for debugging specific incidents. Metrics are cheap to store (one number per time series per interval), logs are expensive (one entry per event).

## Experiment

```js
console.log("=== Application Metrics ===\n");

// --- Build a metrics collector ---

class Counter {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.values = new Map(); // labels → count
  }

  inc(labels = {}, value = 1) {
    const key = JSON.stringify(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  get(labels = {}) {
    return this.values.get(JSON.stringify(labels)) || 0;
  }

  getAll() {
    const results = [];
    for (const [key, value] of this.values) {
      results.push({ labels: JSON.parse(key), value });
    }
    return results;
  }
}

class Gauge {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.values = new Map();
  }

  set(labels = {}, value) {
    this.values.set(JSON.stringify(labels), value);
  }

  inc(labels = {}, value = 1) {
    const key = JSON.stringify(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labels = {}, value = 1) {
    const key = JSON.stringify(labels);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  get(labels = {}) {
    return this.values.get(JSON.stringify(labels)) || 0;
  }
}

class Histogram {
  constructor(name, help, buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets.sort((a, b) => a - b);
    this.observations = new Map();
  }

  observe(labels = {}, value) {
    const key = JSON.stringify(labels);
    if (!this.observations.has(key)) {
      this.observations.set(key, []);
    }
    this.observations.get(key).push(value);
  }

  getStats(labels = {}) {
    const key = JSON.stringify(labels);
    const values = this.observations.get(key) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  getBuckets(labels = {}) {
    const key = JSON.stringify(labels);
    const values = this.observations.get(key) || [];

    return this.buckets.map(threshold => ({
      le: threshold,
      count: values.filter(v => v <= threshold).length,
    }));
  }
}

// --- Demo 1: HTTP request metrics ---

console.log("--- HTTP request metrics ---\n");

const httpRequests = new Counter("http_requests_total", "Total HTTP requests");
const httpDuration = new Histogram("http_request_duration_ms", "Request latency");
const activeConnections = new Gauge("http_active_connections", "Active connections");

// Simulate HTTP traffic
const routes = [
  { method: "GET", path: "/api/users", status: 200, latency: () => 10 + Math.random() * 40 },
  { method: "GET", path: "/api/users", status: 200, latency: () => 15 + Math.random() * 35 },
  { method: "POST", path: "/api/users", status: 201, latency: () => 20 + Math.random() * 80 },
  { method: "GET", path: "/api/orders", status: 200, latency: () => 30 + Math.random() * 70 },
  { method: "GET", path: "/api/users", status: 500, latency: () => 5 + Math.random() * 10 },
  { method: "GET", path: "/api/products", status: 200, latency: () => 8 + Math.random() * 20 },
  { method: "DELETE", path: "/api/users", status: 204, latency: () => 15 + Math.random() * 25 },
];

// Simulate 200 requests
for (let i = 0; i < 200; i++) {
  const route = routes[Math.floor(Math.random() * routes.length)];
  const labels = { method: route.method, path: route.path, status: route.status };

  activeConnections.inc();
  httpRequests.inc(labels);
  httpDuration.observe({ method: route.method, path: route.path }, route.latency());
  activeConnections.dec();
}

// Display counters
console.log("  Request counts by route:\n");
for (const { labels, value } of httpRequests.getAll()) {
  console.log(`    ${labels.method} ${labels.path} [${labels.status}]: ${value}`);
}

// Display histograms
console.log("\n  Latency distribution:\n");
for (const path of ["/api/users", "/api/orders", "/api/products"]) {
  const stats = httpDuration.getStats({ method: "GET", path });
  if (stats) {
    console.log(`    GET ${path}:`);
    console.log(`      count=${stats.count} avg=${stats.avg.toFixed(0)}ms p50=${stats.p50.toFixed(0)}ms p95=${stats.p95.toFixed(0)}ms p99=${stats.p99.toFixed(0)}ms`);
  }
}

// --- Demo 2: Database metrics ---

console.log("\n--- Database connection pool metrics ---\n");

const poolTotal = new Gauge("db_pool_total", "Total pool connections");
const poolActive = new Gauge("db_pool_active", "Active pool connections");
const poolWaiting = new Gauge("db_pool_waiting", "Waiting for connection");
const queryDuration = new Histogram("db_query_duration_ms", "Query latency");

// Simulate pool metrics over time
poolTotal.set({}, 10);

for (let i = 0; i < 100; i++) {
  const active = Math.floor(Math.random() * 10);
  poolActive.set({}, active);
  poolWaiting.set({}, Math.max(0, Math.floor(Math.random() * 5) - 2));
  queryDuration.observe({}, 2 + Math.random() * 50);
}

console.log(`  Pool total: ${poolTotal.get({})}`);
console.log(`  Pool active: ${poolActive.get({})}`);
console.log(`  Pool waiting: ${poolWaiting.get({})}`);

const queryStats = queryDuration.getStats({});
console.log(`  Query latency: avg=${queryStats.avg.toFixed(1)}ms p95=${queryStats.p95.toFixed(1)}ms p99=${queryStats.p99.toFixed(1)}ms`);

// --- Demo 3: RED metrics summary ---

console.log("\n--- RED metrics summary ---\n");

const totalRequests = httpRequests.getAll().reduce((sum, m) => sum + m.value, 0);
const errorRequests = httpRequests.getAll()
  .filter(m => m.labels.status >= 500)
  .reduce((sum, m) => sum + m.value, 0);

const overallStats = httpDuration.getStats({ method: "GET", path: "/api/users" });

console.log(`  Rate:     ${totalRequests} total requests`);
console.log(`  Errors:   ${errorRequests} errors (${((errorRequests / totalRequests) * 100).toFixed(1)}% error rate)`);
console.log(`  Duration: p50=${overallStats.p50.toFixed(0)}ms p95=${overallStats.p95.toFixed(0)}ms p99=${overallStats.p99.toFixed(0)}ms`);

// --- Demo 4: Prometheus exposition format ---

console.log("\n--- Prometheus exposition format (GET /metrics) ---\n");

function toPrometheus(metrics) {
  const lines = [];

  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);

    if (metric instanceof Counter) {
      lines.push(`# TYPE ${metric.name} counter`);
      for (const { labels, value } of metric.getAll()) {
        const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
        lines.push(`${metric.name}{${labelStr}} ${value}`);
      }
    }

    if (metric instanceof Gauge) {
      lines.push(`# TYPE ${metric.name} gauge`);
      for (const [key, value] of metric.values) {
        const labels = JSON.parse(key);
        const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
        lines.push(`${metric.name}{${labelStr}} ${value}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

const output = toPrometheus([httpRequests, poolActive, poolWaiting]);
// Show first 15 lines
const outputLines = output.split("\n").slice(0, 15);
for (const line of outputLines) {
  console.log(`  ${line}`);
}
console.log("  ...");
```

## Expected Output

```
=== Application Metrics ===

--- HTTP request metrics ---

  Request counts by route:

    GET /api/users [200]: ~57
    POST /api/users [201]: ~28
    ...

  Latency distribution:

    GET /api/users:
      count=57 avg=30ms p50=28ms p95=48ms p99=49ms
  ...
```

## Challenge

1. Build a middleware that automatically collects RED metrics for every HTTP endpoint and exposes them at `GET /metrics` in Prometheus format
2. Implement a sliding window rate calculator: "requests per second in the last 60 seconds" using a circular buffer of 1-second buckets
3. Why is p99 latency more important than average latency for user experience? If your average is 20ms but p99 is 2000ms, what does that tell you?

## Common Mistakes

- Only tracking averages — averages hide tail latency. Always track percentiles (p50, p95, p99)
- High-cardinality labels — adding `userId` as a label creates millions of time series, overwhelming your metrics backend
- Not tracking error rates — a service returning errors might look "fast" because errors are quick to generate
- Exposing metrics on the public port — metrics can reveal internal details. Use a separate internal port
