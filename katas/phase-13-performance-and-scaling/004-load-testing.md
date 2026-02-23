---
id: load-testing
phase: 13
phase_title: Performance & Scaling
sequence: 4
title: Load Testing
difficulty: advanced
tags: [load-testing, autocannon, throughput, latency, benchmarking]
prerequisites: [event-loop-optimization]
estimated_minutes: 15
---

## Concept

Load testing answers: "How many requests can this server handle before performance degrades?"

**Key metrics:**
- **Throughput** — requests per second (RPS)
- **Latency** — time from request sent to response received (p50, p95, p99)
- **Error rate** — percentage of non-2xx responses
- **Saturation** — resource utilization (CPU, memory, connections)

**Load testing tools for Node.js:**
- `autocannon` — written in Node.js, great for HTTP APIs
- `wrk` — C-based, very fast, Lua scripting
- `k6` — Go-based, JavaScript test scripts
- `ab` (Apache Bench) — simple, comes with Apache

**Load patterns:**
1. **Constant load** — fixed RPS for a duration
2. **Ramp up** — gradually increase RPS to find the breaking point
3. **Spike** — sudden burst of traffic
4. **Soak** — sustained load for hours (finds memory leaks)

**What to look for:**
- At what RPS does p99 latency spike?
- At what RPS do errors start appearing?
- Does memory grow over time (leak)?
- How does the server recover after a spike?

## Key Insight

> The most important metric from a load test isn't peak throughput — it's the latency at your expected traffic level. A server that handles 50K RPS with 10ms p99 latency is great, but if p99 jumps to 2000ms at 5K RPS (your actual traffic), you have a problem. Always test at realistic load levels AND beyond them to find the breaking point.

## Experiment

```js
import http from "node:http";

console.log("=== Load Testing ===\n");

// --- Build a simple load tester ---

class LoadTester {
  constructor(options = {}) {
    this.url = options.url;
    this.duration = options.duration || 5000;
    this.connections = options.connections || 10;
    this.results = {
      requests: 0,
      errors: 0,
      latencies: [],
      statusCodes: {},
      bytesRead: 0,
    };
  }

  async makeRequest() {
    const start = performance.now();

    return new Promise((resolve) => {
      const url = new URL(this.url);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
      }, (res) => {
        let bytes = 0;
        res.on("data", chunk => bytes += chunk.length);
        res.on("end", () => {
          const latency = performance.now() - start;
          this.results.requests++;
          this.results.latencies.push(latency);
          this.results.bytesRead += bytes;
          this.results.statusCodes[res.statusCode] =
            (this.results.statusCodes[res.statusCode] || 0) + 1;
          resolve({ latency, status: res.statusCode });
        });
      });

      req.on("error", () => {
        this.results.errors++;
        this.results.requests++;
        resolve({ latency: performance.now() - start, error: true });
      });

      req.end();
    });
  }

  async run() {
    const start = performance.now();
    const end = start + this.duration;
    const workers = [];

    // Launch concurrent connections
    for (let i = 0; i < this.connections; i++) {
      workers.push(this._worker(end));
    }

    await Promise.all(workers);

    const elapsed = performance.now() - start;
    return this._summarize(elapsed);
  }

  async _worker(endTime) {
    while (performance.now() < endTime) {
      await this.makeRequest();
    }
  }

  _summarize(elapsedMs) {
    const latencies = this.results.latencies.sort((a, b) => a - b);
    const count = latencies.length;

    return {
      duration: (elapsedMs / 1000).toFixed(1) + "s",
      requests: this.results.requests,
      errors: this.results.errors,
      throughput: Math.round(count / (elapsedMs / 1000)),
      latency: count > 0 ? {
        min: latencies[0]?.toFixed(2),
        avg: (latencies.reduce((a, b) => a + b, 0) / count).toFixed(2),
        p50: latencies[Math.floor(count * 0.5)]?.toFixed(2),
        p90: latencies[Math.floor(count * 0.9)]?.toFixed(2),
        p95: latencies[Math.floor(count * 0.95)]?.toFixed(2),
        p99: latencies[Math.floor(count * 0.99)]?.toFixed(2),
        max: latencies[count - 1]?.toFixed(2),
      } : null,
      statusCodes: this.results.statusCodes,
      bytesRead: this.results.bytesRead,
    };
  }
}

// --- Demo 1: Load test a simple server ---

console.log("--- Load testing a simple server ---\n");

// Start a test server
let requestCount = 0;
const server = http.createServer((req, res) => {
  requestCount++;
  // Simulate some work
  const data = JSON.stringify({ id: requestCount, timestamp: Date.now() });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(data);
});

await new Promise(resolve => server.listen(0, resolve));
const port = server.address().port;

console.log(`  Test server running on port ${port}\n`);

// Run load test
const tester = new LoadTester({
  url: `http://localhost:${port}/api/test`,
  duration: 2000,
  connections: 10,
});

const result = await tester.run();

console.log("  Load test results:\n");
console.log(`    Duration:    ${result.duration}`);
console.log(`    Requests:    ${result.requests}`);
console.log(`    Throughput:  ${result.throughput} req/sec`);
console.log(`    Errors:      ${result.errors}`);
console.log(`    Status:      ${JSON.stringify(result.statusCodes)}`);
if (result.latency) {
  console.log(`    Latency:`);
  console.log(`      min=${result.latency.min}ms avg=${result.latency.avg}ms`);
  console.log(`      p50=${result.latency.p50}ms p95=${result.latency.p95}ms p99=${result.latency.p99}ms`);
  console.log(`      max=${result.latency.max}ms`);
}

