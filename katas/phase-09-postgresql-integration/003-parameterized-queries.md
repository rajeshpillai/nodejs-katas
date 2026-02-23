---
id: parameterized-queries
phase: 9
phase_title: PostgreSQL Integration
sequence: 3
title: Parameterized Queries and SQL Injection
difficulty: intermediate
tags: [postgresql, sql-injection, security, parameterized, prepared-statements]
prerequisites: [connection-pooling]
estimated_minutes: 15
---

## Concept

SQL injection is one of the most dangerous and common security vulnerabilities. It occurs when user input is concatenated directly into SQL strings:

```js
// DANGEROUS: SQL injection vulnerability
const sql = `SELECT * FROM users WHERE name = '${userInput}'`;
```

If `userInput` is `'; DROP TABLE users; --`, the query becomes:
```sql
SELECT * FROM users WHERE name = ''; DROP TABLE users; --'
```

**Parameterized queries** prevent this entirely by separating the SQL structure from the data:

```js
// SAFE: parameterized query
const result = await pool.query(
  'SELECT * FROM users WHERE name = $1',
  [userInput]
);
```

The database receives the query structure and parameters separately. The parameter is always treated as data, never as SQL syntax. No amount of crafted input can break out of the parameter boundary.

## Key Insight

> Parameterized queries don't just escape special characters — they fundamentally separate code from data. The SQL engine parses and plans the query before it ever sees the parameter values. The values are then bound into the plan as data, not as SQL tokens. This makes SQL injection structurally impossible, not just unlikely.

## Experiment

```js
console.log("=== SQL Injection Demonstration ===\n");

// Simulate a vulnerable query builder
function unsafeQuery(table, conditions) {
  let sql = `SELECT * FROM ${table} WHERE `;
  const clauses = [];
  for (const [col, val] of Object.entries(conditions)) {
    clauses.push(`${col} = '${val}'`);  // DANGEROUS!
  }
  return sql + clauses.join(" AND ");
}

// Normal usage looks fine
console.log("Normal query:");
console.log(" ", unsafeQuery("users", { name: "Alice", role: "user" }));

// Attack: SQL injection
console.log("\nSQL injection attacks:");
const attacks = [
  { name: "' OR '1'='1", desc: "Returns all users (auth bypass)" },
  { name: "'; DROP TABLE users; --", desc: "Deletes the users table" },
  { name: "' UNION SELECT password FROM credentials; --", desc: "Extracts passwords" },
  { name: "'; UPDATE users SET role='admin' WHERE name='hacker'; --", desc: "Privilege escalation" },
];

for (const attack of attacks) {
  console.log(`\n  Input: ${attack.name}`);
  console.log(`  SQL:   ${unsafeQuery("users", { name: attack.name })}`);
  console.log(`  Risk:  ${attack.desc}`);
}

console.log("\n=== Parameterized Queries (Safe) ===\n");

// Simulated parameterized query builder
function safeQuery(sql, params) {
  // Show how the query and params are sent separately
  return {
    sql,
    params,
    description: `SQL: "${sql}" with params: [${params.map(p => JSON.stringify(p)).join(", ")}]`,
  };
}

// Same attacks, but safe
console.log("With parameterized queries, all attacks fail:\n");

for (const attack of attacks) {
  const q = safeQuery(
    "SELECT * FROM users WHERE name = $1",
    [attack.name]
  );
  console.log(`  Input: ${attack.name}`);
  console.log(`  ${q.description}`);
  console.log(`  → Parameter treated as literal string, not SQL`);
  console.log();
}

console.log("=== pg Library Syntax ===\n");

// Show correct pg syntax
const examples = [
  {
    desc: "Simple query",
    sql: "SELECT * FROM users WHERE id = $1",
    params: [42],
  },
  {
    desc: "Multiple parameters",
    sql: "SELECT * FROM orders WHERE user_id = $1 AND status = $2 AND total > $3",
    params: [5, "pending", 99.99],
  },
  {
    desc: "INSERT with RETURNING",
    sql: "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, created_at",
    params: ["Alice", "alice@example.com"],
  },
  {
    desc: "UPDATE",
    sql: "UPDATE users SET name = $1, email = $2 WHERE id = $3",
    params: ["Bob", "bob@example.com", 7],
  },
  {
    desc: "DELETE",
    sql: "DELETE FROM sessions WHERE user_id = $1 AND expired_at < $2",
    params: [42, new Date().toISOString()],
  },
  {
    desc: "IN clause (with ANY)",
    sql: "SELECT * FROM users WHERE id = ANY($1)",
    params: [[1, 2, 3, 4, 5]],
  },
  {
    desc: "LIKE pattern",
    sql: "SELECT * FROM users WHERE name ILIKE $1",
    params: ["%alice%"],
  },
  {
    desc: "JSON field",
    sql: "INSERT INTO events (data) VALUES ($1)",
    params: [JSON.stringify({ type: "click", target: "button" })],
  },
];

for (const ex of examples) {
  console.log(`${ex.desc}:`);
  console.log(`  pool.query("${ex.sql}",`);
  console.log(`    ${JSON.stringify(ex.params)});`);
  console.log();
}

console.log("=== Type Handling ===\n");

// PostgreSQL type mapping
const typeMap = [
  ["JavaScript", "PostgreSQL", "Notes"],
  ["string", "text/varchar", "Automatic"],
  ["number (int)", "integer/bigint", "Use Math.round() for integers"],
  ["number (float)", "numeric/float8", "Beware floating point"],
  ["boolean", "boolean", "Automatic"],
  ["null", "NULL", "Automatic"],
  ["Date", "timestamptz", "Use .toISOString()"],
  ["Array", "array/ANY()", "Use ANY($1) for IN queries"],
  ["Object", "jsonb", "JSON.stringify() first"],
  ["Buffer", "bytea", "Binary data"],
];

console.log("Type mapping (Node.js → PostgreSQL):");
for (const [js, pg, note] of typeMap) {
  console.log(`  ${js.padEnd(16)} → ${pg.padEnd(16)} ${note}`);
}

console.log("\n=== Common Patterns ===\n");

// Dynamic query building (still safe)
function buildQuery(filters) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.name) {
    conditions.push(`name ILIKE $${paramIndex++}`);
    params.push(`%${filters.name}%`);
  }

  if (filters.minAge) {
    conditions.push(`age >= $${paramIndex++}`);
    params.push(filters.minAge);
  }

  if (filters.roles?.length) {
    conditions.push(`role = ANY($${paramIndex++})`);
    params.push(filters.roles);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  return {
    sql: `SELECT * FROM users ${where} ORDER BY name LIMIT $${paramIndex++}`,
    params: [...params, filters.limit || 50],
  };
}

console.log("Dynamic query builder (always parameterized):\n");

const testFilters = [
  { name: "alice" },
  { minAge: 18, roles: ["admin", "moderator"] },
  { name: "bob", minAge: 25, limit: 10 },
  {},  // No filters
];

for (const filters of testFilters) {
  const q = buildQuery(filters);
  console.log(`  Filters: ${JSON.stringify(filters)}`);
  console.log(`  SQL: ${q.sql}`);
  console.log(`  Params: ${JSON.stringify(q.params)}`);
  console.log();
}
```

