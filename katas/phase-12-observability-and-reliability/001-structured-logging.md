---
id: structured-logging
phase: 12
phase_title: Observability & Reliability
sequence: 1
title: Structured Logging
difficulty: intermediate
tags: [logging, structured, json, observability, pino]
prerequisites: [cpu-offloading-patterns]
estimated_minutes: 12
---

## Concept

Unstructured logging (plain strings) is hard to search, filter, and aggregate:

```js
// Bad: unstructured
console.log('User alice logged in from 192.168.1.1');
console.log('Error processing order 123: payment failed');
```

**Structured logging** outputs machine-readable JSON with consistent fields:

```js
// Good: structured
logger.info({ user: 'alice', ip: '192.168.1.1', action: 'login' });
logger.error({ orderId: 123, error: 'payment_failed', provider: 'stripe' });
```

**Log levels** (from most to least verbose):
- `trace` (10) — fine-grained debugging, rarely enabled
- `debug` (20) — development debugging
- `info` (30) — normal operations (requests, business events)
- `warn` (40) — something unexpected but handled
- `error` (50) — something failed
- `fatal` (60) — process is crashing

**Why structured logging matters:**
- Log aggregation tools (ELK, Datadog, CloudWatch) can parse JSON directly
- You can filter by any field: `level:error AND orderId:123`
- Consistent format across all services
- Timestamps, request IDs, and context are always present

## Key Insight

> `console.log` writes to stdout as a plain string. Structured logging writes JSON to stdout with consistent fields (timestamp, level, message, context). The difference isn't about fancy libraries — it's about making your logs queryable. In production, you'll have millions of log lines across dozens of services. The only way to find "why did order 12345 fail?" is to search structured fields, not grep through strings.

## Experiment

