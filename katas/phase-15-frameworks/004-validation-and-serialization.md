---
id: validation-and-serialization
phase: 15
phase_title: Frameworks (After Fundamentals)
sequence: 4
title: Validation and Serialization
difficulty: intermediate
tags: [validation, serialization, schema, json-schema, ajv, zod]
prerequisites: [middleware-and-hooks]
estimated_minutes: 15
---

## Concept

Every API must solve two problems:
1. **Validation** — is the incoming data correct?
2. **Serialization** — how do we format the outgoing data?

**Validation approaches:**

| Approach | Example | Pros | Cons |
|----------|---------|------|------|
| Manual `if` checks | `if (!body.email)` | No deps | Verbose, error-prone |
| JSON Schema + ajv | `{ type: "object", properties: ... }` | Standard, fast | Verbose schema syntax |
| Zod | `z.object({ email: z.string().email() })` | TypeScript-native, ergonomic | Runtime overhead |
| Joi | `Joi.object({ email: Joi.string().email() })` | Mature, expressive | Large bundle |

**Fastify's approach:**
- Uses JSON Schema for both validation AND serialization
- ajv compiles schemas to optimized validator functions at startup
- fast-json-stringify compiles schemas to optimized serializers
- Schema = documentation (OpenAPI spec can be auto-generated)

**Where to validate:**
- **Request body** — POST/PUT/PATCH payloads
- **Path parameters** — `/users/:id` (is `id` a number?)
- **Query parameters** — `?page=2&limit=100` (are they within range?)
- **Headers** — `Authorization`, `Content-Type`
- **Response** — ensure you never leak internal fields (passwords, internal IDs)

## Key Insight

> Fastify validates input AND output. Most frameworks only validate input, but response validation catches a critical class of bugs: accidentally sending sensitive data. If your User schema says `response: { properties: { name, email } }` but your handler returns the full database row including `password_hash`, Fastify strips the extra fields. This is defense-in-depth — even if your handler code is wrong, the schema prevents data leaks.

## Experiment

