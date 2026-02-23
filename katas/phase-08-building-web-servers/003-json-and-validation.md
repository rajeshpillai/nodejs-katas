---
id: json-and-validation
phase: 8
phase_title: Building Web Servers & APIs
sequence: 3
title: JSON APIs and Validation
difficulty: intermediate
tags: [json, validation, api, error-handling, schema]
prerequisites: [middleware-patterns]
estimated_minutes: 15
---

## Concept

A JSON API receives structured data from clients and returns structured responses. The critical step between receiving and processing is **validation** — never trust client input.

Validation should check:
- **Presence** — required fields exist
- **Type** — field is a string, number, array, etc.
- **Format** — email matches a pattern, date is valid ISO 8601
- **Range** — number is between 1 and 100, string is under 255 chars
- **Business rules** — age ≥ 18, username is unique

Validation should happen early (before any database queries) and fail fast (report all errors at once, not one at a time).

A good API returns consistent error responses:
```json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "age", "message": "Must be at least 18" }
  ]
}
```

## Key Insight

> Validate at the boundary, trust internally. Every byte from a client is suspect — wrong type, missing fields, SQL injection, oversized payloads. Validate once at the API boundary, then your internal functions can trust their inputs. This is cheaper and cleaner than defensive checks scattered throughout the codebase.

## Experiment

```js
import { createServer } from "http";

console.log("=== JSON Validation ===\n");

// --- Schema Validator ---

class Validator {
  constructor() {
    this.errors = [];
  }

  // Field validators
  required(obj, field) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
      this.errors.push({ field, message: "Required" });
      return false;
    }
    return true;
  }

  string(obj, field, { min, max } = {}) {
    if (!this.required(obj, field)) return;
    if (typeof obj[field] !== "string") {
      this.errors.push({ field, message: "Must be a string" });
      return;
    }
    if (min && obj[field].length < min) {
      this.errors.push({ field, message: `Must be at least ${min} characters` });
    }
    if (max && obj[field].length > max) {
      this.errors.push({ field, message: `Must be at most ${max} characters` });
    }
  }

  number(obj, field, { min, max, integer } = {}) {
    if (!this.required(obj, field)) return;
    if (typeof obj[field] !== "number" || isNaN(obj[field])) {
      this.errors.push({ field, message: "Must be a number" });
      return;
    }
    if (integer && !Number.isInteger(obj[field])) {
      this.errors.push({ field, message: "Must be an integer" });
    }
    if (min !== undefined && obj[field] < min) {
      this.errors.push({ field, message: `Must be at least ${min}` });
    }
    if (max !== undefined && obj[field] > max) {
      this.errors.push({ field, message: `Must be at most ${max}` });
    }
  }

  email(obj, field) {
    if (!this.required(obj, field)) return;
    if (typeof obj[field] !== "string") {
      this.errors.push({ field, message: "Must be a string" });
      return;
    }
    // Simple email check (production: use a proper library)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj[field])) {
      this.errors.push({ field, message: "Invalid email format" });
    }
  }

  oneOf(obj, field, values) {
    if (!this.required(obj, field)) return;
    if (!values.includes(obj[field])) {
      this.errors.push({ field, message: `Must be one of: ${values.join(", ")}` });
    }
  }

  array(obj, field, { minLength, maxLength } = {}) {
    if (!this.required(obj, field)) return;
    if (!Array.isArray(obj[field])) {
      this.errors.push({ field, message: "Must be an array" });
      return;
    }
    if (minLength && obj[field].length < minLength) {
      this.errors.push({ field, message: `Must have at least ${minLength} items` });
    }
    if (maxLength && obj[field].length > maxLength) {
      this.errors.push({ field, message: `Must have at most ${maxLength} items` });
    }
  }

  optional(obj, field, validateFn) {
    if (obj[field] !== undefined && obj[field] !== null) {
      validateFn();
    }
  }

  isValid() {
    return this.errors.length === 0;
  }
}

// --- Validation functions for each endpoint ---

function validateCreateUser(body) {
  const v = new Validator();
  v.string(body, "name", { min: 2, max: 50 });
  v.email(body, "email");
  v.number(body, "age", { min: 0, max: 150, integer: true });
  v.oneOf(body, "role", ["user", "admin", "moderator"]);
  v.optional(body, "tags", () => {
    v.array(body, "tags", { maxLength: 10 });
  });
  return v;
}

// Demonstrate validation
console.log("--- Valid input ---\n");

const valid = { name: "Alice", email: "alice@example.com", age: 30, role: "user" };
const v1 = validateCreateUser(valid);
console.log("Input:", valid);
console.log("Valid:", v1.isValid());
console.log("Errors:", v1.errors);

console.log("\n--- Invalid input ---\n");

const invalid = { name: "A", email: "not-an-email", age: -5, role: "superadmin" };
const v2 = validateCreateUser(invalid);
console.log("Input:", invalid);
console.log("Valid:", v2.isValid());
console.log("Errors:");
for (const err of v2.errors) {
  console.log(`  ${err.field}: ${err.message}`);
}

console.log("\n--- Missing fields ---\n");

const missing = {};
const v3 = validateCreateUser(missing);
console.log("Input:", missing);
console.log("Errors:", v3.errors.length, "fields invalid");
for (const err of v3.errors) {
  console.log(`  ${err.field}: ${err.message}`);
}

console.log("\n=== JSON API Server ===\n");

// In-memory "database"
const users = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // JSON response helper
  const json = (data, status = 200) => {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };

  // Read body helper
  const readBody = async () => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  };

  try {
    // List users
    if (req.method === "GET" && url.pathname === "/users") {
      json({ users, count: users.length });
      return;
    }

    // Create user
    if (req.method === "POST" && url.pathname === "/users") {
      let body;
      try {
        body = await readBody();
      } catch {
        json({ error: "Invalid JSON" }, 400);
        return;
      }

      const v = validateCreateUser(body);
      if (!v.isValid()) {
        json({ error: "Validation failed", details: v.errors }, 422);
        return;
      }

      const user = { id: users.length + 1, ...body, createdAt: new Date().toISOString() };
      users.push(user);
      json(user, 201);
      return;
    }

    json({ error: "Not Found" }, 404);
  } catch (err) {
    json({ error: "Internal Server Error", message: err.message }, 500);
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

// Test the API
console.log("--- Creating users ---\n");

const responses = [
  // Valid user
  await fetch(`${base}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", age: 30, role: "admin" }),
  }),
  // Invalid: validation errors
  await fetch(`${base}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "B", email: "bad", age: -1, role: "boss" }),
  }),
  // Invalid JSON
  await fetch(`${base}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  }),
  // Valid second user
  await fetch(`${base}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", age: 25, role: "user", tags: ["dev"] }),
  }),
];

for (const res of responses) {
  const data = await res.json();
  console.log(`  ${res.status}:`, JSON.stringify(data).slice(0, 80));
}

// List users
console.log("\n--- Listing users ---\n");
const listRes = await fetch(`${base}/users`);
const listData = await listRes.json();
console.log("Users:", listData.count);
for (const u of listData.users) {
  console.log(`  #${u.id} ${u.name} (${u.email}) - ${u.role}`);
}

