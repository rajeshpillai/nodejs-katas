---
id: api-gateway-patterns
phase: 16
phase_title: Advanced Architectures
sequence: 3
title: API Gateway Patterns
difficulty: advanced
tags: [api-gateway, proxy, rate-limiting, aggregation, authentication, routing]
prerequisites: [streaming-apis]
estimated_minutes: 15
---

## Concept

An API gateway is a single entry point that sits between clients and backend services. It handles cross-cutting concerns so individual services don't have to.

**What an API gateway does:**

1. **Request routing** — `/api/users` → user service, `/api/orders` → order service
2. **Authentication** — verify JWT tokens once, pass user info to services
3. **Rate limiting** — protect services from abuse
4. **Request aggregation** — combine responses from multiple services into one
5. **Protocol translation** — REST → gRPC, HTTP → WebSocket
6. **Caching** — cache responses to reduce backend load
7. **Load balancing** — distribute requests across service instances

**Gateway patterns:**

| Pattern | Description |
|---------|-------------|
| **Reverse proxy** | Simple routing to backends |
| **Aggregation** | Fan-out to multiple services, combine results |
| **Backend-for-Frontend (BFF)** | Separate gateway per client type (web, mobile) |
| **Sidecar** | Gateway runs alongside each service |

**Build vs. buy:**
- **Build:** Node.js reverse proxy (`http-proxy`, raw `http`)
- **Buy/Use:** Kong, Traefik, NGINX, AWS API Gateway, Cloudflare Workers

## Key Insight

> An API gateway transforms N×M connections (N clients × M services) into N+M connections (N clients → gateway + gateway → M services). Without a gateway, every client must know about every service, handle authentication differently for each, and manage rate limits independently. The gateway centralizes these concerns. But beware: the gateway becomes a single point of failure. It must be stateless (no in-memory sessions), fast (every request passes through it), and highly available (multiple instances behind a load balancer).

## Experiment

