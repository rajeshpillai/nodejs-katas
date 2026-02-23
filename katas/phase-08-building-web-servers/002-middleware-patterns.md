---
id: middleware-patterns
phase: 8
phase_title: Building Web Servers & APIs
sequence: 2
title: Middleware Patterns
difficulty: intermediate
tags: [middleware, pipeline, request-processing, composition]
prerequisites: [routing]
estimated_minutes: 15
---

## Concept

Middleware is code that runs between receiving a request and sending a response. It's a pipeline: each middleware function can inspect/modify the request, inspect/modify the response, call the next middleware, or short-circuit the chain.

The pattern:
```
Request → Logger → Auth → Validator → Handler → Response
```

Each middleware has the signature `(req, res, next)`:
- Call `next()` to pass control to the next middleware
- Don't call `next()` to short-circuit (e.g., return 401 for auth failure)
- Call `next(error)` to skip to error-handling middleware

This pattern is powerful because middleware is composable — you can mix and match logging, authentication, rate limiting, CORS, compression, and more by simply adding them to the pipeline.

## Key Insight

> Middleware turns request processing into a pipeline of composable, single-responsibility functions. Each middleware does one thing — log, authenticate, validate, compress — and the pipeline combines them. This separation of concerns makes servers modular: add CORS support by adding one middleware, not by modifying every route handler.

## Experiment

```js
import { createServer } from "http";

console.log("=== Middleware Pipeline ===\n");

class App {
  constructor() {
    this.middlewares = [];
  }

  // Register middleware
  use(fn) {
    this.middlewares.push(fn);
  }

  // Run the middleware chain
  async handle(req, res) {
    let index = 0;

    const next = async (error) => {
      if (error) {
        // Skip to error handler
        return this.handleError(error, req, res);
      }

      const middleware = this.middlewares[index++];
      if (!middleware) return;

      try {
        await middleware(req, res, next);
      } catch (err) {
        this.handleError(err, req, res);
      }
    };

    await next();
  }

  handleError(err, req, res) {
    console.log(`[error] ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(err.statusCode || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  listen(port) {
    const server = createServer((req, res) => this.handle(req, res));
    return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve(server)));
  }
}

const app = new App();

// 1. Request timer middleware
app.use(async (req, res, next) => {
  req.startTime = performance.now();
  console.log(`→ ${req.method} ${req.url}`);

  // Call next, then log after response
  await next();

  const duration = (performance.now() - req.startTime).toFixed(1);
  console.log(`← ${req.method} ${req.url} ${res.statusCode} (${duration}ms)`);
});

// 2. Body parser middleware
app.use(async (req, res, next) => {
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString();

    if (req.headers["content-type"]?.includes("application/json")) {
      try {
        req.body = JSON.parse(raw);
      } catch {
        const err = new Error("Invalid JSON body");
        err.statusCode = 400;
        throw err;
      }
    } else {
      req.body = raw;
    }
  }
  await next();
});

// 3. CORS middleware
app.use(async (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;  // Short-circuit — don't call next()
  }

  await next();
});

// 4. Auth middleware (checks for Bearer token)
app.use(async (req, res, next) => {
  // Skip auth for public routes
  const publicPaths = ["/", "/health"];
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (publicPaths.includes(url.pathname)) {
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    throw err;
  }

  req.token = auth.slice(7);
  req.user = { id: "user-1", name: "Alice" };  // Simulated lookup
  await next();
});

// 5. Response helper middleware
app.use(async (req, res, next) => {
  res.json = (data, statusCode = 200) => {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };
  await next();
});

// 6. Route handler (the final middleware)
app.use(async (req, res, next) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" && req.method === "GET") {
    res.json({ message: "Welcome!", public: true });
  } else if (url.pathname === "/health" && req.method === "GET") {
    res.json({ status: "ok", uptime: process.uptime() });
  } else if (url.pathname === "/profile" && req.method === "GET") {
    res.json({ user: req.user });
  } else if (url.pathname === "/echo" && req.method === "POST") {
    res.json({ received: req.body, user: req.user });
  } else {
    const err = new Error("Not Found");
    err.statusCode = 404;
    throw err;
  }
});

// Start server
const server = await app.listen(0);
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

console.log("--- Testing middleware pipeline ---\n");

// Public route (no auth needed)
const r1 = await fetch(`${base}/`);
console.log("Body:", await r1.json());

// Health check (public)
const r2 = await fetch(`${base}/health`);
console.log("Body:", await r2.json());

console.log();

// Protected route without auth
const r3 = await fetch(`${base}/profile`);
console.log("Status:", r3.status, "Body:", await r3.json());

console.log();

// Protected route with auth
const r4 = await fetch(`${base}/profile`, {
  headers: { Authorization: "Bearer my-token" },
});
console.log("Body:", await r4.json());

console.log();

// POST with JSON body + auth
const r5 = await fetch(`${base}/echo`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer my-token",
  },
  body: JSON.stringify({ hello: "world" }),
});
console.log("Body:", await r5.json());

console.log();

// POST with invalid JSON
const r6 = await fetch(`${base}/echo`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer my-token",
  },
  body: "not json!!!",
});
console.log("Status:", r6.status, "Body:", await r6.json());

console.log();

// CORS preflight
const r7 = await fetch(`${base}/profile`, { method: "OPTIONS" });
console.log("OPTIONS status:", r7.status);
console.log("CORS headers:", r7.headers.get("access-control-allow-origin"));

server.close();
console.log("\nDone");
```

## Expected Output

```
--- Testing middleware pipeline ---

→ GET /
← GET / 200 (Xms)
Body: { message: 'Welcome!', public: true }

→ GET /health
← GET /health 200 (Xms)
Body: { status: 'ok', uptime: ... }

→ GET /profile
[error] Authentication required
← GET /profile 401 (Xms)
Status: 401 Body: { error: 'Authentication required' }

→ GET /profile
← GET /profile 200 (Xms)
Body: { user: { id: 'user-1', name: 'Alice' } }

→ POST /echo
← POST /echo 200 (Xms)
Body: { received: { hello: 'world' }, user: { id: 'user-1', name: 'Alice' } }

→ POST /echo
[error] Invalid JSON body
← POST /echo 400 (Xms)
Status: 400 Body: { error: 'Invalid JSON body' }

→ OPTIONS /profile
← OPTIONS /profile 204 (Xms)
OPTIONS status: 204
CORS headers: *
```

## Challenge

1. Build a rate limiter middleware: track requests per IP, reject with 429 after N requests per minute
2. Implement conditional middleware: `app.use("/api", authMiddleware)` only runs auth for `/api/*` routes
3. Add response compression middleware: check `Accept-Encoding`, compress the response body with gzip or brotli using a Transform stream

## Common Mistakes

- Forgetting to call `next()` — the request hangs forever, no response is sent
- Calling `next()` multiple times — processes the rest of the pipeline twice, causing double responses
- Not wrapping middleware in try/catch — unhandled errors crash the server instead of returning 500
- Modifying `res` after headers are sent — calling `res.writeHead()` twice throws an error
