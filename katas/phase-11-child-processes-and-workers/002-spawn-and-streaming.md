---
id: spawn-and-streaming
phase: 11
phase_title: Child Processes & Worker Threads
sequence: 2
title: spawn and Streaming I/O
difficulty: intermediate
tags: [child_process, spawn, streams, stdio, pipes]
prerequisites: [child-process-basics]
estimated_minutes: 15
---

## Concept

`spawn` returns a `ChildProcess` object with `.stdin`, `.stdout`, and `.stderr` — all standard Node.js streams. This lets you pipe data between processes, process output incrementally, and handle large outputs without buffering everything in memory.

**stdio configuration:**
```js
const child = spawn('cmd', ['args'], {
  stdio: ['pipe', 'pipe', 'pipe']  // default: [stdin, stdout, stderr]
  //       │        │        │
  //       │        │        └─ child.stderr (Readable)
  //       │        └────────── child.stdout (Readable)
  //       └─────────────────── child.stdin (Writable)
});
```

**stdio options per fd:**
- `'pipe'` — create a pipe (default), accessible via `child.stdin`/`child.stdout`/`child.stderr`
- `'inherit'` — share the parent's fd (child writes directly to terminal)
- `'ignore'` — discard (`/dev/null`)
- An existing fd number or Stream object

**Process chaining (like Unix pipes):**
```js
// Equivalent to: cat file.txt | grep "error" | wc -l
const cat = spawn('cat', ['file.txt']);
const grep = spawn('grep', ['error']);
const wc = spawn('wc', ['-l']);

cat.stdout.pipe(grep.stdin);
grep.stdout.pipe(wc.stdin);
```

## Key Insight

> spawn's streaming I/O means you can process the output of a command that produces 10GB of data without using more than a few KB of memory. The child's stdout is a Readable stream with full backpressure support — if your Node.js code processes data slowly, the OS pipe buffer fills up, and the child process blocks until you catch up. This is the same backpressure mechanism that makes Node.js streams efficient.

## Experiment

```js
import { spawn } from "node:child_process";

console.log("=== spawn and Streaming I/O ===\n");

// --- Demo 1: Stream stdout line by line ---

console.log("--- Streaming stdout line by line ---\n");

function spawnLines(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    const lines = [];
    let buffer = "";

    child.stdout.on("data", chunk => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop(); // Keep incomplete line in buffer
      for (const line of parts) {
        lines.push(line);
        if (options.onLine) options.onLine(line);
      }
    });

    child.on("error", reject);
    child.on("close", code => {
      if (buffer) lines.push(buffer); // Flush remaining
      resolve({ code, lines });
    });
  });
}

const result = await spawnLines("node", ["-e", `
  for (let i = 1; i <= 8; i++) {
    console.log(\`Line \${i}: ${"x".repeat(10)}\`);
  }
`], {
  onLine: (line) => process.stdout.write(`  → ${line}\n`),
});

console.log(`\n  Total lines: ${result.lines.length}, exit code: ${result.code}\n`);

// --- Demo 2: stdio configurations ---

console.log("--- stdio configurations ---\n");

// 'inherit' — child writes directly to parent's terminal
console.log("  stdio: 'inherit' — child writes to parent terminal:");
const inherit = spawn("node", ["-e", "console.log('  [child] direct to terminal')"], {
  stdio: "inherit",
});
await new Promise(resolve => inherit.on("close", resolve));

// 'pipe' — capture output
console.log("\n  stdio: 'pipe' — capture in parent:");
const piped = spawn("node", ["-e", "console.log('captured!')"]);
let captured = "";
piped.stdout.on("data", chunk => captured += chunk);
await new Promise(resolve => piped.on("close", resolve));
console.log(`  Captured: "${captured.trim()}"\n`);

// 'ignore' — discard output
console.log("  stdio: 'ignore' — discard output:");
const ignored = spawn("node", ["-e", "console.log('this is discarded')"], {
  stdio: ["ignore", "ignore", "ignore"],
});
await new Promise(resolve => ignored.on("close", resolve));
console.log("  (output discarded, no crash)\n");

// --- Demo 3: Process piping (Unix-style) ---

console.log("--- Process piping ---\n");

// Simulate: echo "line1\nline2\nline3\nline2\nline1" | sort | uniq -c | sort -rn
function pipeProcesses(cmds) {
  return new Promise((resolve, reject) => {
    const children = [];
    let lastChild;

    for (let i = 0; i < cmds.length; i++) {
      const [cmd, ...args] = cmds[i];
      const child = spawn(cmd, args, {
        stdio: [
          i === 0 ? "pipe" : "pipe", // stdin
          "pipe",                      // stdout
          "inherit",                   // stderr to terminal
        ],
      });
      children.push(child);

      // Pipe previous stdout to this stdin
      if (lastChild) {
        lastChild.stdout.pipe(child.stdin);
      }

      lastChild = child;
    }

    // Collect output from the last process
    let output = "";
    lastChild.stdout.on("data", chunk => output += chunk);
    lastChild.on("close", code => resolve({ code, output: output.trim() }));
    lastChild.on("error", reject);

    return children[0]; // Return first process (to write to stdin)
  });
}