```js
console.log("=== API Gateway Patterns ===\n");

// --- Simulated backend services ---

class Service {
  constructor(name, latencyMs = 10) {
    this.name = name;
    this.latencyMs = latencyMs;
    this.requestCount = 0;
    this.healthy = true;
  }

  async handle(req) {
    this.requestCount++;
    if (!this.healthy) throw new Error(`${this.name}: service unavailable`);

    // Simulate processing
    await new Promise(r => setTimeout(r, Math.min(this.latencyMs, 5)));

    return {
      service: this.name,
      data: `response from ${this.name}`,
      requestId: req.id,
    };
  }
}

// --- Demo 1: Request routing ---

console.log("--- Request routing ---\n");

class APIGateway {
  constructor() {
    this.routes = new Map();
    this.middleware = [];
    this.log = [];
  }

  // Register a service for a path prefix
  route(prefix, service) {
    this.routes.set(prefix, service);
  }

  // Add gateway-level middleware
  use(fn) {
    this.middleware.push(fn);
  }

  // Find the service for a given path
  _resolve(path) {
    for (const [prefix, service] of this.routes) {
      if (path.startsWith(prefix)) {
        return { service, remaining: path.slice(prefix.length) || "/" };
      }
    }
    return null;
  }

  async handle(req) {
    const startTime = performance.now();
    req.id = req.id || `req-${Math.random().toString(36).slice(2, 8)}`;

    // Run middleware pipeline
    for (const mw of this.middleware) {
      const result = await mw(req);
      if (result?.blocked) {
        this.log.push({ ...req, status: result.status, duration: 0 });
        return { status: result.status, body: result.body };
      }
    }

    // Route to service
    const match = this._resolve(req.path);
    if (!match) {
      return { status: 404, body: { error: "No route for " + req.path } };
    }

    try {
      const result = await match.service.handle({
        ...req,
        path: match.remaining,
      });

      const duration = performance.now() - startTime;
      this.log.push({ path: req.path, service: match.service.name, duration: Math.round(duration), status: 200 });

      return { status: 200, body: result };
    } catch (err) {
      const duration = performance.now() - startTime;
      this.log.push({ path: req.path, service: match.service.name, duration: Math.round(duration), status: 502 });

      return { status: 502, body: { error: err.message } };
    }
  }
}

// Set up services
const userService = new Service("user-service", 15);
const orderService = new Service("order-service", 25);
const productService = new Service("product-service", 10);

// Set up gateway
const gateway = new APIGateway();
gateway.route("/api/users", userService);
gateway.route("/api/orders", orderService);
gateway.route("/api/products", productService);

// Test routing
const routeTests = [
  { method: "GET", path: "/api/users/42" },
  { method: "GET", path: "/api/orders" },
  { method: "GET", path: "/api/products/search" },
  { method: "GET", path: "/api/unknown" },
];

for (const req of routeTests) {
  const res = await gateway.handle(req);
  console.log(`  ${req.method} ${req.path.padEnd(25)} → ${res.status} ${res.body.service || res.body.error}`);
}

// --- Demo 2: Authentication middleware ---

console.log("\n--- Authentication middleware ---\n");

const authGateway = new APIGateway();

// Auth middleware
authGateway.use(async (req) => {
  // Public paths don't need auth
  const publicPaths = ["/api/health", "/api/auth/login"];
  if (publicPaths.some(p => req.path.startsWith(p))) return null;

  const token = req.headers?.authorization?.replace("Bearer ", "");
  if (!token) {
    return { blocked: true, status: 401, body: { error: "Missing token" } };
  }

  // Simulate JWT verification
  if (token === "valid-token") {
    req.user = { id: 1, name: "Alice", role: "admin" };
    return null; // Continue to next middleware
  }

  return { blocked: true, status: 403, body: { error: "Invalid token" } };
});

authGateway.route("/api/users", userService);
authGateway.route("/api/health", new Service("health"));

const authTests = [
  { method: "GET", path: "/api/health", headers: {} },
  { method: "GET", path: "/api/users", headers: { authorization: "Bearer valid-token" } },
  { method: "GET", path: "/api/users", headers: {} },
  { method: "GET", path: "/api/users", headers: { authorization: "Bearer bad-token" } },
];

for (const req of authTests) {
  const res = await authGateway.handle(req);
  const auth = req.headers?.authorization ? "with token" : "no token";
  console.log(`  ${req.path.padEnd(18)} (${auth.padEnd(12)}) → ${res.status} ${res.body.error || res.body.service || "ok"}`);
}

// --- Demo 3: Rate limiting ---

console.log("\n--- Rate limiting at the gateway ---\n");

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 1000;
    this.max = options.max || 5;
    this.store = new Map();
  }

  check(key) {
    const now = Date.now();
    if (!this.store.has(key)) {
      this.store.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.max - 1 };
    }

    const entry = this.store.get(key);
    if (now - entry.windowStart > this.windowMs) {
      entry.count = 1;
      entry.windowStart = now;
      return { allowed: true, remaining: this.max - 1 };
    }

    entry.count++;
    if (entry.count > this.max) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.windowStart + this.windowMs - now) / 1000) };
    }

    return { allowed: true, remaining: this.max - entry.count };
  }
}

const limiter = new RateLimiter({ max: 3, windowMs: 1000 });

console.log("  Rate limit: 3 requests per second\n");

for (let i = 1; i <= 6; i++) {
  const result = limiter.check("client-1");
  console.log(`  Request ${i}: ${result.allowed ? "✓ allowed" : "✗ rate limited"} (remaining: ${result.remaining}${result.retryAfter ? `, retry after: ${result.retryAfter}s` : ""})`);
}

// --- Demo 4: Request aggregation ---

console.log("\n--- Request aggregation (fan-out) ---\n");

async function aggregateUserProfile(userId) {
  const startTime = performance.now();

  // Fan out to multiple services in parallel
  const [user, orders, recommendations] = await Promise.all([
    userService.handle({ id: `agg-${userId}`, path: `/${userId}` }),
    orderService.handle({ id: `agg-${userId}`, path: `/user/${userId}` }),
    productService.handle({ id: `agg-${userId}`, path: `/recommended/${userId}` }),
  ]);

  const duration = performance.now() - startTime;

  return {
    userId,
    user: user.data,
    orders: orders.data,
    recommendations: recommendations.data,
    _meta: {
      sources: 3,
      duration: Math.round(duration) + "ms",
    },
  };
}

const profile = await aggregateUserProfile(42);
console.log(`  Aggregated profile for user 42:`);
console.log(`    User:            ${profile.user}`);
console.log(`    Orders:          ${profile.orders}`);
console.log(`    Recommendations: ${profile.recommendations}`);
console.log(`    Sources: ${profile._meta.sources}, Duration: ${profile._meta.duration}`);
console.log(`\n  Without aggregation: client makes 3 requests (3 round trips)`);
console.log(`  With aggregation: client makes 1 request (1 round trip, gateway fans out)\n`);

// --- Demo 5: Circuit breaker per service ---

console.log("--- Circuit breaker per service ---\n");

class GatewayCircuitBreaker {
  constructor(options = {}) {
    this.threshold = options.threshold || 3;
    this.cooldownMs = options.cooldownMs || 5000;
    this.circuits = new Map();
  }

  getCircuit(serviceName) {
    if (!this.circuits.has(serviceName)) {
      this.circuits.set(serviceName, {
        failures: 0,
        state: "closed",
        lastFailure: 0,
      });
    }
    return this.circuits.get(serviceName);
  }

  recordSuccess(serviceName) {
    const circuit = this.getCircuit(serviceName);
    circuit.failures = 0;
    circuit.state = "closed";
  }

  recordFailure(serviceName) {
    const circuit = this.getCircuit(serviceName);
    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.failures >= this.threshold) {
      circuit.state = "open";
    }
  }

  canRequest(serviceName) {
    const circuit = this.getCircuit(serviceName);

    if (circuit.state === "closed") return true;

    if (circuit.state === "open") {
      if (Date.now() - circuit.lastFailure > this.cooldownMs) {
        circuit.state = "half-open";
        return true; // Allow one test request
      }
      return false;
    }

    return true; // half-open: allow test
  }

  getStatus() {
    const status = {};
    for (const [name, circuit] of this.circuits) {
      status[name] = { state: circuit.state, failures: circuit.failures };
    }
    return status;
  }
}

const breaker = new GatewayCircuitBreaker({ threshold: 2, cooldownMs: 200 });

// Simulate service failures
const services = ["user-service", "order-service", "product-service"];

// user-service fails
breaker.recordFailure("user-service");
breaker.recordFailure("user-service");

// order-service is healthy
breaker.recordSuccess("order-service");

console.log("  Circuit states:");
for (const [name, circuit] of Object.entries(breaker.getStatus())) {
  console.log(`    ${name.padEnd(18)} state=${circuit.state.padEnd(10)} failures=${circuit.failures}`);
}

console.log(`\n  Can request user-service? ${breaker.canRequest("user-service")} (circuit open)`);
console.log(`  Can request order-service? ${breaker.canRequest("order-service")} (circuit closed)`);

// --- Demo 6: Gateway architecture ---

console.log("\n--- Gateway architecture summary ---\n");

console.log(`  ┌──────────┐
  │  Client  │
  └────┬─────┘
       │
  ┌────▼──────────────────────────────────┐
  │            API Gateway                 │
  │  ┌─────────┐ ┌──────────┐ ┌────────┐ │
  │  │  Auth   │ │  Rate    │ │ Route  │ │
  │  │  Check  │→│  Limit   │→│ Match  │ │
  │  └─────────┘ └──────────┘ └────────┘ │
  └───┬──────────────┬──────────────┬─────┘
      │              │              │
  ┌───▼───┐    ┌─────▼────┐   ┌────▼─────┐
  │ User  │    │  Order   │   │ Product  │
  │ Svc   │    │  Svc     │   │ Svc      │
  └───────┘    └──────────┘   └──────────┘
