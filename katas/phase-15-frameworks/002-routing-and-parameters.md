---
id: routing-and-parameters
phase: 15
phase_title: Frameworks (After Fundamentals)
sequence: 2
title: Routing and Parameters
difficulty: intermediate
tags: [routing, radix-tree, parameters, query-string, route-matching]
prerequisites: [why-frameworks-exist]
estimated_minutes: 12
---

## Concept

Routing maps an incoming HTTP request (method + URL) to a handler function. Framework routers go far beyond the regex matching you built in Phase 8.

**Route parameter types:**
- **Path parameters** — `/users/:id` → `req.params.id`
- **Query parameters** — `/users?page=2&limit=10` → `req.query.page`
- **Wildcard** — `/files/*` → matches `/files/a/b/c.txt`

**Router data structures:**

1. **Linear scan** (Express v3) — check each route in order. O(n) per request
2. **Regex compilation** (Express v4) — compile routes to regex. Fast for small sets
3. **Radix tree** (Fastify, find-my-way) — trie-based routing. O(k) where k = URL length

**Route precedence:**
```
GET /users/me        ← static routes match first
GET /users/:id       ← parameterized routes second
GET /users/*         ← wildcards last
```

**Route grouping (prefixes):**
```js
// Fastify
app.register(userRoutes, { prefix: '/api/v1/users' });

// Express
const router = express.Router();
app.use('/api/v1/users', router);
```

## Key Insight

> Fastify uses a radix tree (also called a prefix tree or trie) for routing. Each node in the tree represents a URL segment. When a request comes in for `/api/users/42`, the router walks down: root → `api` → `users` → `:id`. This is O(k) where k is the number of URL segments — it doesn't matter if you have 10 routes or 10,000. Express's regex-based router is also fast for typical apps, but the radix tree approach scales better and handles parameter extraction without regex overhead.

## Experiment

