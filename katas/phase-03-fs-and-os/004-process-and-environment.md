---
id: process-and-environment
phase: 3
phase_title: File System & OS Interaction
sequence: 4
title: Process and Environment Variables
difficulty: beginner
tags: [process, environment, argv, stdin, stdout]
prerequisites: [os-and-system-info]
estimated_minutes: 12
---

## Concept

The `process` global is Node.js's interface to the current running process. It provides:

- **`process.env`** — environment variables (configuration, secrets, feature flags)
- **`process.argv`** — command-line arguments
- **`process.cwd()`** — current working directory
- **`process.pid`** / **`process.ppid`** — process and parent process IDs
- **`process.stdin`** / **`process.stdout`** / **`process.stderr`** — standard I/O streams
- **`process.exit(code)`** — terminate the process
- **`process.memoryUsage()`** — heap and RSS memory stats

Environment variables are the standard way to configure Node.js applications. They separate configuration from code — the same code runs in development, staging, and production with different env vars.

## Key Insight

> Environment variables are how production systems are configured. Never hardcode database URLs, API keys, or feature flags. Read them from `process.env` and fail fast if required ones are missing.

## Experiment

```js
console.log("=== Process Identity ===\n");
console.log("  PID:", process.pid);
console.log("  Parent PID:", process.ppid);
console.log("  Node version:", process.version);
console.log("  CWD:", process.cwd());

console.log("\n=== Command-line Arguments ===\n");
console.log("  Raw argv:", process.argv);
console.log("  Node binary:", process.argv[0]);
console.log("  Script path:", process.argv[1]);
console.log("  User args:", process.argv.slice(2));

console.log("\n=== Environment Variables ===\n");
// Common env vars
console.log("  PATH entries:", (process.env.PATH || "").split(":").length);
console.log("  HOME:", process.env.HOME);
console.log("  USER:", process.env.USER);
console.log("  NODE_ENV:", process.env.NODE_ENV || "(not set)");

// Pattern: config from env with defaults
const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  debug: process.env.DEBUG === "true",
};
console.log("  App config:", config);

console.log("\n=== Memory Usage ===\n");
const mem = process.memoryUsage();
for (const [key, bytes] of Object.entries(mem)) {
  console.log(`  ${key}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

console.log("\n=== CPU Usage ===\n");
const cpu = process.cpuUsage();
console.log(`  User: ${(cpu.user / 1000).toFixed(1)}ms`);
console.log(`  System: ${(cpu.system / 1000).toFixed(1)}ms`);

console.log("\n=== Exit Handling ===\n");
// process.on('exit') runs synchronously before the process exits
process.on("exit", (code) => {
  console.log(`  Process exiting with code: ${code}`);
});

console.log("  Exit handler registered (will fire at end)");
```

## Expected Output

```
=== Process Identity ===

  PID: <number>
  Parent PID: <number>
  Node version: v22.x.x
  CWD: <path>

=== Command-line Arguments ===

  Raw argv: [ '<node path>', '<script>', ... ]
  Node binary: <node path>
  Script path: <script path>
  User args: []

=== Environment Variables ===

  PATH entries: <number>
  HOME: /home/<user>
  USER: <username>
  NODE_ENV: (not set)
  App config: { port: 3000, host: '0.0.0.0', debug: false }

=== Memory Usage ===

  rss: <number> MB
  heapTotal: <number> MB
  heapUsed: <number> MB
  external: <number> MB
  arrayBuffers: <number> MB

=== CPU Usage ===

  User: <number>ms
  System: <number>ms

=== Exit Handling ===

  Exit handler registered (will fire at end)
  Process exiting with code: 0
```

## Challenge

1. Parse command-line arguments into a key-value object: `node script.js --port 8080 --debug` → `{ port: "8080", debug: true }`
2. Write a config loader that reads required env vars and throws a clear error listing all missing ones
3. Compare `process.memoryUsage().heapUsed` before and after creating a large array (1 million objects)

## Deep Dive

Memory usage fields:
- **`rss`** (Resident Set Size) — total memory allocated by the OS for this process
- **`heapTotal`** — V8's total heap size
- **`heapUsed`** — V8's used heap size (your objects live here)
- **`external`** — memory used by C++ objects bound to JS (Buffers, etc.)
- **`arrayBuffers`** — memory for `ArrayBuffer` and `SharedArrayBuffer`

If `heapUsed` keeps growing over time without plateauing, you have a memory leak.

## Common Mistakes

- Accessing `process.env.PORT` without parsing it to a number — env vars are always strings
- Using `process.exit()` in library code — it prevents cleanup. Throw an error instead and let the caller decide
- Not registering `process.on('uncaughtException')` — unhandled errors crash the process silently
- Storing secrets in `process.argv` — they're visible to anyone running `ps` on the system. Use env vars instead