`);

const tradeoffs = [
  ["Build your own", "Full control, custom logic", "Maintenance burden, reinventing wheels"],
  ["Kong / Traefik", "Production-ready, plugin ecosystem", "Operational complexity, another service"],
  ["Cloud gateway", "Managed, auto-scaling", "Vendor lock-in, latency, cost"],
  ["No gateway", "Simplest, least overhead", "Cross-cutting concerns in every service"],
];

console.log(`  ${"Approach".padEnd(20)} ${"Pros".padEnd(40)} Cons`);
console.log(`  ${"-".repeat(90)}`);
for (const [approach, pros, cons] of tradeoffs) {
  console.log(`  ${approach.padEnd(20)} ${pros.padEnd(40)} ${cons}`);
}
```

## Expected Output

```
=== API Gateway Patterns ===

--- Request routing ---

  GET /api/users/42              → 200 user-service
  GET /api/orders                → 200 order-service
  GET /api/products/search       → 200 product-service
  GET /api/unknown               → 404 No route for /api/unknown

--- Authentication middleware ---

  /api/health        (no token    ) → 200 health
  /api/users         (with token  ) → 200 user-service
  /api/users         (no token    ) → 401 Missing token
  ...
```

## Challenge

1. Build a Node.js API gateway that: routes by path prefix, authenticates JWT tokens, rate-limits per API key, and proxies requests to backend services. Use `http.request` or `undici` for proxying
2. Implement request aggregation: a single `GET /api/dashboard` that fans out to 4 backend services in parallel, combines their responses, and returns within a 500ms timeout (returning partial results if some services are slow)
3. Compare the latency overhead of routing through a Node.js gateway vs. direct service access. At what request rate does the gateway become the bottleneck?

## Common Mistakes

- Gateway as a monolith — putting business logic in the gateway instead of routing to services. The gateway should only handle cross-cutting concerns
- No circuit breaker — a slow/failing backend causes the gateway to exhaust connections and fail for all services
- Single gateway instance — the gateway is a single point of failure. Always run multiple instances behind a load balancer
- Over-aggregation — combining 10+ service calls into one gateway endpoint makes it slow and fragile. Keep aggregations small (2-4 services)
