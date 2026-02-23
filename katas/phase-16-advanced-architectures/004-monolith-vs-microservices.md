---
id: monolith-vs-microservices
phase: 16
phase_title: Advanced Architectures
sequence: 4
title: Monolith vs Microservices
difficulty: advanced
tags: [monolith, microservices, architecture, distributed-systems, modular-monolith]
prerequisites: [api-gateway-patterns]
estimated_minutes: 15
---

## Concept

The choice between monolith and microservices is one of the most consequential architectural decisions. Most teams choose wrong — usually by going to microservices too early.

**Monolith** — one deployable unit containing all functionality:
- Single process, single database
- Function calls between modules
- Shared memory, shared types
- Simple deployment, simple debugging

**Microservices** — multiple independently deployable services:
- Each service has its own process and database
- Network calls between services (HTTP, gRPC, messages)
- Independent deployment and scaling
- Complex operations, complex debugging

**The modular monolith** — the best of both worlds:
- Single deployable unit (like a monolith)
- Strong module boundaries (like microservices)
- Modules communicate through defined interfaces
- Can be split into services later if needed

**When to use each:**

| Signal | Monolith | Microservices |
|--------|----------|---------------|
| Team size | < 10 developers | Multiple teams (> 20) |
| Deployment | Everything ships together | Teams deploy independently |
| Scaling | Uniform load | Different components need different resources |
| Data | Shared database | Services own their data |
| Latency | Can't tolerate network overhead | Network calls acceptable |

## Key Insight

> Start with a monolith. Every successful microservices architecture started as a monolith that was split apart at well-understood boundaries. You can't define good service boundaries without understanding your domain deeply, and you can't understand your domain deeply without building it first. The cost of wrong microservice boundaries (distributed monolith) is vastly higher than the cost of wrong module boundaries in a monolith (refactoring). A modular monolith gives you clear boundaries that can become service boundaries later, without the operational complexity of distributed systems.

## Experiment

```js
console.log("=== Monolith vs Microservices ===\n");

// --- Demo 1: Monolith — function calls ---

console.log("--- Monolith: function calls between modules ---\n");

class MonolithApp {
  constructor() {
    this.db = new Map(); // Shared database
    this.log = [];
  }

  // User module
  createUser(name, email) {
    const id = this.db.size + 1;
    const user = { id, name, email, createdAt: Date.now() };
    this.db.set(`user:${id}`, user);
    this.log.push({ module: "users", action: "create", id });
    return user;
  }

  getUser(id) {
    return this.db.get(`user:${id}`);
  }

  // Order module — directly calls user module
  createOrder(userId, items) {
    const user = this.getUser(userId); // Function call — instant, type-safe
    if (!user) throw new Error("User not found");

    const orderId = this.db.size + 1;
    const order = {
      id: orderId,
      userId,
      userName: user.name, // Can access user fields directly
      items,
      total: items.reduce((sum, i) => sum + i.price * i.qty, 0),
      createdAt: Date.now(),
    };
    this.db.set(`order:${orderId}`, order);
    this.log.push({ module: "orders", action: "create", id: orderId });
    return order;
  }

  // Report module — reads from both
  getRevenueSummary() {
    const orders = [];
    for (const [key, value] of this.db) {
      if (key.startsWith("order:")) orders.push(value);
    }

    return {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + o.total, 0),
      // Can join data from any table — it's the same database!
    };
  }
}

const monolith = new MonolithApp();
const start = performance.now();

const user = monolith.createUser("Alice", "alice@example.com");
const order = monolith.createOrder(user.id, [
  { name: "Widget", price: 10, qty: 3 },
  { name: "Gadget", price: 25, qty: 1 },
]);
const summary = monolith.getRevenueSummary();
const monolithTime = performance.now() - start;

console.log(`  Created user: ${user.name} (id: ${user.id})`);
console.log(`  Created order: #${order.id} for ${order.userName}, total: $${order.total}`);
console.log(`  Revenue summary: ${summary.totalOrders} orders, $${summary.totalRevenue}`);
console.log(`  Time: ${monolithTime.toFixed(2)}ms (all function calls — no network)\n`);

// --- Demo 2: Microservices — network calls ---

console.log("--- Microservices: network calls between services ---\n");

class MicroService {
  constructor(name) {
    this.name = name;
    this.db = new Map(); // Own database
    this.requestCount = 0;
    this.latencyMs = 2; // Simulated network latency
  }

  async call(method, path, body) {
    this.requestCount++;
    // Simulate network round trip
    await new Promise(r => setTimeout(r, this.latencyMs));

    // Simulate serialization/deserialization
    const serialized = JSON.stringify(body);
    const deserialized = JSON.parse(serialized);

    return deserialized;
  }
}