```js
console.log("=== Structured Logging ===\n");

// --- Build a structured logger from scratch ---

class Logger {
  constructor(options = {}) {
    this.level = options.level || "info";
    this.context = options.context || {};
    this.output = options.output || process.stdout;

    this.levels = {
      trace: 10, debug: 20, info: 30,
      warn: 40, error: 50, fatal: 60,
    };
  }

  _shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }

  _log(level, msgOrObj, extra = {}) {
    if (!this._shouldLog(level)) return;

    const entry = {
      level,
      time: new Date().toISOString(),
      ...this.context,
    };

    if (typeof msgOrObj === "string") {
      entry.msg = msgOrObj;
      Object.assign(entry, extra);
    } else {
      Object.assign(entry, msgOrObj);
    }

    // Handle Error objects
    if (entry.err instanceof Error) {
      entry.err = {
        message: entry.err.message,
        name: entry.err.name,
        stack: entry.err.stack?.split("\n").slice(0, 3).join("\n"),
      };
    }

    // For this demo, pretty print instead of raw JSON
    const { level: lvl, time, msg, ...rest } = entry;
    const restStr = Object.keys(rest).length > 0
      ? " " + JSON.stringify(rest)
      : "";
    console.log(`  [${time.slice(11, 23)}] ${lvl.toUpperCase().padEnd(5)} ${msg || ""}${restStr}`);
  }

  trace(msg, extra) { this._log("trace", msg, extra); }
  debug(msg, extra) { this._log("debug", msg, extra); }
  info(msg, extra) { this._log("info", msg, extra); }
  warn(msg, extra) { this._log("warn", msg, extra); }
  error(msg, extra) { this._log("error", msg, extra); }
  fatal(msg, extra) { this._log("fatal", msg, extra); }

  // Create a child logger with additional context
  child(context) {
    return new Logger({
      level: this.level,
      context: { ...this.context, ...context },
      output: this.output,
    });
  }
}

// --- Demo 1: Basic logging ---

console.log("--- Basic structured logging ---\n");

const logger = new Logger({ level: "debug" });

logger.info("Server starting", { port: 6001, env: "development" });
logger.debug("Loading configuration", { file: "config.json" });
logger.info("Database connected", { host: "localhost", pool: 10 });
logger.warn("Slow query detected", { query: "SELECT * FROM users", durationMs: 2500 });
logger.error("Request failed", { path: "/api/users/999", status: 404 });

// --- Demo 2: Log levels ---

console.log("\n--- Log level filtering ---\n");

console.log("  Level set to 'warn' (only warn, error, fatal):\n");

const warnLogger = new Logger({ level: "warn" });
warnLogger.debug("This is hidden");
warnLogger.info("This is hidden too");
warnLogger.warn("This is visible", { reason: "threshold exceeded" });
warnLogger.error("This is visible", { code: "TIMEOUT" });

// --- Demo 3: Child loggers (request context) ---

console.log("\n--- Child loggers (request context) ---\n");

const appLogger = new Logger({ level: "debug", context: { service: "api" } });

// Simulate request handling
function handleRequest(reqId, path) {
  const reqLogger = appLogger.child({ reqId, path });

  reqLogger.info("Request received");
  reqLogger.debug("Parsing body");

  // Simulate DB query
  const dbLogger = reqLogger.child({ component: "db" });
  dbLogger.debug("Executing query", { sql: "SELECT * FROM users WHERE id = $1" });
  dbLogger.info("Query complete", { rows: 1, durationMs: 12 });

  reqLogger.info("Response sent", { status: 200, durationMs: 45 });
}

handleRequest("req-001", "/api/users/42");
console.log();
handleRequest("req-002", "/api/orders");

// --- Demo 4: Error logging ---

console.log("\n--- Error logging ---\n");

function riskyOperation() {
  throw new Error("Connection refused");
}

try {
  riskyOperation();
} catch (err) {
  logger.error("Operation failed", {
    err,
    operation: "db_connect",
    retryIn: 5000,
  });
}

// --- Demo 5: Production JSON format ---

console.log("\n--- Production JSON format (raw) ---\n");

const prodEntries = [
  { level: "info", time: "2024-01-15T10:30:00.123Z", msg: "Request received",
    service: "api", reqId: "abc-123", method: "GET", path: "/api/users" },
  { level: "info", time: "2024-01-15T10:30:00.145Z", msg: "Response sent",
    service: "api", reqId: "abc-123", status: 200, durationMs: 22 },
  { level: "error", time: "2024-01-15T10:30:01.500Z", msg: "Database error",
    service: "api", reqId: "def-456", code: "ECONNREFUSED", retryable: true },
];

for (const entry of prodEntries) {
  console.log(`  ${JSON.stringify(entry)}`);
}

// --- Demo 6: Best practices ---

console.log("\n--- Logging best practices ---\n");

const practices = [
  ["DO", "Log at request boundaries (start/end)", "Tracks full request lifecycle"],
  ["DO", "Include request ID in every log", "Correlates logs across a request"],
  ["DO", "Log errors with stack traces", "Essential for debugging"],
  ["DO", "Use consistent field names", "Enables cross-service queries"],
  ["DON'T", "Log passwords or tokens", "Security risk"],
  ["DON'T", "Log large request/response bodies", "Performance and storage cost"],
  ["DON'T", "Use string concatenation for log data", "Breaks structured parsing"],
  ["DON'T", "Log inside tight loops", "Overwhelms log aggregation"],
];

for (const [type, practice, reason] of practices) {
  console.log(`  ${type.padEnd(7)} ${practice.padEnd(44)} ${reason}`);
}

console.log("\n--- Popular logging libraries ---\n");

const libraries = [
  ["pino", "Fastest, JSON-native, great for production"],
  ["winston", "Feature-rich, multiple transports, widely used"],
  ["bunyan", "JSON logging with CLI viewer, mature"],
  ["console", "Built-in, no deps, but limited (no levels, no structure)"],
];

for (const [lib, desc] of libraries) {
  console.log(`  ${lib.padEnd(10)} ${desc}`);
}
```

## Expected Output

```
=== Structured Logging ===

--- Basic structured logging ---

  [10:30:00.12] INFO  Server starting {"port":6001,"env":"development"}
  [10:30:00.12] DEBUG Loading configuration {"file":"config.json"}
  ...

--- Log level filtering ---

  Level set to 'warn' (only warn, error, fatal):

  [10:30:00.12] WARN  This is visible {"reason":"threshold exceeded"}
  [10:30:00.12] ERROR This is visible {"code":"TIMEOUT"}

--- Child loggers (request context) ---

  [10:30:00.12] INFO  Request received {"service":"api","reqId":"req-001","path":"/api/users/42"}
  ...
```

## Challenge

1. Build a request logging middleware that logs every request with: method, path, status code, duration, request ID, and response size
2. Implement log sampling: in production, only log 10% of `debug`-level messages but 100% of `warn` and above — to reduce volume while keeping visibility
3. Why does pino use `process.stdout.write` instead of `console.log`? What's the performance difference?

## Common Mistakes

- Using `console.log` in production — no levels, no structure, no context. Switch to a structured logger
- Logging sensitive data (passwords, tokens, PII) — scrub sensitive fields before logging
- Not including a request ID — without it, you can't correlate logs for a single request across services
- Setting log level too low in production — `debug` level in production generates enormous log volume and cost