```js
console.log("=== Routing and Parameters ===\n");

// --- Demo 1: Build a radix tree router ---

class RadixNode {
  constructor() {
    this.children = new Map();    // segment → child node
    this.paramChild = null;       // :param child
    this.wildcardChild = null;    // * child
    this.handlers = new Map();    // method → handler
    this.paramName = null;
  }
}

class RadixRouter {
  constructor() {
    this.root = new RadixNode();
    this.routeCount = 0;
  }

  addRoute(method, path, handler) {
    const segments = path.split("/").filter(Boolean);
    let node = this.root;

    for (const segment of segments) {
      if (segment.startsWith(":")) {
        // Parameter segment
        if (!node.paramChild) {
          node.paramChild = new RadixNode();
          node.paramChild.paramName = segment.slice(1);
        }
        node = node.paramChild;
      } else if (segment === "*") {
        // Wildcard
        if (!node.wildcardChild) {
          node.wildcardChild = new RadixNode();
        }
        node = node.wildcardChild;
        break; // Wildcard consumes the rest
      } else {
        // Static segment
        if (!node.children.has(segment)) {
          node.children.set(segment, new RadixNode());
        }
        node = node.children.get(segment);
      }
    }

    node.handlers.set(method, handler);
    this.routeCount++;
  }

  find(method, path) {
    const segments = path.split("/").filter(Boolean);
    const params = {};
    const result = this._find(this.root, segments, 0, params, method);

    if (result) {
      return { handler: result, params };
    }
    return null;
  }

  _find(node, segments, index, params, method) {
    // Base case: consumed all segments
    if (index === segments.length) {
      return node.handlers.get(method) || null;
    }

    const segment = segments[index];

    // 1. Try static match first (highest priority)
    if (node.children.has(segment)) {
      const result = this._find(node.children.get(segment), segments, index + 1, params, method);
      if (result) return result;
    }

    // 2. Try parameter match
    if (node.paramChild) {
      params[node.paramChild.paramName] = segment;
      const result = this._find(node.paramChild, segments, index + 1, params, method);
      if (result) return result;
      delete params[node.paramChild.paramName];
    }

    // 3. Try wildcard match (lowest priority)
    if (node.wildcardChild) {
      params["*"] = segments.slice(index).join("/");
      return node.wildcardChild.handlers.get(method) || null;
    }

    return null;
  }
}

// --- Register routes ---

const router = new RadixRouter();

router.addRoute("GET", "/", () => "home");
router.addRoute("GET", "/api/users", () => "list users");
router.addRoute("GET", "/api/users/me", () => "current user");
router.addRoute("GET", "/api/users/:id", (params) => `user ${params.id}`);
router.addRoute("POST", "/api/users", () => "create user");
router.addRoute("GET", "/api/users/:id/posts", (params) => `posts for user ${params.id}`);
router.addRoute("GET", "/api/users/:id/posts/:postId", (params) => `post ${params.postId} by user ${params.id}`);
router.addRoute("DELETE", "/api/users/:id", (params) => `delete user ${params.id}`);
router.addRoute("GET", "/files/*", (params) => `file: ${params["*"]}`);

console.log(`--- Radix tree router (${router.routeCount} routes) ---\n`);

// --- Demo 2: Route matching ---

const testRoutes = [
  ["GET", "/"],
  ["GET", "/api/users"],
  ["GET", "/api/users/me"],
  ["GET", "/api/users/42"],
  ["POST", "/api/users"],
  ["GET", "/api/users/42/posts"],
  ["GET", "/api/users/42/posts/7"],
  ["DELETE", "/api/users/99"],
  ["GET", "/files/images/photo.jpg"],
  ["GET", "/files/docs/2024/report.pdf"],
  ["GET", "/not/found"],
  ["PATCH", "/api/users/42"],
];

for (const [method, path] of testRoutes) {
  const result = router.find(method, path);
  if (result) {
    const response = result.handler(result.params);
    const paramStr = Object.keys(result.params).length > 0
      ? ` params=${JSON.stringify(result.params)}`
      : "";
    console.log(`  ${method.padEnd(7)} ${path.padEnd(35)} → ${response}${paramStr}`);
  } else {
    console.log(`  ${method.padEnd(7)} ${path.padEnd(35)} → 404 Not Found`);
  }
}

// --- Demo 3: Route precedence ---

console.log("\n--- Route precedence ---\n");

console.log("  Priority order (highest first):");
console.log("    1. Static:    /users/me       ← exact string match");
console.log("    2. Parameter: /users/:id      ← any single segment");
console.log("    3. Wildcard:  /users/*        ← any remaining segments\n");

// Demonstrate precedence
const precedenceRouter = new RadixRouter();
precedenceRouter.addRoute("GET", "/users/me", () => "STATIC: current user profile");
precedenceRouter.addRoute("GET", "/users/:id", () => "PARAM: user by id");
precedenceRouter.addRoute("GET", "/users/*", () => "WILDCARD: catch-all");

const precedenceTests = ["/users/me", "/users/42", "/users/42/settings"];
for (const path of precedenceTests) {
  const result = precedenceRouter.find("GET", path);
  console.log(`  GET ${path.padEnd(25)} → ${result.handler()}`);
}

// --- Demo 4: Query parameter parsing ---

console.log("\n--- Query parameters ---\n");

function parseQuery(url) {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return { path: url, query: {} };

  const path = url.slice(0, qIndex);
  const queryString = url.slice(qIndex + 1);
  const query = {};

  for (const pair of queryString.split("&")) {
    const [key, value] = pair.split("=").map(decodeURIComponent);
    if (query[key] !== undefined) {
      // Multiple values → array
      if (!Array.isArray(query[key])) query[key] = [query[key]];
      query[key].push(value);
    } else {
      query[key] = value;
    }
  }

  return { path, query };
}

const queryTests = [
  "/api/users?page=2&limit=10",
  "/api/search?q=hello%20world&sort=date",
  "/api/filter?tag=node&tag=js&tag=backend",
  "/api/users",
];

for (const url of queryTests) {
  const { path, query } = parseQuery(url);
  console.log(`  URL:   ${url}`);
  console.log(`  Path:  ${path}`);
  console.log(`  Query: ${JSON.stringify(query)}\n`);
}

// --- Demo 5: Route grouping ---

console.log("--- Route grouping (prefix registration) ---\n");

class RouterGroup {
  constructor(router, prefix = "") {
    this.router = router;
    this.prefix = prefix;
  }

  group(prefix) {
    return new RouterGroup(this.router, this.prefix + prefix);
  }

  get(path, handler) {
    this.router.addRoute("GET", this.prefix + path, handler);
  }

  post(path, handler) {
    this.router.addRoute("POST", this.prefix + path, handler);
  }

  put(path, handler) {
    this.router.addRoute("PUT", this.prefix + path, handler);
  }

  delete(path, handler) {
    this.router.addRoute("DELETE", this.prefix + path, handler);
  }
}

const groupedRouter = new RadixRouter();
const api = new RouterGroup(groupedRouter, "/api");

// v1 group
const v1 = api.group("/v1");
v1.get("/users", () => "v1 users");
v1.get("/users/:id", () => "v1 user by id");

// v2 group
const v2 = api.group("/v2");
v2.get("/users", () => "v2 users (paginated)");

console.log("  Registered routes:");
const groupTests = [
  ["GET", "/api/v1/users"],
  ["GET", "/api/v1/users/42"],
  ["GET", "/api/v2/users"],
];

for (const [method, path] of groupTests) {
  const result = groupedRouter.find(method, path);
  console.log(`    ${method} ${path} → ${result ? result.handler() : "404"}`);
}

// --- Demo 6: Performance comparison ---

console.log("\n--- Routing performance ---\n");

// Build a router with many routes
const perfRouter = new RadixRouter();
for (let i = 0; i < 500; i++) {
  perfRouter.addRoute("GET", `/api/resource${i}/:id`, () => i);
}
perfRouter.addRoute("GET", "/api/resource499/sub/:subId", () => "deep");

const lookups = 100_000;

const start = performance.now();
for (let i = 0; i < lookups; i++) {
  perfRouter.find("GET", "/api/resource499/42");
}
const elapsed = performance.now() - start;

console.log(`  Router with ${perfRouter.routeCount} routes`);
console.log(`  ${lookups.toLocaleString()} lookups in ${elapsed.toFixed(1)}ms`);
console.log(`  ${(lookups / elapsed * 1000).toFixed(0)} lookups/sec`);
console.log(`  ${(elapsed / lookups * 1000).toFixed(2)} µs per lookup`);
console.log(`\n  Radix tree: O(segments) — independent of route count`);
```

