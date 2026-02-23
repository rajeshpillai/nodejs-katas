---
id: http-keep-alive
phase: 7
phase_title: HTTP from First Principles
sequence: 4
title: HTTP Keep-Alive
difficulty: intermediate
tags: [http, keep-alive, connection-reuse, performance, tcp]
prerequisites: [request-response-lifecycle]
estimated_minutes: 12
---

## Concept

Every HTTP request requires a TCP connection. TCP connections are expensive to create — the three-way handshake adds a full round-trip of latency before any data can flow.

**HTTP/1.0** opened a new TCP connection for every single request. Load a web page with 50 resources? That's 50 TCP handshakes.

**HTTP/1.1** introduced **keep-alive** (persistent connections) as the default. After a request-response cycle, the TCP connection stays open for the next request. This eliminates the handshake overhead for subsequent requests.

Keep-alive behavior:
- **HTTP/1.1**: Connections are keep-alive by default. Send `Connection: close` to disable
- **Node.js server**: Keep-alive enabled by default. Control via `server.keepAliveTimeout`
- **Node.js client (`http.Agent`)**: Manages a pool of keep-alive connections for reuse

The tradeoff: keep-alive connections consume server resources (memory, file descriptors). A server must balance connection reuse (performance) against resource usage (scalability).

## Key Insight

> A TCP handshake takes one full network round-trip — maybe 1ms on localhost, 50ms across the internet, 200ms intercontinental. Keep-alive eliminates this cost for all but the first request. For an API that makes 100 requests to an upstream service, keep-alive turns 100 handshakes into 1.

## Experiment

```js
import { createServer } from "http";
import { Agent, request as httpRequest } from "http";

console.log("=== HTTP Keep-Alive ===\n");

let connectionCount = 0;
let requestCount = 0;

const server = createServer((req, res) => {
  requestCount++;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ request: requestCount }));
});

server.on("connection", () => {
  connectionCount++;
  console.log(`[server] New TCP connection #${connectionCount}`);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

console.log("--- Without Keep-Alive (Connection: close) ---\n");

connectionCount = 0;
requestCount = 0;

for (let i = 0; i < 5; i++) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { "Connection": "close" },
  });
  await res.json();
}

console.log(`  Requests: ${requestCount}, TCP connections: ${connectionCount}`);

console.log("\n--- With Keep-Alive (default in HTTP/1.1) ---\n");

connectionCount = 0;
requestCount = 0;

// Use a custom Agent with keep-alive
const agent = new Agent({ keepAlive: true, maxSockets: 1 });

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = httpRequest({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      agent: agent,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on("error", reject);
    req.end();
  });
}

for (let i = 0; i < 5; i++) {
  await makeRequest(`http://127.0.0.1:${port}/`);
}

console.log(`  Requests: ${requestCount}, TCP connections: ${connectionCount}`);
console.log("  (1 connection reused for all requests!)\n");

agent.destroy();

console.log("=== Server Keep-Alive Settings ===\n");

console.log("server.keepAliveTimeout:", server.keepAliveTimeout, "ms");
console.log("  (How long to keep idle connections open)");

console.log("server.headersTimeout:", server.headersTimeout, "ms");
console.log("  (Max time to receive request headers)");

console.log("server.requestTimeout:", server.requestTimeout, "ms");
console.log("  (Max time for the entire request, 0 = no limit)");

console.log("server.maxRequestsPerSocket:", server.maxRequestsPerSocket, "(0 = unlimited)");
console.log("  (Max requests per keep-alive connection)");

console.log("\n=== Agent Connection Pool ===\n");

const poolAgent = new Agent({
  keepAlive: true,
  maxSockets: 3,       // Max 3 concurrent connections per host
  maxFreeSockets: 2,   // Keep up to 2 idle connections
  timeout: 5000,       // Socket timeout
});

console.log("Agent settings:");
console.log("  maxSockets:", poolAgent.maxSockets);
console.log("  maxFreeSockets:", poolAgent.maxFreeSockets);

// Make 3 parallel requests
connectionCount = 0;
requestCount = 0;

