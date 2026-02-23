---
id: middleware-and-hooks
phase: 15
phase_title: Frameworks (After Fundamentals)
sequence: 3
title: Middleware and Hooks
difficulty: intermediate
tags: [middleware, hooks, lifecycle, express, fastify, pipeline]
prerequisites: [routing-and-parameters]
estimated_minutes: 15
---

## Concept

Middleware and hooks are the backbone of request processing in frameworks. They let you run code before, during, and after route handlers — for cross-cutting concerns like authentication, logging, CORS, and error handling.

**Express model: middleware chain**
```
Request → [MW 1] → [MW 2] → [MW 3] → [Handler] → Response
              ↓         ↓         ↓
           next()    next()    next()
```

Each middleware calls `next()` to pass control to the next function. If it doesn't call `next()`, the chain stops.

**Fastify model: lifecycle hooks**
```
Request → onRequest → preParsing → preValidation → preHandler → [Handler]
                                                                     ↓
Response ← onSend ← preSerialization ← onResponse ←─────────────────┘
```

Each hook fires at a specific lifecycle phase. More precise than middleware.

**Common middleware/hook patterns:**
- **Authentication** — verify tokens before handlers run
- **Rate limiting** — count requests, reject if over limit
- **CORS** — add Access-Control headers
- **Request logging** — log method, path, duration
- **Error handling** — catch errors, return structured responses
- **Request ID** — generate/propagate a unique request ID

## Key Insight

> Express middleware is a single pipe — everything goes through the same chain in order. Fastify hooks are targeted to lifecycle phases — you hook into exactly the moment you need (before parsing, before validation, before handler, before sending). This matters because authentication should run *after* parsing (you need the headers) but *before* validation. In Express, you control this by middleware ordering. In Fastify, you use the right hook (`preValidation` for auth). Fastify's approach is more explicit and less prone to ordering bugs.

## Experiment

