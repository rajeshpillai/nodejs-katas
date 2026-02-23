---
id: rest-and-realtime-hybrid
phase: 16
phase_title: Advanced Architectures
sequence: 1
title: REST + Real-Time Hybrid
difficulty: advanced
tags: [rest, websocket, hybrid, sse, real-time, architecture]
prerequisites: [plugins-and-encapsulation]
estimated_minutes: 15
---

## Concept

Most production applications aren't purely REST or purely real-time. They combine both:

- **REST** for CRUD operations (create, read, update, delete)
- **Real-time** for live updates (notifications, live dashboards, collaborative editing)

**Hybrid patterns:**

1. **REST + WebSocket events** — REST endpoints mutate data, WebSocket broadcasts changes
   ```
   POST /api/orders → creates order → WS broadcast: { type: "order:created", data: {...} }
   ```

2. **REST + Server-Sent Events (SSE)** — REST for writes, SSE for read streams
   ```
   POST /api/messages → creates message
   GET /api/messages/stream → SSE stream of new messages
   ```

3. **REST + polling** — simplest but least efficient
   ```
   POST /api/data → writes data
   GET /api/data?since=<timestamp> → poll for changes
   ```

**When to use each:**

| Pattern | Use When | Trade-offs |
|---------|----------|------------|
| REST + WS | Bidirectional, low latency | Complex state management |
| REST + SSE | Server→client only, simple | No client→server on same connection |
| REST + polling | Simplest, behind firewalls | Higher latency, more bandwidth |

## Key Insight

> The key to a clean hybrid architecture is separation of concerns: REST handles the command (write) path, real-time handles the query (read/subscribe) path. When a REST endpoint changes data, it publishes an event to an internal event bus. Real-time connections subscribe to that bus and push updates to clients. The REST handler doesn't know about WebSocket connections, and the WebSocket handler doesn't know about database queries. They communicate through events — which makes each side independently testable and scalable.

## Experiment

```js
console.log("=== REST + Real-Time Hybrid ===\n");

// --- Internal event bus (connects REST and real-time) ---

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.log = [];
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(listener);
  }

  emit(event, data) {
    this.log.push({ event, data, time: Date.now() });
    const listeners = this.listeners.get(event) || [];
    for (const listener of listeners) {
      listener(data);
    }
    // Wildcard listeners
    const wildcardListeners = this.listeners.get("*") || [];
    for (const listener of wildcardListeners) {
      listener(event, data);
    }
  }

  off(event, listener) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }
}

// --- Demo 1: REST + WebSocket hybrid ---

console.log("--- REST + WebSocket hybrid ---\n");

const bus = new EventBus();

// Simulated REST handlers
class OrderAPI {
  constructor(eventBus) {
    this.orders = [];
    this.bus = eventBus;
  }

  create(data) {
    const order = {
      id: this.orders.length + 1,
      ...data,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.orders.push(order);

    // Publish event — real-time connections will pick this up
    this.bus.emit("order:created", order);
    return { status: 201, body: order };
  }

  updateStatus(id, status) {
    const order = this.orders.find(o => o.id === id);
    if (!order) return { status: 404, body: { error: "Not found" } };

    const oldStatus = order.status;
    order.status = status;

    this.bus.emit("order:updated", { ...order, oldStatus });
    return { status: 200, body: order };
  }

  list() {
    return { status: 200, body: this.orders };
  }
}

// Simulated WebSocket connections
class WebSocketRoom {
  constructor(name, eventBus) {
    this.name = name;
    this.clients = new Map();
    this.bus = eventBus;
    this.messageLog = [];
  }

  subscribe(events) {
    for (const event of events) {
      this.bus.on(event, (data) => {
        this.broadcast({ type: event, data });
      });
    }
  }

  addClient(clientId) {
    this.clients.set(clientId, { id: clientId, messages: [] });
  }

  removeClient(clientId) {
    this.clients.delete(clientId);
  }

  broadcast(message) {
    for (const [id, client] of this.clients) {
      client.messages.push(message);
      this.messageLog.push({ to: id, message });
    }
  }
}

// Set up
const orderAPI = new OrderAPI(bus);
const orderRoom = new WebSocketRoom("orders", bus);
orderRoom.subscribe(["order:created", "order:updated"]);

// Connect WebSocket clients
orderRoom.addClient("dashboard-1");
orderRoom.addClient("dashboard-2");
orderRoom.addClient("mobile-app-1");

console.log(`  Connected WS clients: ${orderRoom.clients.size}\n`);

// REST: Create orders
console.log("  REST: POST /api/orders (create)");
const r1 = orderAPI.create({ product: "Widget", quantity: 5 });
console.log(`    → ${r1.status}: order #${r1.body.id}\n`);

