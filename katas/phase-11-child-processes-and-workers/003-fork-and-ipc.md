---
id: fork-and-ipc
phase: 11
phase_title: Child Processes & Worker Threads
sequence: 3
title: fork and Inter-Process Communication
difficulty: intermediate
tags: [child_process, fork, ipc, message-passing, processes]
prerequisites: [spawn-and-streaming]
estimated_minutes: 15
---

## Concept

`fork()` is a specialized `spawn` for running Node.js scripts. It automatically sets up an **IPC channel** — a bidirectional message-passing link between parent and child:

```js
// parent.js
import { fork } from 'node:child_process';
const child = fork('./worker.js');

child.send({ task: 'process', data: [1, 2, 3] });
child.on('message', result => console.log('Result:', result));

// worker.js
process.on('message', msg => {
  const result = msg.data.reduce((a, b) => a + b, 0);
  process.send({ sum: result });
});
```

**IPC (Inter-Process Communication)** uses the OS pipe mechanism to serialize messages as JSON between processes. This means:

- Messages must be JSON-serializable (no functions, no circular references)
- Each process has its own V8 heap — no shared memory
- Messages are copied, not shared (unlike worker threads)
- IPC overhead is microseconds per message

**fork vs spawn:**
| Feature | `spawn` | `fork` |
|---------|---------|--------|
| Runs | Any command | Node.js scripts only |
| IPC | Manual | Automatic (`send`/`on('message')`) |
| Shell | Optional | Never |
| Memory | Process-specific | Full V8 per child |

## Key Insight

> `fork()` creates a completely independent Node.js process with its own V8 instance, event loop, and memory. Communication happens via structured message passing over an IPC channel. This is true process isolation — a crash in the child doesn't crash the parent, a memory leak in the child doesn't affect the parent, and an infinite loop in the child doesn't block the parent's event loop.

## Experiment

```js
import { fork, spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

console.log("=== fork and IPC ===\n");

// Helper to create a temporary worker script
function createWorkerScript(code) {
  const path = join(tmpdir(), `worker_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(path, code);
  return path;
}

// --- Demo 1: Basic message passing ---

console.log("--- Basic IPC message passing ---\n");

const echoWorkerPath = createWorkerScript(`
  process.on('message', (msg) => {
    process.send({ echo: msg, pid: process.pid });
  });
`);

const echoWorker = fork(echoWorkerPath);

const echoResult = await new Promise(resolve => {
  echoWorker.on("message", resolve);
  echoWorker.send({ hello: "world", timestamp: Date.now() });
});

console.log(`  Parent PID: ${process.pid}`);
console.log(`  Child PID:  ${echoResult.pid}`);
console.log(`  Message:    ${JSON.stringify(echoResult.echo)}`);

echoWorker.kill();
unlinkSync(echoWorkerPath);

// --- Demo 2: CPU-intensive work offloading ---

console.log("\n--- Offloading CPU work to child process ---\n");

const computeWorkerPath = createWorkerScript(`
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }

  process.on('message', (msg) => {
    const start = performance.now();
    const result = fibonacci(msg.n);
    const elapsed = performance.now() - start;
    process.send({ n: msg.n, result, elapsed });
  });
`);

// Run fibonacci in child process (doesn't block parent)
const computeWorker = fork(computeWorkerPath);

console.log("  Computing fibonacci(35) in child process...");
console.log("  Parent event loop is NOT blocked!\n");

const parentStart = performance.now();

// Parent can do other work while child computes
const fibPromise = new Promise(resolve => {
  computeWorker.on("message", resolve);
  computeWorker.send({ n: 35 });
});

// Simulate parent doing work concurrently
let parentTicks = 0;
const tickInterval = setInterval(() => parentTicks++, 10);

const fibResult = await fibPromise;
clearInterval(tickInterval);
const parentElapsed = performance.now() - parentStart;

console.log(`  Child result: fib(${fibResult.n}) = ${fibResult.result}`);
console.log(`  Child time:   ${fibResult.elapsed.toFixed(0)}ms`);
console.log(`  Parent ticks: ${parentTicks} (parent stayed responsive!)`);
console.log(`  Total time:   ${parentElapsed.toFixed(0)}ms\n`);

computeWorker.kill();
unlinkSync(computeWorkerPath);

// --- Demo 3: Request/response pattern ---

console.log("--- Request/response pattern ---\n");

const rpcWorkerPath = createWorkerScript(`
  const handlers = {
    add: ({ a, b }) => a + b,
    multiply: ({ a, b }) => a * b,
    uppercase: ({ text }) => text.toUpperCase(),
    reverse: ({ text }) => text.split('').reverse().join(''),
  };

  process.on('message', ({ id, method, params }) => {
    try {
      const handler = handlers[method];
      if (!handler) throw new Error('Unknown method: ' + method);
      const result = handler(params);
      process.send({ id, result });
    } catch (err) {
      process.send({ id, error: err.message });
    }
  });
`);