server.close();
console.log("\nDone");
```

## Expected Output

```
=== JSON Validation ===

--- Valid input ---

Input: { name: 'Alice', email: 'alice@example.com', age: 30, role: 'user' }
Valid: true
Errors: []

--- Invalid input ---

Input: { name: 'A', email: 'not-an-email', age: -5, role: 'superadmin' }
Valid: false
Errors:
  name: Must be at least 2 characters
  email: Invalid email format
  age: Must be at least 0
  role: Must be one of: user, admin, moderator

--- Missing fields ---

Input: {}
Errors: 4 fields invalid
  name: Required
  email: Required
  age: Required
  role: Required

=== JSON API Server ===

--- Creating users ---

  201: {"id":1,"name":"Alice",...}
  422: {"error":"Validation failed","details":[...]}
  400: {"error":"Invalid JSON"}
  201: {"id":2,"name":"Bob",...}

--- Listing users ---

Users: 2
  #1 Alice (alice@example.com) - admin
  #2 Bob (bob@example.com) - user
```

## Challenge

1. Add update validation: `PUT /users/:id` should validate the same fields but allow partial updates (only validate present fields)
2. Implement a `sanitize` step before validation: trim strings, coerce `"42"` to `42` for number fields
3. Add a maximum request body size check (1 MB) — reject with 413 before parsing

## Common Mistakes

- Validating one field at a time (returning on first error) — return ALL validation errors so the client can fix them in one pass
- Using HTTP 400 for validation errors — 422 Unprocessable Entity is more semantically correct
- Not validating the `Content-Type` header — a POST with `text/plain` shouldn't be parsed as JSON
- Trusting `Content-Length` for body size limits — it can be spoofed. Count bytes as you read the stream