console.log("  REST: POST /api/orders (create)");
const r2 = orderAPI.create({ product: "Gadget", quantity: 2 });
console.log(`    → ${r2.status}: order #${r2.body.id}\n`);

// REST: Update order status
console.log("  REST: PATCH /api/orders/1 (update status)");
const r3 = orderAPI.updateStatus(1, "shipped");
console.log(`    → ${r3.status}: ${r3.body.status}\n`);

// Check what WS clients received
console.log("  WebSocket messages received by 'dashboard-1':");
const client1 = orderRoom.clients.get("dashboard-1");
for (const msg of client1.messages) {
  console.log(`    ${msg.type}: ${JSON.stringify(msg.data).slice(0, 60)}`);
}

console.log(`\n  Total WS broadcasts: ${orderRoom.messageLog.length} (${orderRoom.clients.size} clients × ${bus.log.length} events)`);

// --- Demo 2: Server-Sent Events (SSE) ---

console.log("\n--- Server-Sent Events (SSE) pattern ---\n");

class SSEStream {
  constructor() {
    this.subscribers = new Map();
    this.eventId = 0;
  }

  subscribe(clientId, filter = null) {
    this.subscribers.set(clientId, { filter, events: [] });
  }

  unsubscribe(clientId) {
    this.subscribers.delete(clientId);
  }