## Expected Output

```
=== Routing and Parameters ===

--- Radix tree router (9 routes) ---

  GET     /                                   → home
  GET     /api/users                          → list users
  GET     /api/users/me                       → current user
  GET     /api/users/42                       → user 42 params={"id":"42"}
  POST    /api/users                          → create user
  GET     /api/users/42/posts                 → posts for user 42
  ...

--- Route precedence ---

  GET /users/me                  → STATIC: current user profile
  GET /users/42                  → PARAM: user by id
  GET /users/42/settings         → WILDCARD: catch-all
  ...
```

## Challenge

1. Add support for optional parameters (`/users/:id?` matches both `/users` and `/users/42`) and regex constraints (`/users/:id(\\d+)` only matches numeric IDs)
2. Implement a route conflict detector: warn when two routes could match the same URL (e.g., `/users/:id` and `/users/:userId` are ambiguous)
3. Benchmark the radix tree router against a simple linear-scan router with 10, 100, and 1000 routes. At what point does the radix tree become significantly faster?

## Common Mistakes

- Route order dependency — Express matches routes in registration order; Fastify uses specificity. Relying on order makes code fragile
- Not URL-decoding parameters — `/users/hello%20world` should give `params.name = "hello world"`, not the encoded string
- Mixing route styles — combining `/api/v1/users` and `/api/v2/users/:id` without grouping makes the route table hard to reason about
- Not handling trailing slashes — `/users` and `/users/` should route to the same handler (Fastify does this by default)