```js
console.log("=== Middleware and Hooks ===\n");

// --- Demo 1: Express-style middleware chain ---

console.log("--- Express-style middleware chain ---\n");

class ExpressStyleApp {
  constructor() {
    this.stack = [];
  }

  use(path, fn) {
    if (typeof path === "function") {
      fn = path;
      path = "/";
    }
    this.stack.push({ path, fn });
  }

  async handle(req) {
    const res = { headers: {}, status: 200, body: null, log: [] };
    let index = 0;

    const next = async (err) => {
      if (err) {
        // Find error handler (4 params in Express)
        while (index < this.stack.length) {
          const layer = this.stack[index++];
          if (layer.fn.length === 4) { // Error handler
            await layer.fn(err, req, res, next);
            return;
          }
        }
        res.status = 500;
        res.body = { error: err.message };
        return;
      }

      while (index < this.stack.length) {
        const layer = this.stack[index++];
        if (!req.url.startsWith(layer.path)) continue;

        try {
          if (layer.fn.length < 4) { // Regular middleware
            await layer.fn(req, res, next);
            return;
          }
        } catch (e) {
          await next(e);
          return;
        }
      }
    };

    await next();
    return res;
  }
}

const expressApp = new ExpressStyleApp();

// MW 1: Request ID
expressApp.use(async (req, res, next) => {
  req.id = `req-${Math.random().toString(36).slice(2, 8)}`;
  res.headers["X-Request-Id"] = req.id;
  res.log.push(`1. Request ID: ${req.id}`);
  await next();
});

// MW 2: Timing
expressApp.use(async (req, res, next) => {
  const start = performance.now();
  res.log.push("2. Timer started");
  await next();
  const duration = (performance.now() - start).toFixed(1);
  res.headers["X-Response-Time"] = `${duration}ms`;
  res.log.push(`6. Timer stopped: ${duration}ms`);
});

// MW 3: Auth (path-specific)
expressApp.use("/api", async (req, res, next) => {
  if (req.headers?.authorization === "Bearer valid-token") {
    req.user = { id: 1, name: "Alice" };
    res.log.push("3. Auth: valid token");
    await next();
  } else {
    res.status = 401;
    res.body = { error: "Unauthorized" };
    res.log.push("3. Auth: rejected");
    // Not calling next() — chain stops
  }
});

// MW 4: Route handler
expressApp.use("/api/users", async (req, res, next) => {
  res.log.push(`4. Handler: GET /api/users (user: ${req.user?.name})`);
  res.status = 200;
  res.body = { users: ["Alice", "Bob"] };
  await next();
});

// MW 5: Response logging
expressApp.use(async (req, res, next) => {
  res.log.push(`5. Response: ${res.status}`);
  await next();
});

// Error handler
expressApp.use(async (err, req, res, next) => {
  res.log.push(`ERROR: ${err.message}`);
  res.status = 500;
  res.body = { error: err.message };
});

// Test: authenticated request
console.log("  Authenticated request:");
const authRes = await expressApp.handle({
  method: "GET", url: "/api/users", headers: { authorization: "Bearer valid-token" }
});
for (const line of authRes.log) console.log(`    ${line}`);
console.log(`    Status: ${authRes.status}, Headers: ${JSON.stringify(authRes.headers)}\n`);

// Test: unauthenticated request
console.log("  Unauthenticated request:");
const unauthRes = await expressApp.handle({
  method: "GET", url: "/api/users", headers: {}
});
for (const line of unauthRes.log) console.log(`    ${line}`);
console.log(`    Status: ${unauthRes.status}`);

// --- Demo 2: Fastify-style lifecycle hooks ---

console.log("\n--- Fastify-style lifecycle hooks ---\n");

class FastifyStyleApp {
  constructor() {
    this.hooks = {
      onRequest: [],
      preParsing: [],
      preValidation: [],
      preHandler: [],
      preSerialization: [],
      onSend: [],
      onResponse: [],
      onError: [],
    };
    this.routes = new Map();
  }

  addHook(phase, fn) {
    if (!this.hooks[phase]) throw new Error(`Unknown hook: ${phase}`);
    this.hooks[phase].push(fn);
  }

  route(method, path, opts, handler) {
    if (typeof opts === "function") {
      handler = opts;
      opts = {};
    }
    this.routes.set(`${method}:${path}`, { handler, opts, hooks: opts.hooks || {} });
  }

  get(path, opts, handler) { this.route("GET", path, opts, handler); }
  post(path, opts, handler) { this.route("POST", path, opts, handler); }

  async _runHooks(phase, req, reply) {
    // App-level hooks
    for (const fn of this.hooks[phase]) {
      await fn(req, reply);
      if (reply.sent) return false;
    }
    // Route-level hooks
    if (req._route?.hooks?.[phase]) {
      for (const fn of req._route.hooks[phase]) {
        await fn(req, reply);
        if (reply.sent) return false;
      }
    }
    return true;
  }

  async handle(method, url, body) {
    const req = { method, url, body, headers: {} };
    const reply = {
      status: 200, body: null, headers: {}, sent: false, log: [],
      code(s) { this.status = s; return this; },
      send(b) { this.body = b; this.sent = true; return this; },
    };

    try {
      // 1. onRequest
      reply.log.push("→ onRequest");
      if (!await this._runHooks("onRequest", req, reply)) return reply;

      // 2. Route lookup
      const route = this.routes.get(`${method}:${url}`);
      if (!route) {
        reply.status = 404;
        reply.body = { error: "Not found" };
        return reply;
      }
      req._route = route;

      // 3. preParsing
      reply.log.push("→ preParsing");
      if (!await this._runHooks("preParsing", req, reply)) return reply;

      // 4. Parse body
      if (body) req.parsedBody = typeof body === "string" ? JSON.parse(body) : body;

      // 5. preValidation
      reply.log.push("→ preValidation");
      if (!await this._runHooks("preValidation", req, reply)) return reply;

      // 6. Validate (if schema exists)
      if (route.opts.schema?.body && req.parsedBody) {
        reply.log.push("→ validate (schema)");
      }

      // 7. preHandler
      reply.log.push("→ preHandler");
      if (!await this._runHooks("preHandler", req, reply)) return reply;

      // 8. Handler
      reply.log.push("→ handler");
      const result = await route.handler(req, reply);
      if (!reply.sent && result !== undefined) {
        reply.body = result;
      }

      // 9. preSerialization
      reply.log.push("→ preSerialization");
      await this._runHooks("preSerialization", req, reply);

      // 10. onSend
      reply.log.push("→ onSend");
      await this._runHooks("onSend", req, reply);

      // 11. onResponse
      reply.log.push("→ onResponse");
      await this._runHooks("onResponse", req, reply);

    } catch (err) {
      reply.log.push(`→ onError: ${err.message}`);
      for (const fn of this.hooks.onError) {
        await fn(err, req, reply);
      }
      if (!reply.sent) {
        reply.status = 500;
        reply.body = { error: err.message };
      }
    }

    return reply;
  }
}

const fastifyApp = new FastifyStyleApp();

// Hook: Request ID (earliest possible)
fastifyApp.addHook("onRequest", async (req, reply) => {
  req.id = `req-${Math.random().toString(36).slice(2, 8)}`;
  reply.headers["X-Request-Id"] = req.id;
});

// Hook: Auth (before handler, after parsing)
fastifyApp.addHook("preHandler", async (req, reply) => {
  // Skip auth for public routes
  if (req._route?.opts?.public) return;

  if (!req.headers.authorization) {
    reply.code(401).send({ error: "Unauthorized" });
  }
});

// Hook: Response timing
fastifyApp.addHook("onRequest", async (req) => {
  req._startTime = performance.now();
});

fastifyApp.addHook("onResponse", async (req, reply) => {
  const duration = (performance.now() - req._startTime).toFixed(1);
  reply.headers["X-Response-Time"] = `${duration}ms`;
});

// Route
fastifyApp.get("/api/data", async (req, reply) => {
  return { data: [1, 2, 3] };
});

fastifyApp.get("/health", { public: true }, async (req, reply) => {
  return { status: "ok" };
});

// Test
const hookRes = await fastifyApp.handle("GET", "/api/data", null);
console.log("  GET /api/data (no auth):");
console.log(`    Lifecycle: ${hookRes.log.join(" ")}`);
console.log(`    Status: ${hookRes.status}`);

console.log();

// Simulate auth
fastifyApp.hooks.preHandler.length = 0; // Remove old auth hook
fastifyApp.addHook("preHandler", async (req, reply) => {
  if (req._route?.opts?.public) return;
  req.user = { id: 1, name: "Alice" }; // Simulate valid auth
});

const hookRes2 = await fastifyApp.handle("GET", "/api/data", null);
console.log("  GET /api/data (with auth):");
console.log(`    Lifecycle: ${hookRes2.log.join(" ")}`);
console.log(`    Status: ${hookRes2.status}, Body: ${JSON.stringify(hookRes2.body)}`);

// --- Demo 3: Common middleware patterns ---

console.log("\n--- Common middleware patterns ---\n");

// CORS middleware
function corsMiddleware(options = {}) {
  const origin = options.origin || "*";
  const methods = options.methods || "GET,POST,PUT,DELETE";
  const headers = options.headers || "Content-Type,Authorization";

  return async (req, res, next) => {
    res.headers["Access-Control-Allow-Origin"] = origin;
    res.headers["Access-Control-Allow-Methods"] = methods;
    res.headers["Access-Control-Allow-Headers"] = headers;

    // Preflight
    if (req.method === "OPTIONS") {
      res.status = 204;
      return; // Don't call next()
    }

    await next?.();
  };
}

// Rate limiter middleware
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const store = new Map();

  return async (req, res, next) => {
    const key = req.ip || "anonymous";
    const now = Date.now();

    if (!store.has(key)) {
      store.set(key, { count: 0, resetAt: now + windowMs });
    }

    const entry = store.get(key);
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count++;

    res.headers["X-RateLimit-Limit"] = String(max);
    res.headers["X-RateLimit-Remaining"] = String(Math.max(0, max - entry.count));

    if (entry.count > max) {
      res.status = 429;
      res.body = { error: "Too many requests" };
      return; // Don't call next()
    }

    await next?.();
  };
}

// Demonstrate
const cors = corsMiddleware({ origin: "https://myapp.com" });
const limiter = rateLimiter({ max: 3, windowMs: 1000 });

console.log("  CORS middleware:");
const corsRes = { headers: {}, status: 200 };
await cors({ method: "GET", url: "/" }, corsRes, () => {});
console.log(`    Headers: ${JSON.stringify(corsRes.headers)}\n`);

console.log("  Rate limiter (max 3/sec):");
for (let i = 1; i <= 5; i++) {
  const rlRes = { headers: {}, status: 200, body: null };
  await limiter({ ip: "1.2.3.4" }, rlRes, () => {});
  console.log(`    Request ${i}: status=${rlRes.status} remaining=${rlRes.headers["X-RateLimit-Remaining"]}`);
}

// --- Demo 4: Express vs Fastify error handling ---

console.log("\n--- Error handling comparison ---\n");

console.log(`  // Express: async errors must be caught manually
  app.get('/data', async (req, res, next) => {
    try {
      const data = await riskyOperation();
      res.json(data);
    } catch (err) {
      next(err);  // Forgetting this = unhandled rejection!
    }
  });

  // Or with a wrapper:
  const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/data', asyncHandler(async (req, res) => {
    const data = await riskyOperation();
    res.json(data);  // Errors auto-forwarded to next()
  }));