  push(event, data) {
    this.eventId++;

    // Format as SSE protocol
    const sseMessage = {
      id: this.eventId,
      event,
      data: typeof data === "string" ? data : JSON.stringify(data),
      raw: `id: ${this.eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    };

    for (const [clientId, sub] of this.subscribers) {
      if (!sub.filter || sub.filter(event, data)) {
        sub.events.push(sseMessage);
      }
    }
  }

  getClientEvents(clientId) {
    return this.subscribers.get(clientId)?.events || [];
  }
}

const sse = new SSEStream();

// Client subscribes to all events
sse.subscribe("browser-1");

// Client subscribes only to errors
sse.subscribe("monitor-1", (event) => event.startsWith("error"));

// Push events
sse.push("message", { user: "Alice", text: "Hello" });
sse.push("message", { user: "Bob", text: "Hi there" });
sse.push("error:database", { message: "Connection pool exhausted" });
sse.push("message", { user: "Alice", text: "How are you?" });

console.log("  browser-1 (all events):");
for (const evt of sse.getClientEvents("browser-1")) {
  console.log(`    ${evt.raw.trim().split("\n").join(" | ")}`);
}

console.log(`\n  monitor-1 (errors only):`);
for (const evt of sse.getClientEvents("monitor-1")) {
  console.log(`    ${evt.raw.trim().split("\n").join(" | ")}`);
}

console.log(`\n  SSE HTTP implementation:`);
console.log(`    GET /api/events → Content-Type: text/event-stream`);
console.log(`    Connection: keep-alive`);
console.log(`    Cache-Control: no-cache`);
console.log(`    Each event: "id: N\\nevent: type\\ndata: json\\n\\n"`);

// --- Demo 3: Architecture comparison ---

console.log("\n--- Architecture comparison ---\n");

const architectures = [
  {
    name: "REST + WebSocket",
    flow: "Client ←REST→ Server ←WS→ Client",
    pros: ["Bidirectional", "Low latency", "Binary support"],
    cons: ["Connection management", "Reconnection logic", "Load balancer config"],
    bestFor: "Chat, gaming, collaborative editing",
  },
  {
    name: "REST + SSE",
    flow: "Client ←REST→ Server ←SSE→ Client",
    pros: ["Simple protocol", "Auto-reconnect", "Works through proxies"],
    cons: ["Server→client only", "Max 6 connections per domain", "Text only"],
    bestFor: "Live feeds, notifications, dashboards",
  },
  {
    name: "REST + Polling",
    flow: "Client ←REST→ Server (repeated)",
    pros: ["Simplest", "Works everywhere", "Stateless"],
    cons: ["High latency", "Wasted bandwidth", "Server load"],
    bestFor: "Infrequent updates, simple systems",
  },
];

for (const arch of architectures) {
  console.log(`  ${arch.name}`);
  console.log(`    Flow: ${arch.flow}`);
  console.log(`    Pros: ${arch.pros.join(", ")}`);
  console.log(`    Cons: ${arch.cons.join(", ")}`);
  console.log(`    Best for: ${arch.bestFor}\n`);
}

// --- Demo 4: Event bus as the glue ---

console.log("--- Event bus as architectural glue ---\n");

console.log(`  ┌─────────┐    event bus    ┌──────────────┐
  │  REST    │ ──publish──→  │  WebSocket   │
  │  Routes  │               │  Broadcaster │
  └─────────┘               └──────────────┘
       │                          │
       ↓                          ↓
  ┌─────────┐               ┌──────────────┐
  │  DB      │               │  Connected   │
  │  Write   │               │  Clients     │
  └─────────┘               └──────────────┘
`);

console.log("  Benefits of event bus decoupling:");
console.log("    1. REST handlers don't import WebSocket code");
console.log("    2. WebSocket handlers don't import database code");
console.log("    3. Can add SSE subscribers without changing REST");
console.log("    4. Can add logging/metrics subscribers transparently");
console.log("    5. Each side is independently testable");
```

## Expected Output

```
=== REST + Real-Time Hybrid ===

--- REST + WebSocket hybrid ---

  Connected WS clients: 3

  REST: POST /api/orders (create)
    → 201: order #1

  REST: POST /api/orders (create)
    → 201: order #2

  REST: PATCH /api/orders/1 (update status)
    → 200: shipped

  WebSocket messages received by 'dashboard-1':
    order:created: {"id":1,"product":"Widget","quantity":5,...}
    order:created: {"id":2,"product":"Gadget","quantity":2,...}
    order:updated: {"id":1,"product":"Widget","status":"shipped",...}
  ...
```

## Challenge

1. Build a full hybrid server: REST endpoints for CRUD on a resource, WebSocket connections for live updates, an event bus connecting them. Test with multiple browser tabs — creating an item in one tab should instantly appear in the others
2. Implement SSE with automatic reconnection: when the client disconnects, it sends `Last-Event-ID` header on reconnect. The server should replay missed events from an in-memory buffer
3. Design a notification system that uses REST + SSE + WebSocket based on the client: mobile apps get push notifications (REST webhook), browsers get SSE, and the admin dashboard uses WebSocket. All triggered by the same event bus

## Common Mistakes

- Tight coupling between REST and WebSocket — the REST handler directly calls WebSocket broadcast instead of going through an event bus. This makes each side untestable
- Not handling WebSocket reconnection — clients disconnect constantly (network changes, sleep, tab hidden). Always implement reconnection with exponential backoff
- Sending full objects over real-time connections — send minimal change events (`{ type: "updated", id: 42 }`) and let the client fetch the full object via REST if needed
- No event ordering guarantees — WebSocket messages can arrive out of order. Include sequence numbers or timestamps