// --- Demo 2: Compare different workloads ---

console.log("\n--- Comparing workloads ---\n");

// Server with variable response time
let mode = "fast";
const varServer = http.createServer((req, res) => {
  if (mode === "fast") {
    res.writeHead(200).end("ok");
  } else if (mode === "cpu") {
    // Simulate CPU work
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += Math.sin(i);
    res.writeHead(200).end(String(sum));
  } else if (mode === "io") {
    // Simulate I/O wait
    setTimeout(() => res.writeHead(200).end("ok"), 10);
  }
});

await new Promise(resolve => varServer.listen(0, resolve));
const varPort = varServer.address().port;

const workloads = [
  { mode: "fast", label: "Fast (no work)" },
  { mode: "cpu", label: "CPU-bound (100K math ops)" },
  { mode: "io", label: "I/O-bound (10ms delay)" },
];

console.log(`  ${"Workload".padEnd(30)} RPS      p50      p99`);
console.log(`  ${"-".repeat(60)}`);

for (const workload of workloads) {
  mode = workload.mode;
  const t = new LoadTester({
    url: `http://localhost:${varPort}/`,
    duration: 1500,
    connections: 10,
  });
  const r = await t.run();
  console.log(`  ${workload.label.padEnd(30)} ${String(r.throughput).padStart(5)}  ${(r.latency?.p50 || "N/A").toString().padStart(7)}ms  ${(r.latency?.p99 || "N/A").toString().padStart(7)}ms`);
}

// --- Demo 3: Connection scaling ---

console.log("\n--- Connection scaling ---\n");

mode = "io"; // I/O-bound server

console.log(`  ${"Connections".padEnd(14)} RPS      p50      p99      Errors`);
console.log(`  ${"-".repeat(60)}`);

for (const conns of [1, 5, 10, 50]) {
  const t = new LoadTester({
    url: `http://localhost:${varPort}/`,
    duration: 1500,
    connections: conns,
  });
  const r = await t.run();
  console.log(`  ${String(conns).padEnd(14)} ${String(r.throughput).padStart(5)}  ${(r.latency?.p50 || "N/A").toString().padStart(7)}ms  ${(r.latency?.p99 || "N/A").toString().padStart(7)}ms  ${String(r.errors).padStart(6)}`);
}

// Cleanup
server.close();
varServer.close();

// --- Demo 4: autocannon usage ---

console.log("\n=== autocannon Usage ===\n");

console.log(`  # Basic load test (10 connections, 10 seconds)
  npx autocannon http://localhost:6001/api/health

  # Custom parameters
  npx autocannon -c 100 -d 30 -p 10 http://localhost:6001/api/users
  #   -c 100: 100 concurrent connections
  #   -d 30:  30 seconds duration
  #   -p 10:  10 pipelined requests per connection

  # POST with body
  npx autocannon -m POST \\
    -H 'Content-Type: application/json' \\
    -b '{"name":"test"}' \\
    http://localhost:6001/api/users

  # Compare before/after optimization
  npx autocannon -c 50 -d 10 http://localhost:6001/api/slow > before.txt
  # ... optimize ...
  npx autocannon -c 50 -d 10 http://localhost:6001/api/slow > after.txt
`);

// --- Demo 5: What good looks like ---

console.log("--- Performance targets ---\n");

const targets = [
  ["Metric", "Good", "Warning", "Critical"],
  ["p50 latency", "< 50ms", "50-200ms", "> 200ms"],
  ["p99 latency", "< 200ms", "200-1000ms", "> 1000ms"],
  ["Error rate", "< 0.1%", "0.1-1%", "> 1%"],
  ["Throughput", "> 1000 rps", "100-1000 rps", "< 100 rps"],
  ["CPU usage", "< 70%", "70-90%", "> 90%"],
  ["Memory growth", "Stable", "Slow growth", "Linear growth"],
];

for (const [metric, good, warn, crit] of targets) {
  console.log(`  ${metric.padEnd(16)} ${good.padEnd(16)} ${warn.padEnd(16)} ${crit}`);
}
```

## Expected Output

```
=== Load Testing ===

--- Load testing a simple server ---

  Test server running on port <port>

  Load test results:

    Duration:    2.0s
    Requests:    <varies>
    Throughput:  <varies> req/sec
    Latency:
      min=<ms> avg=<ms>
      p50=<ms> p95=<ms> p99=<ms>

--- Comparing workloads ---

  Workload                       RPS      p50      p99
  Fast (no work)                >5000   <1ms     <5ms
  CPU-bound (100K math ops)     <1000   >5ms     >20ms
  I/O-bound (10ms delay)         ~900   ~10ms    ~15ms
  ...
```

## Challenge

1. Build a load test that ramps up connections from 1 to 100 over 60 seconds and generates a chart (ASCII or JSON) showing how throughput and latency change as load increases
2. Load test your API with different payload sizes (1KB, 10KB, 100KB, 1MB) and find the threshold where latency degrades due to body parsing time
3. Implement a "soak test" that runs for 10 minutes at constant load and checks for memory leaks by comparing `process.memoryUsage()` at the start and end

## Common Mistakes

- Testing from the same machine as the server — the load tester and server compete for CPU, skewing results
- Not warming up the server — the first few hundred requests are slower (JIT compilation, connection pooling warmup)
- Only testing happy paths — test error paths, large payloads, and slow endpoints too
- Comparing tests with different parameters — always use the same duration, connections, and payload when comparing optimizations
