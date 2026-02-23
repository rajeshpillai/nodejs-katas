---
id: routing
phase: 8
phase_title: Building Web Servers & APIs
sequence: 1
title: URL Routing
difficulty: intermediate
tags: [http, routing, url, params, query-string]
prerequisites: [request-response-lifecycle]
estimated_minutes: 15
---

## Concept

Routing maps incoming HTTP requests to handler functions based on the method and URL path. A router answers: "Given `GET /api/users/42`, which function should handle this?"

Routing components:
- **Method matching** — `GET`, `POST`, `PUT`, `DELETE`, etc.
- **Path matching** — exact (`/users`), parameterized (`/users/:id`), wildcard (`/files/*`)
- **Query string parsing** — `?page=2&limit=10` → `{ page: "2", limit: "10" }`
- **URL parameters** — `/users/:id` + `/users/42` → `params.id = "42"`

Building a router from scratch reveals what Express/Fastify do internally: they compile route patterns into regular expressions, test them against incoming paths, extract named parameters, and call the matching handler.

## Key Insight

> A router is just a list of `(method, pattern, handler)` tuples tested in order. When a request arrives, find the first matching tuple and call its handler. Parameterized routes like `/users/:id` become regex patterns like `/^\/users\/([^/]+)$/`. Understanding this demystifies framework routing.

## Experiment

```js
import { createServer } from "http";

console.log("=== Building a Router ===\n");

class Router {
  constructor() {
    this.routes = [];
  }

  // Register a route: method, path pattern, handler
  add(method, path, handler) {
    const { regex, paramNames } = this.compilePath(path);
    this.routes.push({ method: method.toUpperCase(), regex, paramNames, handler, path });
  }

  // Convenience methods
  get(path, handler) { this.add("GET", path, handler); }
  post(path, handler) { this.add("POST", path, handler); }
  put(path, handler) { this.add("PUT", path, handler); }
  delete(path, handler) { this.add("DELETE", path, handler); }

  // Compile a path pattern into a regex
  compilePath(path) {
    const paramNames = [];
    const regexStr = path
      .replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      })
      .replace(/\*/g, "(.*)");
    return { regex: new RegExp(`^${regexStr}$`), paramNames };
  }

  // Find and execute the matching route
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

// Create a router with various route patterns
const router = new Router();

router.get("/", (req, res, params, query) => {
  res.json({ message: "Welcome to the API" });
});

router.get("/users", (req, res, params, query) => {
  const page = parseInt(query.page || "1");
  const limit = parseInt(query.limit || "10");
  res.json({ users: ["Alice", "Bob", "Charlie"], page, limit });
});

router.get("/users/:id", (req, res, params, query) => {
  res.json({ user: { id: params.id, name: `User ${params.id}` } });
});

router.post("/users", async (req, res, params, query) => {
  const body = await readBody(req);
  const user = JSON.parse(body);
  res.status(201).json({ created: user, id: "new-123" });
});

router.get("/users/:userId/posts/:postId", (req, res, params) => {
  res.json({ userId: params.userId, postId: params.postId });
});

router.delete("/users/:id", (req, res, params) => {
  res.status(204).end();
});

// Show compiled routes
console.log("Registered routes:");
for (const route of router.routes) {
  console.log(`  ${route.method.padEnd(6)} ${route.path.padEnd(30)} → ${route.regex}`);
}

// Helper: read request body
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

// Helper: add response utilities
function enhanceResponse(res) {
  res.json = (data) => {
    const body = JSON.stringify(data);
    res.writeHead(res.statusCode || 200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };
  res.status = (code) => { res.statusCode = code; return res; };
  return res;
}

// Create the server
const server = createServer((req, res) => {
  enhanceResponse(res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  const match = router.match(req.method, pathname);

  if (match) {
    const result = match.handler(req, res, match.params, query);
    if (result instanceof Promise) {
      result.catch(err => {
        res.status(500).json({ error: err.message });
      });
    }
  } else {
    res.status(404).json({ error: "Not Found", path: pathname, method: req.method });
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

console.log("\n=== Route Matching ===\n");

// Test various routes
const tests = [
  { method: "GET", path: "/" },
  { method: "GET", path: "/users?page=2&limit=5" },
  { method: "GET", path: "/users/42" },
  { method: "GET", path: "/users/alice/posts/7" },
  { method: "POST", path: "/users", body: JSON.stringify({ name: "Diana" }) },
  { method: "DELETE", path: "/users/42" },
  { method: "GET", path: "/nonexistent" },
];

for (const test of tests) {
  const options = { method: test.method };
  if (test.body) {
    options.body = test.body;
    options.headers = { "Content-Type": "application/json" };
  }

  const res = await fetch(`${base}${test.path}`, options);
  const body = res.status === 204 ? "(no content)" : await res.text();

  console.log(`${test.method.padEnd(6)} ${test.path.padEnd(30)} → ${res.status} ${body.slice(0, 60)}`);
}

console.log("\n=== URL Parsing ===\n");

const url = new URL("/api/search?q=node+js&page=3&tags=backend&tags=api", "http://localhost");
console.log("pathname:", url.pathname);
console.log("search:", url.search);
console.log("searchParams:");
for (const [key, value] of url.searchParams) {
  console.log(`  ${key} = ${value}`);
}
console.log("getAll('tags'):", url.searchParams.getAll("tags"));

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Building a Router ===

Registered routes:
  GET    /                              → /^\/$/
  GET    /users                         → /^\/users$/
  GET    /users/:id                     → /^\/users\/([^/]+)$/
  POST   /users                         → /^\/users$/
  GET    /users/:userId/posts/:postId   → /^\/users\/([^/]+)\/posts\/([^/]+)$/
  DELETE /users/:id                     → /^\/users\/([^/]+)$/

=== Route Matching ===

GET    /                              → 200 {"message":"Welcome to the API"}
GET    /users?page=2&limit=5          → 200 {"users":["Alice","Bob","Charlie"],"page":2,"limit":5}
GET    /users/42                      → 200 {"user":{"id":"42","name":"User 42"}}
GET    /users/alice/posts/7           → 200 {"userId":"alice","postId":"7"}
POST   /users                         → 201 {"created":{"name":"Diana"},"id":"new-123"}
DELETE /users/42                      → 204 (no content)
GET    /nonexistent                   → 404 {"error":"Not Found",...}

=== URL Parsing ===

pathname: /api/search
search: ?q=node+js&page=3&tags=backend&tags=api
searchParams:
  q = node js
  page = 3
  tags = backend
  tags = api
getAll('tags'): [ 'backend', 'api' ]
```

## Challenge

1. Add support for route groups/prefixes: `router.group("/api/v1", (group) => { group.get("/users", ...) })` so routes can share a path prefix
2. Implement route priority: exact matches should win over parameterized routes. `/users/me` should match before `/users/:id`
3. Add a wildcard/catch-all route: `GET /files/*` should match `/files/a/b/c.txt` and capture the full sub-path

## Common Mistakes

- Not decoding URL parameters — `%20` should become a space, `%2F` should become `/`
- Testing routes in wrong order — a greedy pattern like `/users/:id` matches before `/users/search` if registered first
- Not handling trailing slashes — `/users` and `/users/` should usually match the same route
- Parsing query strings manually — use `URL` and `URLSearchParams` instead of splitting on `&` and `=`
