---
id: error-handling-db
phase: 9
phase_title: PostgreSQL Integration
sequence: 5
title: Database Error Handling
difficulty: intermediate
tags: [postgresql, errors, constraints, retry, resilience]
prerequisites: [transactions]
estimated_minutes: 15
---

## Concept

Database errors fall into two categories:

**Client errors** (your fault — fix the code):
- `23505` — Unique violation (duplicate key)
- `23503` — Foreign key violation (referenced row doesn't exist)
- `23502` — Not null violation (required field missing)
- `23514` — Check constraint violation (value out of range)
- `42P01` — Table doesn't exist (wrong table name)
- `42601` — Syntax error in SQL

**Server/infrastructure errors** (not your fault — handle and retry):
- `53300` — Too many connections
- `57014` — Query cancelled (statement_timeout)
- `08006` — Connection failure
- `40001` — Serialization failure (retry the transaction)
- `40P01` — Deadlock detected (retry the transaction)

The error code (SQLSTATE) tells you exactly what went wrong and whether retrying might help. PostgreSQL errors in the `pg` library include:
- `err.code` — the 5-character SQLSTATE code
- `err.message` — human-readable description
- `err.detail` — additional context (e.g., which key was duplicated)
- `err.constraint` — name of the violated constraint
- `err.table` — table where the error occurred

## Key Insight

> Not all database errors are equal. A unique violation (23505) means the client sent duplicate data — retrying won't help, return 409 Conflict. A serialization failure (40001) means two transactions collided — retry immediately. A connection failure (08006) means the database is down — retry with backoff. The SQLSTATE code tells you the correct response strategy for every error.

## Experiment

```js
console.log("=== PostgreSQL Error Classification ===\n");

// Simulate pg error objects
class PgError extends Error {
  constructor(code, message, detail, constraint, table) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.constraint = constraint;
    this.table = table;
    this.severity = "ERROR";
  }
}

// Error classifier
function classifyError(err) {
  const code = err.code || "";

  // Class 23: Integrity Constraint Violation
  if (code === "23505") {
    return {
      type: "UNIQUE_VIOLATION",
      httpStatus: 409,
      retryable: false,
      message: `Duplicate value: ${err.detail || err.message}`,
    };
  }
  if (code === "23503") {
    return {
      type: "FOREIGN_KEY_VIOLATION",
      httpStatus: 422,
      retryable: false,
      message: `Referenced record not found: ${err.detail || err.message}`,
    };
  }
  if (code === "23502") {
    return {
      type: "NOT_NULL_VIOLATION",
      httpStatus: 422,
      retryable: false,
      message: `Required field missing: ${err.constraint || err.message}`,
    };
  }
  if (code.startsWith("23")) {
    return {
      type: "CONSTRAINT_VIOLATION",
      httpStatus: 422,
      retryable: false,
      message: err.message,
    };
  }

  // Class 40: Transaction Rollback
  if (code === "40001") {
    return {
      type: "SERIALIZATION_FAILURE",
      httpStatus: 503,
      retryable: true,
      message: "Transaction conflict — please retry",
    };
  }
  if (code === "40P01") {
    return {
      type: "DEADLOCK",
      httpStatus: 503,
      retryable: true,
      message: "Deadlock detected — please retry",
    };
  }

  // Class 53: Insufficient Resources
  if (code === "53300") {
    return {
      type: "TOO_MANY_CONNECTIONS",
      httpStatus: 503,
      retryable: true,
      message: "Database overloaded — try again later",
    };
  }

  // Class 57: Operator Intervention
  if (code === "57014") {
    return {
      type: "QUERY_TIMEOUT",
      httpStatus: 504,
      retryable: true,
      message: "Query timed out",
    };
  }

  // Class 08: Connection Exception
  if (code.startsWith("08")) {
    return {
      type: "CONNECTION_ERROR",
      httpStatus: 503,
      retryable: true,
      message: "Database connection lost",
    };
  }

  // Class 42: Syntax Error or Access Rule Violation
  if (code.startsWith("42")) {
    return {
      type: "SQL_ERROR",
      httpStatus: 500,
      retryable: false,
      message: `SQL error: ${err.message}`,
    };
  }

  // Unknown
  return {
    type: "UNKNOWN_DB_ERROR",
    httpStatus: 500,
    retryable: false,
    message: err.message,
  };
}

// Demo: classify various errors
const testErrors = [
  new PgError("23505", "duplicate key value violates unique constraint",
    "Key (email)=(alice@example.com) already exists.", "users_email_key", "users"),
  new PgError("23503", "insert or update on table \"orders\" violates foreign key constraint",
    "Key (user_id)=(999) is not present in table \"users\".", "orders_user_id_fkey", "orders"),
  new PgError("23502", "null value in column \"name\" violates not-null constraint",
    null, "users_name_not_null", "users"),
  new PgError("40001", "could not serialize access due to concurrent update",
    null, null, null),
  new PgError("40P01", "deadlock detected",
    "Process 1234 waits for ShareLock on transaction 5678", null, null),
  new PgError("57014", "canceling statement due to statement timeout",
    null, null, null),
  new PgError("08006", "connection to server was lost",
    null, null, null),
  new PgError("53300", "too many connections for role \"app_user\"",
    null, null, null),
  new PgError("42P01", "relation \"nonexistent\" does not exist",
    null, null, null),
];

console.log("Error classification:\n");
for (const err of testErrors) {
  const classified = classifyError(err);
  console.log(`  Code: ${err.code} (${classified.type})`);
  console.log(`    HTTP: ${classified.httpStatus}, Retryable: ${classified.retryable}`);
  console.log(`    Message: ${classified.message}`);
  console.log();
}

console.log("=== Retry Strategy for Database Errors ===\n");

async function queryWithRetry(queryFn, options = {}) {
  const { maxRetries = 3, baseDelay = 100 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      const classified = classifyError(err);

      if (!classified.retryable || attempt === maxRetries) {
        // Non-retryable or exhausted retries
        console.log(`  [attempt ${attempt + 1}] Failed permanently: ${classified.type}`);
        throw err;
      }

      // Retryable error — wait and try again
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`  [attempt ${attempt + 1}] ${classified.type} — retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Demo: retryable error (simulated serialization failure)
console.log("Scenario: Serialization failure with retry\n");

let callCount = 0;
try {
  await queryWithRetry(async () => {
    callCount++;
    if (callCount < 3) {
      throw new PgError("40001", "could not serialize access");
    }
    return { rows: [{ id: 1 }], rowCount: 1 };
  });
  console.log(`  Success on attempt ${callCount}!\n`);
} catch (err) {
  console.log(`  Failed after ${callCount} attempts\n`);
}

// Demo: non-retryable error
console.log("Scenario: Unique violation (no retry)\n");

try {
  await queryWithRetry(async () => {
    throw new PgError("23505", "duplicate key", "Key (email)=(dup@test.com) exists");
  });
} catch (err) {
  console.log(`  Correctly did not retry\n`);
}

console.log("=== Upsert Pattern (Handle Duplicates) ===\n");

console.log("Instead of catching 23505, use ON CONFLICT:\n");
console.log(`  INSERT INTO users (email, name)
  VALUES ($1, $2)
  ON CONFLICT (email)
  DO UPDATE SET name = EXCLUDED.name
  RETURNING *;
`);

console.log("This atomically handles the 'create or update' pattern");
console.log("without needing error handling for duplicates.\n");

console.log("=== Error Response Mapping ===\n");

const errorResponses = [
  ["SQLSTATE", "HTTP", "Client Message"],
  ["23505", "409", "Resource already exists"],
  ["23503", "422", "Referenced resource not found"],
  ["23502", "422", "Required field missing"],
  ["40001", "503", "Temporary conflict, please retry"],
  ["57014", "504", "Request timed out"],
  ["08006", "503", "Service temporarily unavailable"],
  ["42xxx", "500", "Internal server error (log details)"],
];

for (const [code, http, msg] of errorResponses) {
  console.log(`  ${code.padEnd(8)} → ${http} ${msg}`);
}
```

## Expected Output

```
=== PostgreSQL Error Classification ===

Error classification:

  Code: 23505 (UNIQUE_VIOLATION)
    HTTP: 409, Retryable: false
    Message: Duplicate value: Key (email)=(alice@example.com) already exists.

  Code: 23503 (FOREIGN_KEY_VIOLATION)
    HTTP: 422, Retryable: false
    Message: Referenced record not found: ...

  Code: 40001 (SERIALIZATION_FAILURE)
    HTTP: 503, Retryable: true
    Message: Transaction conflict — please retry

  Code: 08006 (CONNECTION_ERROR)
    HTTP: 503, Retryable: true
    Message: Database connection lost
  ...

=== Retry Strategy for Database Errors ===

Scenario: Serialization failure with retry

  [attempt 1] SERIALIZATION_FAILURE — retrying in 100ms
  [attempt 2] SERIALIZATION_FAILURE — retrying in 200ms
  Success on attempt 3!

Scenario: Unique violation (no retry)

  [attempt 1] Failed permanently: UNIQUE_VIOLATION
  Correctly did not retry

...
```

## Challenge

1. Build a complete error handler that maps pg errors to API responses with appropriate HTTP status codes, error codes, and user-safe messages (never exposing SQL details)
2. Implement a circuit breaker for database calls: after N consecutive connection failures, stop trying for a cooldown period
3. What is a "query queue" in the pg Pool? When all connections are busy and the queue fills up, what happens?

## Deep Dive

PostgreSQL SQLSTATE code classes:

| Class | Category | Example |
|-------|----------|---------|
| 00 | Successful completion | 00000 |
| 02 | No data | 02000 |
| 08 | Connection exception | 08006 |
| 23 | Integrity constraint | 23505 |
| 25 | Invalid transaction state | 25P02 |
| 40 | Transaction rollback | 40001 |
| 42 | Syntax error / access | 42P01 |
| 53 | Insufficient resources | 53300 |
| 57 | Operator intervention | 57014 |

The first two characters identify the class. Checking `code.startsWith("23")` catches all constraint violations.

## Common Mistakes

- Catching all database errors with a generic handler — different errors need different responses (409 vs 500 vs 503)
- Retrying non-retryable errors — retrying a unique violation forever is a bug
- Exposing raw SQL error messages to clients — they may contain table names, column names, and constraint details
- Not setting `statement_timeout` — a missing WHERE clause on a large table can run a query for minutes