`);

console.log(`  // Fastify: async errors caught automatically
  app.get('/data', async (req, reply) => {
    const data = await riskyOperation();
    return data;  // If riskyOperation throws → auto 500
  });

  // Custom error handler
  app.setErrorHandler((error, req, reply) => {
    reply.status(error.statusCode || 500).send({
      error: error.message,
      code: error.code,
    });
  });
`);
```

## Expected Output

```
=== Middleware and Hooks ===

--- Express-style middleware chain ---

  Authenticated request:
    1. Request ID: req-a1b2c3
    2. Timer started
    3. Auth: valid token
    4. Handler: GET /api/users (user: Alice)
    5. Response: 200
    6. Timer stopped: 0.2ms
    Status: 200

  Unauthenticated request:
    1. Request ID: req-d4e5f6
    2. Timer started
    3. Auth: rejected
    Status: 401

--- Fastify-style lifecycle hooks ---

  GET /api/data (no auth):
    Lifecycle: → onRequest → preParsing → preValidation → preHandler
    Status: 401
  ...
```

## Challenge

1. Build an Express-compatible `asyncHandler` wrapper that catches promise rejections and forwards them to `next(err)`. Then compare it to how Fastify handles the same scenario natively
2. Implement route-level middleware: certain middleware (like admin-only auth) should only run for specific routes, not globally. Show both the Express and Fastify approach
3. What happens when middleware modifies `req` or `res` in ways that later middleware doesn't expect? How does Fastify's encapsulation model (plugins can't access parent state) prevent this?

## Common Mistakes

- Forgetting to call `next()` in Express middleware — the request hangs forever with no response
- Wrong middleware order — auth middleware after the route handler does nothing. Order matters in Express
- Async errors in Express — `throw` inside an async route handler becomes an unhandled promise rejection. Must use `try/catch` + `next(err)` or a wrapper
- Modifying shared state in middleware — middleware that writes to `req.user` can conflict if multiple middleware touch the same property