class UserMicroservice extends MicroService {
  constructor() { super("user-service"); }

  async createUser(name, email) {
    const id = this.db.size + 1;
    const user = { id, name, email };
    this.db.set(id, user);
    return user;
  }

  async getUser(id) {
    await new Promise(r => setTimeout(r, this.latencyMs));
    return this.db.get(id) || null;
  }
}

class OrderMicroservice extends MicroService {
  constructor(userService) {
    super("order-service");
    this.userService = userService;
  }

  async createOrder(userId, items) {
    // Must make a NETWORK CALL to get user data
    const user = await this.userService.getUser(userId);
    if (!user) throw new Error("User not found (from user-service)");

    const orderId = this.db.size + 1;
    const order = {
      id: orderId,
      userId,
      userName: user.name,
      items,
      total: items.reduce((sum, i) => sum + i.price * i.qty, 0),
    };
    this.db.set(orderId, order);
    return order;
  }
}

class ReportMicroservice extends MicroService {
  constructor(userService, orderService) {
    super("report-service");
    this.userService = userService;
    this.orderService = orderService;
  }

  async getRevenueSummary() {
    // Must call BOTH services — can't just query the database
    // This is the "distributed join" problem
    return {
      note: "Must call order-service API, can't query its DB directly",
      complexity: "Need to handle timeouts, retries, partial failures",
    };
  }
}

const userSvc = new UserMicroservice();
const orderSvc = new OrderMicroservice(userSvc);

const msStart = performance.now();

const msUser = await userSvc.createUser("Alice", "alice@example.com");
const msOrder = await orderSvc.createOrder(msUser.id, [
  { name: "Widget", price: 10, qty: 3 },
  { name: "Gadget", price: 25, qty: 1 },
]);
const msTime = performance.now() - msStart;

console.log(`  Created user: ${msUser.name} (via user-service)`);
console.log(`  Created order: #${msOrder.id} for ${msOrder.userName}, total: $${msOrder.total}`);
console.log(`  Time: ${msTime.toFixed(2)}ms (includes simulated network calls)\n`);

console.log(`  Overhead comparison:`);
console.log(`    Monolith:       ${monolithTime.toFixed(2)}ms (function calls)`);
console.log(`    Microservices:  ${msTime.toFixed(2)}ms (network calls)`);
console.log(`    Overhead:       ~${(msTime / Math.max(monolithTime, 0.01)).toFixed(0)}x slower per operation`);

// --- Demo 3: The distributed data problem ---

console.log("\n--- The distributed data problem ---\n");

console.log("  In a monolith:");
console.log(`    SELECT u.name, o.total, o.created_at
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.total > 100
    → Single query, database handles the join\n`);

console.log("  In microservices:");
console.log(`    1. GET /api/orders?total_gt=100        → order-service
    2. For each order: GET /api/users/:userId  → user-service
    3. Combine results in the calling code
    → N+1 API calls, no transactional guarantee\n`);

console.log("  Solutions to distributed joins:");
const solutions = [
  ["Data denormalization", "Store user name in order record", "Stale data risk"],
  ["Event-driven sync", "User events → order service stores copy", "Eventual consistency"],
  ["API aggregation", "Gateway combines responses", "Latency, complexity"],
  ["Shared database", "Services share read replicas", "Coupling (defeats purpose)"],
];

console.log(`    ${"Approach".padEnd(24)} ${"How".padEnd(40)} Trade-off`);
console.log(`    ${"-".repeat(85)}`);
for (const [approach, how, tradeoff] of solutions) {
  console.log(`    ${approach.padEnd(24)} ${how.padEnd(40)} ${tradeoff}`);
}

// --- Demo 4: Modular monolith ---

console.log("\n--- Modular monolith (best of both) ---\n");

class Module {
  constructor(name) {
    this.name = name;
    this._internal = new Map(); // Private state
  }
}

class UserModule extends Module {
  constructor() { super("users"); }

  // Public interface — this is what other modules can call
  createUser(name, email) {
    const id = this._internal.size + 1;
    const user = { id, name, email };
    this._internal.set(id, user);
    return { id, name }; // Return only public fields
  }

  getPublicProfile(id) {
    const user = this._internal.get(id);
    if (!user) return null;
    return { id: user.id, name: user.name }; // Don't expose email
  }
}

class OrderModule extends Module {
  constructor(userModule) {
    super("orders");
    this.users = userModule; // Depends on user module's PUBLIC interface
  }

  createOrder(userId, items) {
    // Call through the public interface — not direct DB access
    const user = this.users.getPublicProfile(userId);
    if (!user) throw new Error("User not found");

    const orderId = this._internal.size + 1;
    const order = { id: orderId, userId, userName: user.name, items };
    this._internal.set(orderId, order);
    return order;
  }
}

