---
id: error-handling
phase: 8
phase_title: Building Web Servers & APIs
sequence: 4
title: Error Handling in APIs
difficulty: intermediate
tags: [errors, http, status-codes, error-classes, production]
prerequisites: [json-and-validation]
estimated_minutes: 15
---

## Concept

Error handling in an API has two audiences:

1. **The client** needs a clear, structured error response with an appropriate HTTP status code, a human-readable message, and enough detail to fix the problem
2. **The operator** needs detailed logs with stack traces, request context, and error classification for monitoring and debugging

The key principle: **never expose internal errors to clients.** A database connection error should return `500 Internal Server Error` to the client, not the PostgreSQL connection string. But the server log should contain the full error, stack trace, and request that caused it.

Use custom error classes to classify errors:

- **`ValidationError`** → 422 (client sent bad data)
- **`NotFoundError`** → 404 (resource doesn't exist)
- **`AuthenticationError`** → 401 (not logged in)
- **`AuthorizationError`** → 403 (logged in but not allowed)
- **`ConflictError`** → 409 (e.g., duplicate email)
- **`RateLimitError`** → 429 (too many requests)
- **Unclassified errors** → 500 (our bug, not theirs)

## Key Insight

> Every unhandled error in a request handler should become a 500 response, not a server crash. Custom error classes with status codes let you throw domain-specific errors (`throw new NotFoundError("User not found")`) and have a single error handler convert them to proper HTTP responses. This separates "what went wrong" from "how to respond."

## Experiment

```js
import { createServer } from "http";

console.log("=== Custom Error Classes ===\n");

// Base API error class
class ApiError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    };
  }
}

class NotFoundError extends ApiError {
  constructor(resource, id) {
    super(`${resource} not found: ${id}`, 404, "NOT_FOUND");
    this.resource = resource;
    this.resourceId = id;
  }
}

class ValidationError extends ApiError {
  constructor(errors) {
    super("Validation failed", 422, "VALIDATION_ERROR");
    this.details = errors;
  }
}

class AuthenticationError extends ApiError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

class AuthorizationError extends ApiError {
  constructor(message = "Permission denied") {
    super(message, 403, "FORBIDDEN");
  }
}

class ConflictError extends ApiError {
  constructor(message) {
    super(message, 409, "CONFLICT");
  }
}

// Demonstrate error classes
const errors = [
  new NotFoundError("User", 42),
  new ValidationError([{ field: "email", message: "Invalid format" }]),
  new AuthenticationError(),
  new AuthorizationError("Admin access required"),
  new ConflictError("Email already registered"),
];

for (const err of errors) {
  console.log(`${err.statusCode} ${err.name}: ${err.message}`);
}

console.log("\n=== Error-Handling Server ===\n");

// Simulated database
const users = new Map([
  [1, { id: 1, name: "Alice", email: "alice@example.com", role: "admin" }],
  [2, { id: 2, name: "Bob", email: "bob@example.com", role: "user" }],
]);

// Service functions (throw domain errors)
function getUser(id) {
  const user = users.get(id);
  if (!user) throw new NotFoundError("User", id);
  return user;
}

function createUser(data) {
  // Check for duplicate email
  for (const user of users.values()) {
    if (user.email === data.email) {
      throw new ConflictError(`Email ${data.email} already registered`);
    }
  }
  const id = users.size + 1;
  const user = { id, ...data };
  users.set(id, user);
  return user;
}

function deleteUser(requestingUser, targetId) {
  if (requestingUser.role !== "admin") {
    throw new AuthorizationError("Only admins can delete users");
  }
  const user = getUser(targetId);
  users.delete(targetId);
  return user;
}

// Error handler middleware
function errorHandler(err, req, res) {
  // Determine if this is a known API error or an unexpected error
  if (err instanceof ApiError) {
    // Known error — safe to expose to client
    res.writeHead(err.statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(err.toJSON()));
    console.log(`[handled] ${err.statusCode} ${err.code}: ${err.message}`);
  } else {
    // Unknown error — log full details, send generic message
    console.error(`[unhandled] ${err.stack}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "InternalServerError",
      message: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
      // Never include: stack trace, DB details, internal state
    }));
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // Simulate auth
    const auth = req.headers.authorization;
    const currentUser = auth === "Bearer admin-token"
      ? { id: 1, role: "admin" }
      : auth === "Bearer user-token"
        ? { id: 2, role: "user" }
        : null;

    // GET /users/:id
    const userMatch = url.pathname.match(/^\/users\/(\d+)$/);
    if (req.method === "GET" && userMatch) {
      const user = getUser(parseInt(userMatch[1]));
      const body = JSON.stringify(user);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    // POST /users
    if (req.method === "POST" && url.pathname === "/users") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const user = createUser(data);
      const body = JSON.stringify(user);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    // DELETE /users/:id (requires admin)
    if (req.method === "DELETE" && userMatch) {
      if (!currentUser) throw new AuthenticationError();
      deleteUser(currentUser, parseInt(userMatch[1]));
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /crash (simulates an unexpected error)
    if (url.pathname === "/crash") {
      // This simulates a bug — not a domain error
      null.property;  // TypeError!
    }

    throw new NotFoundError("Route", url.pathname);

  } catch (err) {
    errorHandler(err, req, res);
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

console.log("--- Testing error responses ---\n");

const tests = [
  { name: "Get existing user", method: "GET", path: "/users/1" },
  { name: "Get missing user", method: "GET", path: "/users/999" },
  { name: "Create duplicate", method: "POST", path: "/users",
    body: JSON.stringify({ name: "Dup", email: "alice@example.com" }) },
  { name: "Delete without auth", method: "DELETE", path: "/users/2" },
  { name: "Delete as user", method: "DELETE", path: "/users/2",
    headers: { Authorization: "Bearer user-token" } },
  { name: "Delete as admin", method: "DELETE", path: "/users/2",
    headers: { Authorization: "Bearer admin-token" } },
  { name: "Unexpected error", method: "GET", path: "/crash" },
  { name: "Unknown route", method: "GET", path: "/nope" },
];

for (const test of tests) {
  const options = {
    method: test.method,
    headers: { ...test.headers },
  };
  if (test.body) {
    options.body = test.body;
    options.headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${base}${test.path}`, options);
  const body = res.status === 204 ? "(no content)" : JSON.stringify(await res.json());
  console.log(`${test.name}:`);
  console.log(`  ${res.status} ${body.slice(0, 70)}`);
  console.log();
}

server.close();
console.log("Done");
```

## Expected Output

```
=== Custom Error Classes ===

404 NotFoundError: User not found: 42
422 ValidationError: Validation failed
401 AuthenticationError: Authentication required
403 AuthorizationError: Admin access required
409 ConflictError: Email already registered

=== Error-Handling Server ===

--- Testing error responses ---

Get existing user:
  200 {"id":1,"name":"Alice","email":"alice@example.com","role":"admin"}

Get missing user:
  404 {"error":"NotFoundError","message":"User not found: 999","code":"NOT_FOUND"}

Create duplicate:
  409 {"error":"ConflictError","message":"Email alice@example.com already registered"...}

Delete without auth:
  401 {"error":"AuthenticationError","message":"Authentication required"...}

Delete as user:
  403 {"error":"AuthorizationError","message":"Only admins can delete users"...}

Delete as admin:
  204 (no content)

Unexpected error:
  500 {"error":"InternalServerError","message":"An unexpected error occurred"...}

Unknown route:
  404 {"error":"NotFoundError","message":"Route not found: /nope"...}
```

## Challenge

1. Add a `requestId` to every error response — generate a UUID at the start of each request and include it in both the response and the log. This lets operators correlate client-reported errors with server logs
2. Implement error rate monitoring: track errors per minute by status code. Alert (console.log) if 5xx errors exceed 10 per minute
3. Add retry guidance in error responses: include a `retryAfter` field for 429 and 503 errors, and `retryable: true/false` for all errors

## Common Mistakes

- Exposing stack traces to clients — security risk, leaks internal paths and dependencies
- Using 200 for error responses with `{ "success": false }` — use proper HTTP status codes
- Catching errors too broadly — `catch (e) {}` silently swallows everything, including bugs
- Not logging unhandled errors — a 500 response without a log means you'll never find the bug