## Expected Output

```
=== SQL Injection Demonstration ===

Normal query:
  SELECT * FROM users WHERE name = 'Alice' AND role = 'user'

SQL injection attacks:

  Input: ' OR '1'='1
  SQL:   SELECT * FROM users WHERE name = '' OR '1'='1'
  Risk:  Returns all users (auth bypass)

  Input: '; DROP TABLE users; --
  SQL:   SELECT * FROM users WHERE name = ''; DROP TABLE users; --'
  Risk:  Deletes the users table
  ...

=== Parameterized Queries (Safe) ===

With parameterized queries, all attacks fail:

  Input: ' OR '1'='1
  SQL: "SELECT * FROM users WHERE name = $1" with params: ["' OR '1'='1"]
  → Parameter treated as literal string, not SQL
  ...

=== pg Library Syntax ===

...

=== Dynamic query builder ===

  Filters: {"name":"alice"}
  SQL: SELECT * FROM users WHERE name ILIKE $1 ORDER BY name LIMIT $2
  Params: ["%alice%",50]
  ...
```

## Challenge

1. Build a dynamic query builder that safely handles `ORDER BY` — column names can't be parameterized, so you must whitelist them
2. What's the difference between parameterized queries and prepared statements? When would you use `client.query({ name: 'get-user', text: '...', values: [...] })`?
3. Write a function that safely builds a bulk `INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4), ...` for N rows

## Common Mistakes

- Using string interpolation for SQL — even "trusted" internal values should use parameters for consistency
- Parameterizing column names or table names — `$1` only works for values, not identifiers. Whitelist identifiers instead
- Forgetting that `IN ($1)` doesn't work with arrays — use `= ANY($1)` and pass a JavaScript array
- Using `parseInt()` on user input and putting it directly in SQL — this seems safe but is fragile. Use parameters always