const userMod = new UserModule();
const orderMod = new OrderModule(userMod);

const modUser = userMod.createUser("Alice", "alice@example.com");
const modOrder = orderMod.createOrder(modUser.id, [{ name: "Widget" }]);

console.log(`  User module → createUser: ${JSON.stringify(modUser)}`);
console.log(`  Order module → createOrder: ${JSON.stringify(modOrder)}\n`);

console.log("  Benefits:");
console.log("    ✓ Function calls (fast, type-safe)");
console.log("    ✓ Clear boundaries (modules have public interfaces)");
console.log("    ✓ Single deployment (no orchestration)");
console.log("    ✓ Easy to split later (interfaces become APIs)");
console.log("    ✓ Shared database (JOINs work!)");

// --- Demo 5: Decision framework ---

console.log("\n--- Decision framework ---\n");

const decisions = [
  ["1 team, < 10 devs", "Monolith", "Simple deployment, fast development"],
  ["2-3 teams, shared codebase", "Modular monolith", "Clear boundaries, single deployment"],
  ["4+ teams, independent deploys", "Microservices", "Team autonomy, independent scaling"],
  ["Scaling one hot path", "Monolith + extract 1 service", "Only split what needs it"],
  ["Greenfield, unknown domain", "Monolith", "Learn boundaries before splitting"],
  ["Mature domain, proven boundaries", "Microservices", "Boundaries are well-understood"],
];

console.log(`  ${"Situation".padEnd(35)} ${"Architecture".padEnd(22)} Reason`);
console.log(`  ${"-".repeat(85)}`);
for (const [situation, arch, reason] of decisions) {
  console.log(`  ${situation.padEnd(35)} ${arch.padEnd(22)} ${reason}`);
}

// --- Demo 6: Microservice tax ---

console.log("\n--- The microservice tax ---\n");

const tax = [
  ["Service discovery", "How do services find each other?"],
  ["Network failures", "Every call can timeout, 503, drop"],
  ["Distributed tracing", "One request spans 10 services — how do you debug?"],
  ["Data consistency", "No cross-service transactions"],
  ["Configuration", "Environment variables × N services"],
  ["Deployment", "CI/CD pipelines × N services"],
  ["Monitoring", "Dashboards × N services"],
  ["Testing", "Integration tests require all services running"],
  ["Local development", "Docker Compose with 10+ containers"],
  ["Versioning", "API contracts between services must be managed"],
];

console.log(`  You pay this tax for EVERY service you add:\n`);
for (const [item, question] of tax) {
  console.log(`    ${item.padEnd(24)} ${question}`);
}

console.log(`\n  Ask yourself: is the team/scaling benefit worth this overhead?`);
```

## Expected Output

```
=== Monolith vs Microservices ===

--- Monolith: function calls between modules ---

  Created user: Alice (id: 1)
  Created order: #2 for Alice, total: $55
  Revenue summary: 1 orders, $55
  Time: 0.05ms (all function calls — no network)

--- Microservices: network calls between services ---

  Created user: Alice (via user-service)
  Created order: #1 for Alice, total: $55
  Time: 6.2ms (includes simulated network calls)

  Overhead comparison:
    Monolith:       0.05ms
    Microservices:  6.2ms
    Overhead:       ~124x slower per operation
  ...
```

## Challenge

1. Refactor a monolith into a modular monolith: take a flat codebase with files like `user-controller.js`, `order-controller.js`, `user-model.js`, `order-model.js` and reorganize into modules with public interfaces. What rules prevent modules from reaching into each other's internals?
2. Extract one module from a modular monolith into a microservice: replace function calls with HTTP calls, handle the distributed data problem, add health checks and circuit breakers. Measure the latency impact
3. You have a monolith handling 10K req/s. One endpoint (`/api/reports/generate`) is CPU-intensive and blocks the event loop. Should you: (a) extract it as a microservice, (b) use worker threads, or (c) use a background job queue? Argue the trade-offs of each

## Common Mistakes

- Starting with microservices — the #1 mistake. You don't know your domain boundaries yet, and wrong boundaries are 10x harder to fix in a distributed system
- Distributed monolith — microservices that share a database or must be deployed together. All the complexity of microservices with none of the benefits
- Ignoring the network — function calls are nanoseconds; network calls are milliseconds. A monolith operation that calls 5 modules takes microseconds; a microservice operation that calls 5 services takes 50ms+
- Not considering the team — microservices solve team scaling problems (independent deployment, ownership boundaries). If you have one team, microservices add complexity without solving a real problem