// Write data to the first process in the pipe
const input = "banana\napple\ncherry\napple\nbanana\napple\ndate\n";
const pipeResult = await new Promise((resolve, reject) => {
  const first = spawn("sort", [], { stdio: ["pipe", "pipe", "inherit"] });
  const second = spawn("uniq", ["-c"], { stdio: ["pipe", "pipe", "inherit"] });
  const third = spawn("sort", ["-rn"], { stdio: ["pipe", "pipe", "inherit"] });

  first.stdout.pipe(second.stdin);
  second.stdout.pipe(third.stdin);

  let output = "";
  third.stdout.on("data", chunk => output += chunk);
  third.on("close", () => resolve(output.trim()));

  first.stdin.write(input);
  first.stdin.end();
});

console.log("  Input: banana, apple, cherry, apple, banana, apple, date");
console.log("  Pipeline: sort | uniq -c | sort -rn");
console.log("  Output:");
for (const line of pipeResult.split("\n")) {
  console.log(`    ${line.trim()}`);
}

// --- Demo 4: Streaming large output ---

console.log("\n--- Streaming large output (memory efficient) ---\n");

const largeChild = spawn("node", ["-e", `
  // Generate 1000 lines of output
  for (let i = 0; i < 1000; i++) {
    console.log(JSON.stringify({ id: i, data: "x".repeat(100) }));
  }
`]);

let lineCount = 0;
let byteCount = 0;
let lineBuffer = "";

await new Promise((resolve) => {
  largeChild.stdout.on("data", chunk => {
    byteCount += chunk.length;
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop();
    lineCount += lines.length;
  });

  largeChild.on("close", () => {
    if (lineBuffer) lineCount++;
    resolve();
  });
});

console.log(`  Processed ${lineCount} lines (${(byteCount / 1024).toFixed(1)} KB)`);
console.log(`  Memory: only buffered one chunk at a time (not entire output)\n`);

// --- Demo 5: Controlling the child process ---

console.log("--- Process control ---\n");

// Kill a long-running process
const longRunning = spawn("node", ["-e", "setInterval(() => {}, 1000)"]);
console.log(`  Started long-running process (PID: ${longRunning.pid})`);

setTimeout(() => {
  longRunning.kill("SIGTERM");
}, 50);

const exitInfo = await new Promise(resolve => {
  longRunning.on("close", (code, signal) => resolve({ code, signal }));
});
console.log(`  Killed: code=${exitInfo.code}, signal=${exitInfo.signal}`);

// AbortController
console.log("\n  AbortController:");
const ac = new AbortController();
const abortChild = spawn("sleep", ["10"], { signal: ac.signal });
setTimeout(() => ac.abort(), 50);

try {
  await new Promise((resolve, reject) => {
    abortChild.on("close", resolve);
    abortChild.on("error", reject);
  });
} catch (err) {
  console.log(`  Aborted: ${err.message}`);
}
```

## Expected Output

```
=== spawn and Streaming I/O ===

--- Streaming stdout line by line ---

  → Line 1: xxxxxxxxxx
  → Line 2: xxxxxxxxxx
  ...
  → Line 8: xxxxxxxxxx

  Total lines: 8, exit code: 0

--- stdio configurations ---

  stdio: 'inherit' — child writes to parent terminal:
  [child] direct to terminal

  stdio: 'pipe' — capture in parent:
  Captured: "captured!"

--- Process piping ---

  Input: banana, apple, cherry, apple, banana, apple, date
  Pipeline: sort | uniq -c | sort -rn
  Output:
    3 apple
    2 banana
    1 cherry
    1 date
  ...
```

## Challenge

1. Build a `ProcessPool` that runs up to N child processes concurrently, queuing additional work until a slot opens — useful for CPU-bound batch processing
2. Implement a streaming log processor: spawn `tail -f /var/log/syslog`, parse each line, and emit structured events for lines matching certain patterns
3. What's the maximum size of the OS pipe buffer? What happens when both the parent and child try to write to each other simultaneously without reading? (Hint: deadlock)

## Common Mistakes

- Not consuming stdout/stderr — if the pipe buffer fills up, the child process blocks forever (deadlock)
- Using `exec` for large outputs — it buffers everything; `maxBuffer` defaults to 1MB
- Forgetting to handle the `error` event — `spawn` emits `error` if the command doesn't exist (before `close`)
- Piping between processes without error handling — if one process in a pipe chain fails, you need to clean up the others