const rpcWorker = fork(rpcWorkerPath);
let rpcId = 0;
const pending = new Map();

rpcWorker.on("message", ({ id, result, error }) => {
  const resolver = pending.get(id);
  if (resolver) {
    pending.delete(id);
    if (error) resolver.reject(new Error(error));
    else resolver.resolve(result);
  }
});

function rpcCall(method, params) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    rpcWorker.send({ id, method, params });
  });
}

// Make multiple RPC calls
const results = await Promise.all([
  rpcCall("add", { a: 10, b: 20 }),
  rpcCall("multiply", { a: 6, b: 7 }),
  rpcCall("uppercase", { text: "hello world" }),
  rpcCall("reverse", { text: "Node.js" }),
]);

console.log(`  add(10, 20) = ${results[0]}`);
console.log(`  multiply(6, 7) = ${results[1]}`);
console.log(`  uppercase("hello world") = ${results[2]}`);
console.log(`  reverse("Node.js") = ${results[3]}`);

// Error handling
try {
  await rpcCall("unknown_method", {});
} catch (err) {
  console.log(`  unknown_method → Error: ${err.message}`);
}

rpcWorker.kill();
unlinkSync(rpcWorkerPath);

// --- Demo 4: Child process lifecycle ---

console.log("\n--- Child process lifecycle events ---\n");

const lifecycleWorkerPath = createWorkerScript(`
  console.log('  [child] started (PID: ' + process.pid + ')');
  process.on('message', (msg) => {
    if (msg === 'exit') {
      console.log('  [child] exiting gracefully');
      process.exit(0);
    }
  });
  process.on('disconnect', () => {
    console.log('  [child] IPC disconnected');
  });
`);

const lifecycleWorker = fork(lifecycleWorkerPath, [], {
  stdio: ["pipe", "inherit", "inherit", "ipc"],
});

console.log(`  [parent] forked child (PID: ${lifecycleWorker.pid})`);
console.log(`  [parent] child.connected: ${lifecycleWorker.connected}`);

lifecycleWorker.send("exit");

const exitInfo = await new Promise(resolve => {
  lifecycleWorker.on("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

console.log(`  [parent] child exited: code=${exitInfo.code}, signal=${exitInfo.signal}`);
console.log(`  [parent] child.connected: ${lifecycleWorker.connected}`);

unlinkSync(lifecycleWorkerPath);

// --- Demo 5: When to use fork ---

console.log("\n=== When to Use fork ===\n");

const useCases = [
  ["Use fork", "CPU-heavy computation (image processing, parsing, crypto)"],
  ["Use fork", "Isolated execution (running untrusted code safely)"],
  ["Use fork", "Crash isolation (child crash doesn't kill parent)"],
  ["Use spawn", "Running non-Node commands (git, ffmpeg, etc.)"],
  ["Use worker_threads", "Sharing memory between threads (SharedArrayBuffer)"],
  ["Use worker_threads", "Lower overhead than fork (no V8 copy)"],
];

for (const [use, desc] of useCases) {
  console.log(`  ${use.padEnd(22)} ${desc}`);
}
```

## Expected Output

```
=== fork and IPC ===

--- Basic IPC message passing ---

  Parent PID: <pid>
  Child PID:  <pid>
  Message:    {"hello":"world","timestamp":<ts>}

--- Offloading CPU work to child process ---

  Computing fibonacci(35) in child process...
  Parent event loop is NOT blocked!

  Child result: fib(35) = 9227465
  Child time:   ~100ms
  Parent ticks: >5 (parent stayed responsive!)

--- Request/response pattern ---

  add(10, 20) = 30
  multiply(6, 7) = 42
  uppercase("hello world") = HELLO WORLD
  reverse("Node.js") = sj.edoN
  unknown_method → Error: Unknown method: unknown_method
  ...
```

## Challenge

1. Build a process-based task queue: parent distributes tasks to a pool of forked workers, collecting results as they complete. Implement round-robin and least-busy routing strategies
2. Implement graceful shutdown for forked workers: send a "drain" message, wait for in-flight work to complete, then exit
3. What happens if you try to `process.send()` a value that isn't JSON-serializable (e.g., a function, a Buffer, a circular reference)? Test each case

## Common Mistakes

- Forking a new process per request — fork is expensive (~30ms + memory). Use a process pool and reuse workers
- Sending large payloads via IPC — messages are serialized as JSON and copied; for large data, use files or shared memory
- Not handling worker crashes — listen for the `exit` event and restart workers that crash unexpectedly
- Forgetting to call `worker.disconnect()` or `worker.kill()` — orphaned workers keep running after the parent exits