```js
console.log("=== Validation and Serialization ===\n");

// --- Demo 1: Manual validation — the pain ---

console.log("--- Manual validation (verbose and error-prone) ---\n");

function validateUserManual(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Body must be an object"] };
  }

  if (!body.name || typeof body.name !== "string") {
    errors.push("name is required and must be a string");
  } else if (body.name.length < 2 || body.name.length > 50) {
    errors.push("name must be between 2 and 50 characters");
  }

  if (!body.email || typeof body.email !== "string") {
    errors.push("email is required and must be a string");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push("email must be a valid email address");
  }

  if (body.age !== undefined) {
    if (typeof body.age !== "number" || !Number.isInteger(body.age)) {
      errors.push("age must be an integer");
    } else if (body.age < 0 || body.age > 150) {
      errors.push("age must be between 0 and 150");
    }
  }

  if (body.role !== undefined && !["admin", "user", "guest"].includes(body.role)) {
    errors.push("role must be one of: admin, user, guest");
  }

  return { valid: errors.length === 0, errors };
}

const manualTests = [
  { name: "Alice", email: "alice@example.com", age: 30 },
  { name: "B", email: "not-email", age: -5 },
  { email: "no-name@test.com" },
  { name: "Charlie", email: "c@test.com", role: "superadmin" },
  "not an object",
];

for (const input of manualTests) {
  const result = validateUserManual(input);
  const display = typeof input === "string" ? `"${input}"` : JSON.stringify(input);
  console.log(`  ${display.slice(0, 55).padEnd(55)} ${result.valid ? "✓ valid" : "✗ " + result.errors[0]}`);
}

console.log(`\n  Lines of code: ~30 for one object with 4 fields`);
console.log("  Imagine doing this for every API endpoint...\n");

// --- Demo 2: JSON Schema validation ---

console.log("--- JSON Schema validation ---\n");

class SchemaValidator {
  constructor(schema) {
    this.schema = schema;
  }

  validate(data) {
    const errors = [];
    this._validate(data, this.schema, "", errors);
    return { valid: errors.length === 0, errors };
  }

  _validate(data, schema, path, errors) {
    // Type check
    if (schema.type) {
      const actualType = Array.isArray(data) ? "array" : typeof data;
      if (actualType !== schema.type) {
        errors.push(`${path || "root"}: expected ${schema.type}, got ${actualType}`);
        return;
      }
    }

    // String constraints
    if (schema.type === "string" && typeof data === "string") {
      if (schema.minLength && data.length < schema.minLength) {
        errors.push(`${path}: must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength && data.length > schema.maxLength) {
        errors.push(`${path}: must be at most ${schema.maxLength} characters`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        errors.push(`${path}: does not match pattern ${schema.pattern}`);
      }
      if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
        errors.push(`${path}: must be a valid email`);
      }
    }

    // Number constraints
    if (schema.type === "integer" || schema.type === "number") {
      if (schema.type === "integer" && !Number.isInteger(data)) {
        errors.push(`${path}: must be an integer`);
      }
      if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push(`${path}: must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push(`${path}: must be <= ${schema.maximum}`);
      }
    }

    // Enum
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push(`${path}: must be one of [${schema.enum.join(", ")}]`);
    }

    // Object properties
    if (schema.type === "object" && typeof data === "object" && data !== null) {
      // Required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (data[field] === undefined) {
            errors.push(`${path}.${field}: required field missing`);
          }
        }
      }

      // Validate each property
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (data[key] !== undefined) {
            this._validate(data[key], propSchema, `${path}.${key}`, errors);
          }
        }
      }

      // Additional properties
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties || {}));
        for (const key of Object.keys(data)) {
          if (!allowed.has(key)) {
            errors.push(`${path}.${key}: additional property not allowed`);
          }
        }
      }
    }

    // Array
    if (schema.type === "array" && Array.isArray(data)) {
      if (schema.minItems && data.length < schema.minItems) {
        errors.push(`${path}: must have at least ${schema.minItems} items`);
      }
      if (schema.maxItems && data.length > schema.maxItems) {
        errors.push(`${path}: must have at most ${schema.maxItems} items`);
      }
      if (schema.items) {
        data.forEach((item, i) => {
          this._validate(item, schema.items, `${path}[${i}]`, errors);
        });
      }
    }
  }
}

// Define schema once — use for validation, docs, and serialization
const userSchema = {
  type: "object",
  required: ["name", "email"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 2, maxLength: 50 },
    email: { type: "string", format: "email" },
    age: { type: "integer", minimum: 0, maximum: 150 },
    role: { type: "string", enum: ["admin", "user", "guest"] },
    tags: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
};

const validator = new SchemaValidator(userSchema);

const schemaTests = [
  { name: "Alice", email: "alice@test.com", age: 30, role: "admin" },
  { name: "A", email: "bad", age: -1, role: "superadmin" },
  { name: "Bob", email: "bob@test.com", extra: "field" },
  { email: "no-name@test.com" },
  { name: "Charlie", email: "c@test.com", tags: ["a", "b", "c", "d", "e", "f"] },
];

for (const input of schemaTests) {
  const result = validator.validate(input);
  console.log(`  ${JSON.stringify(input).slice(0, 60).padEnd(60)} ${result.valid ? "✓" : "✗"}`);
  if (!result.valid) {
    for (const err of result.errors.slice(0, 2)) {
      console.log(`    ${err}`);
    }
  }
}

// --- Demo 3: Response serialization ---

console.log("\n--- Response serialization (stripping fields) ---\n");

class ResponseSerializer {
  constructor(schema) {
    this.schema = schema;
  }

  serialize(data) {
    return this._serialize(data, this.schema);
  }

  _serialize(data, schema) {
    if (!schema || data === undefined || data === null) return data;

    if (schema.type === "object" && schema.properties) {
      const result = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] !== undefined) {
          result[key] = this._serialize(data[key], propSchema);
        }
      }
      return result;
    }

    if (schema.type === "array" && schema.items && Array.isArray(data)) {
      return data.map(item => this._serialize(item, schema.items));
    }

    return data;
  }
}

// Response schema — only expose safe fields
const userResponseSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string" },
  },
};

const serializer = new ResponseSerializer(userResponseSchema);

// Database row has sensitive fields
const dbRow = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
  password_hash: "$2b$12$abc...",
  internal_id: "usr_internal_abc123",
  created_at: "2024-01-15T10:30:00Z",
  last_ip: "192.168.1.1",
};

console.log("  Database row (all fields):");
console.log(`    ${JSON.stringify(dbRow)}\n`);

const safe = serializer.serialize(dbRow);
console.log("  Serialized response (only schema fields):");
console.log(`    ${JSON.stringify(safe)}\n`);

console.log("  Stripped fields: password_hash, internal_id, created_at, last_ip");
console.log("  → Even buggy handler code can't leak sensitive data");

// --- Demo 4: Compiled validation (what ajv does) ---

console.log("\n--- Compiled validation (ajv concept) ---\n");

function compileValidator(schema) {
  // Generate an optimized validation function from the schema
  // Real ajv does this with code generation
  const checks = [];

  if (schema.type === "object") {
    checks.push(`typeof data === "object" && data !== null`);

    if (schema.required) {
      for (const field of schema.required) {
        checks.push(`data.${field} !== undefined`);
      }
    }

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.type === "string") {
          checks.push(`(data.${key} === undefined || typeof data.${key} === "string")`);
          if (prop.minLength) {
            checks.push(`(data.${key} === undefined || data.${key}.length >= ${prop.minLength})`);
          }
        }
        if (prop.type === "integer") {
          checks.push(`(data.${key} === undefined || Number.isInteger(data.${key}))`);
        }
      }
    }
  }

  const fnBody = `return ${checks.join(" && ")}`;
  const fn = new Function("data", fnBody);

  return {
    validate: fn,
    source: fnBody,
  };
}

const compiled = compileValidator({
  type: "object",
  required: ["name", "email"],
  properties: {
    name: { type: "string", minLength: 2 },
    email: { type: "string" },
    age: { type: "integer" },
  },
});

console.log("  Compiled validator source:");
console.log(`    ${compiled.source}\n`);

// Benchmark: interpreted vs compiled
const testObj = { name: "Alice", email: "alice@test.com", age: 30 };
const iterations = 100_000;

const startInterpreted = performance.now();
for (let i = 0; i < iterations; i++) {
  validator.validate(testObj);
}
const interpretedTime = performance.now() - startInterpreted;

const startCompiled = performance.now();
for (let i = 0; i < iterations; i++) {
  compiled.validate(testObj);
}
const compiledTime = performance.now() - startCompiled;

console.log(`  Interpreted: ${interpretedTime.toFixed(1)}ms (${iterations} validations)`);
console.log(`  Compiled:    ${compiledTime.toFixed(1)}ms (${iterations} validations)`);
console.log(`  Speedup:     ${(interpretedTime / compiledTime).toFixed(1)}x`);
console.log(`\n  ajv generates optimized JS code from schemas at startup`);

// --- Demo 5: Fastify schema pattern ---

console.log("\n--- Fastify route schema pattern ---\n");

console.log(`  app.post('/users', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string', minLength: 2 },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    // req.body is already validated
    // response will be serialized per schema
    const user = await createUser(req.body);
    reply.code(201);
    return user;
  });

  // What Fastify does automatically:
  // 1. Compiles body schema → ajv validator (once at startup)
  // 2. Compiles response schema → fast-json-stringify (once at startup)
  // 3. On request: validates body → runs handler → serializes response
  // 4. Invalid body → 400 with error details (no handler code runs)
  // 5. Response → only schema fields sent (strips extras)
`);
```

## Expected Output

```
=== Validation and Serialization ===

--- Manual validation (verbose and error-prone) ---

  {"name":"Alice","email":"alice@example.com","age":30}       ✓ valid
  {"name":"B","email":"not-email","age":-5}                   ✗ name must be...
  ...

--- JSON Schema validation ---

  {"name":"Alice","email":"alice@test.com","age":30,"role":"admin"}  ✓
  {"name":"A","email":"bad","age":-1,"role":"superadmin"}            ✗
  ...

--- Response serialization (stripping fields) ---

  Serialized response (only schema fields):
    {"id":1,"name":"Alice","email":"alice@example.com","role":"admin"}
  ...
```

## Challenge

1. Build a validation middleware that takes a JSON Schema and returns a Fastify-compatible handler that auto-validates `body`, `params`, and `querystring`. Return 400 with detailed error messages on validation failure
2. Implement a schema-aware JSON serializer that generates a specialized `stringify` function from a schema (like fast-json-stringify). Benchmark it against `JSON.stringify` for your API's typical response shapes
3. How does Fastify auto-generate an OpenAPI (Swagger) spec from route schemas? What additional metadata do you need to add to make the spec complete?

## Common Mistakes

- Validating only on the client — client-side validation is for UX. Server-side validation is for security. Always validate on the server
- Not validating response schemas — without response validation, a handler bug can leak `password_hash` or internal IDs
- Over-validating — checking every possible edge case in manual `if` statements instead of using schema-based validation
- Ignoring validation performance — for high-throughput APIs, interpreted validation (checking rules one by one) is much slower than compiled validation (ajv). Pre-compile schemas at startup