await Promise.all([
  makeRequest(`http://127.0.0.1:${port}/a`),
  makeRequest(`http://127.0.0.1:${port}/b`),
  makeRequest(`http://127.0.0.1:${port}/c`),
]);

console.log(`\nParallel: ${requestCount} requests, ${connectionCount} connections`);

// Sequential requests reuse connections
connectionCount = 0;
requestCount = 0;

for (let i = 0; i < 3; i++) {
  await makeRequest(`http://127.0.0.1:${port}/seq`);
}

console.log(`Sequential: ${requestCount} requests, ${connectionCount} connections`);

poolAgent.destroy();

console.log("\n=== Performance Comparison ===\n");

// Measure the difference
async function benchmark(name, count, useKeepAlive) {
  const benchAgent = useKeepAlive
    ? new Agent({ keepAlive: true, maxSockets: 1 })
    : new Agent({ keepAlive: false });

  const start = performance.now();

  for (let i = 0; i < count; i++) {
    await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port,
        path: "/",
        agent: benchAgent,
      }, (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
  }

  const elapsed = performance.now() - start;
  benchAgent.destroy();
  return elapsed;
}

const noKA = await benchmark("No keep-alive", 20, false);
const withKA = await benchmark("Keep-alive", 20, true);

console.log(`20 sequential requests:`);
console.log(`  Without keep-alive: ${noKA.toFixed(1)}ms`);
console.log(`  With keep-alive:    ${withKA.toFixed(1)}ms`);
console.log(`  Speedup:            ${(noKA / withKA).toFixed(1)}x`);

server.close();
console.log("\nDone");
```

## Expected Output

```
=== HTTP Keep-Alive ===

--- Without Keep-Alive (Connection: close) ---

[server] New TCP connection #1
[server] New TCP connection #2
[server] New TCP connection #3
[server] New TCP connection #4
[server] New TCP connection #5
  Requests: 5, TCP connections: 5

--- With Keep-Alive (default in HTTP/1.1) ---

[server] New TCP connection #1
  Requests: 5, TCP connections: 1
  (1 connection reused for all requests!)

=== Server Keep-Alive Settings ===

server.keepAliveTimeout: 5000 ms
server.headersTimeout: 60000 ms
...

=== Agent Connection Pool ===

Agent settings:
  maxSockets: 3
  maxFreeSockets: 2

Parallel: 3 requests, 3 connections
Sequential: 3 requests, 0 connections

=== Performance Comparison ===

20 sequential requests:
  Without keep-alive: <higher>ms
  With keep-alive:    <lower>ms
  Speedup:            <N>x
```

## Challenge

1. What happens when a keep-alive connection goes idle and the server closes it, but the client doesn't know yet? This is the "stale connection" problem. How does `http.Agent` handle it?
2. Monitor the agent's socket pool: print `agent.sockets` and `agent.freeSockets` after each request to see connections being reused
3. What is the HTTP/1.1 "head-of-line blocking" problem with keep-alive? How does HTTP/2 solve it?

## Deep Dive

HTTP/1.1 keep-alive has a fundamental limitation: **head-of-line blocking**. On a single connection, requests must be processed in order. If request A takes 5 seconds, requests B and C wait even if the server could answer them immediately.

Solutions:
- **Multiple connections** — browsers open 6-8 connections per host. `http.Agent.maxSockets` controls this
- **HTTP/2 multiplexing** — multiple streams over a single connection, no head-of-line blocking
- **HTTP/3 (QUIC)** — even eliminates TCP-level head-of-line blocking

In Node.js, the global `http.Agent` is created with `keepAlive: false` for backward compatibility. Always create your own agent with `keepAlive: true` for production HTTP clients.

## Common Mistakes

- Not using `keepAlive: true` in the HTTP agent — each request creates a new TCP connection
- Setting `keepAliveTimeout` too high on the server — idle connections consume memory and file descriptors
- Not destroying the agent when done — leaked sockets keep the process alive
- Assuming keep-alive means "the connection never closes" — servers close idle connections after a timeout, and agents must handle reconnection
