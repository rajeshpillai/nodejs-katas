---
id: child-process-basics
phase: 11
phase_title: Child Processes & Worker Threads
sequence: 1
title: Child Process Basics
difficulty: intermediate
tags: [child_process, exec, execFile, spawn, fork, processes]
prerequisites: [secure-random]
estimated_minutes: 15
---

## Concept

Node.js is single-threaded, but it can launch **child processes** to run external commands, scripts, or other Node.js programs. The `child_process` module provides four methods:

| Method | Shell | Buffered | Use Case |
|--------|-------|----------|----------|
| `exec` | Yes | Yes | Run shell commands, get output as string |
| `execFile` | No | Yes | Run a binary directly, safer than exec |
| `spawn` | No | No (stream) | Long-running processes, large output |
| `fork` | No | No (IPC) | Run another Node.js script with messaging |

**exec** — Runs a command in a shell, buffers all output, returns when done:
```js
import { exec } from 'node:child_process';
exec('ls -la', (err, stdout, stderr) => {
  console.log(stdout);
});
```

**spawn** — Launches a process, returns streams immediately:
```js
import { spawn } from 'node:child_process';
const child = spawn('ls', ['-la']);
child.stdout.on('data', chunk => console.log(chunk.toString()));
```

The key difference: `exec` waits for the process to finish and buffers output in memory. `spawn` streams output as it's produced — essential for large outputs or long-running processes.

## Key Insight

> `exec` runs commands through the shell (`/bin/sh -c`), which means shell features like pipes, redirects, and globbing work — but it also means shell injection is possible if you include user input. `spawn` and `execFile` bypass the shell entirely, passing arguments as an array, making injection structurally impossible. Always prefer `spawn`/`execFile` when you don't need shell features.

## Experiment

```js
import { exec, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

console.log("=== Child Process Basics ===\n");

// --- Demo 1: exec (shell command, buffered) ---

console.log("--- exec: run shell commands ---\n");

const { stdout: lsOutput } = await execAsync("ls -1 /tmp | head -5");
console.log("  ls /tmp (first 5):");
for (const line of lsOutput.trim().split("\n")) {
  console.log(`    ${line}`);
}

// Shell features work with exec
const { stdout: pipeOutput } = await execAsync("echo 'hello world' | tr a-z A-Z");
console.log(`\n  Shell pipe: ${pipeOutput.trim()}`);

// Environment variables work
const { stdout: envOutput } = await execAsync("echo $HOME");
console.log(`  Shell env: HOME=${envOutput.trim()}`);

// --- Demo 2: execFile (no shell, safer) ---

console.log("\n--- execFile: run binaries directly (no shell) ---\n");

const { stdout: nodeVersion } = await execFileAsync("node", ["--version"]);
console.log(`  Node version: ${nodeVersion.trim()}`);

const { stdout: dateOutput } = await execFileAsync("date", ["+%Y-%m-%d %H:%M:%S"]);
console.log(`  Date: ${dateOutput.trim()}`);

// --- Demo 3: exec vs execFile security ---

console.log("\n--- Shell injection risk with exec ---\n");

const userInput = "hello; echo INJECTED";

// DANGEROUS: exec with user input
const { stdout: unsafeOutput } = await execAsync(`echo ${userInput}`);
console.log(`  exec("echo ${userInput}"):`);
console.log(`    Output: ${unsafeOutput.trim()}`);
console.log(`    ⚠ "INJECTED" was executed as a separate command!\n`);

// SAFE: execFile with user input
const { stdout: safeOutput } = await execFileAsync("echo", [userInput]);
console.log(`  execFile("echo", ["${userInput}"]):`);
console.log(`    Output: ${safeOutput.trim()}`);
console.log(`    ✓ Entire string treated as one argument\n`);

// --- Demo 4: spawn (streaming) ---

console.log("--- spawn: streaming output ---\n");

function spawnAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    const stdout = [];
    const stderr = [];

    child.stdout?.on("data", chunk => stdout.push(chunk));
    child.stderr?.on("data", chunk => stderr.push(chunk));

    child.on("error", reject);
    child.on("close", code => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}

// Spawn a process and collect streamed output
const result = await spawnAsync("node", ["-e", "for(let i=0;i<5;i++) console.log('line',i)"]);
console.log(`  spawn node -e (streamed output):`);
console.log(`    Exit code: ${result.code}`);
for (const line of result.stdout.trim().split("\n")) {
  console.log(`    ${line}`);
}

// --- Demo 5: spawn with stdin ---

console.log("\n--- spawn with stdin pipe ---\n");

const child = spawn("node", ["-e", `
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    const nums = data.trim().split('\\n').map(Number);
    console.log('Sum:', nums.reduce((a,b) => a+b, 0));
  });
`]);

// Write data to child's stdin
child.stdin.write("10\n");
child.stdin.write("20\n");
child.stdin.write("30\n");
child.stdin.end();

const stdinResult = await new Promise(resolve => {
  let output = "";
  child.stdout.on("data", chunk => output += chunk);
  child.on("close", code => resolve({ code, output: output.trim() }));
});

console.log(`  Sent: 10, 20, 30 via stdin`);
console.log(`  Received: ${stdinResult.output}`);
console.log(`  Exit code: ${stdinResult.code}`);

// --- Demo 6: Error handling ---

console.log("\n--- Error handling ---\n");

// Non-zero exit code
try {
  await execAsync("node -e 'process.exit(1)'");
} catch (err) {
  console.log(`  Non-zero exit: code=${err.code}, killed=${err.killed}`);
}

// Command not found
try {
  await execAsync("nonexistent_command_xyz");
} catch (err) {
  console.log(`  Not found: ${err.message.split("\n")[0]}`);
}

// Timeout
try {
  await execAsync("sleep 10", { timeout: 100 });
} catch (err) {
  console.log(`  Timeout: killed=${err.killed}, signal=${err.signal}`);
}

// --- Demo 7: Options summary ---

console.log("\n--- spawn/exec options ---\n");

const options = [
  ["cwd", "Working directory for the child process"],
  ["env", "Environment variables (replaces process.env)"],
  ["timeout", "Kill after N milliseconds (exec only)"],
  ["maxBuffer", "Max stdout/stderr buffer size (exec, default 1MB)"],
  ["shell", "Use shell (spawn: false by default)"],
  ["stdio", "Configure stdin/stdout/stderr streams"],
  ["signal", "AbortSignal to kill the process"],
];

for (const [opt, desc] of options) {
  console.log(`  ${opt.padEnd(12)} ${desc}`);
}
```

## Expected Output

```
=== Child Process Basics ===

--- exec: run shell commands ---

  ls /tmp (first 5):
    <files>

  Shell pipe: HELLO WORLD
  Shell env: HOME=/home/...

--- execFile: run binaries directly (no shell) ---

  Node version: v22.x.x
  Date: 2024-...

--- Shell injection risk with exec ---

  exec("echo hello; echo INJECTED"):
    Output: hello
    INJECTED
    ⚠ "INJECTED" was executed as a separate command!

  execFile("echo", ["hello; echo INJECTED"]):
    Output: hello; echo INJECTED
    ✓ Entire string treated as one argument
  ...
```

## Challenge

1. Build a `safeExec` wrapper that only allows a whitelist of commands (e.g., `["node", "git", "ls"]`) and always uses `execFile` to prevent shell injection
2. Implement process output streaming that sends stdout/stderr to the client line by line via Server-Sent Events
3. What happens if a child process writes more output than `maxBuffer`? What error do you get, and why does `spawn` not have this problem?

## Common Mistakes

- Using `exec` with user input — shell injection vulnerability, same class as SQL injection
- Not handling the `error` event on spawn — if the binary doesn't exist, the error event fires (not close)
- Forgetting to handle stderr — many programs write to stderr even on success (warnings, progress)
- Using `exec` for large outputs — `maxBuffer` defaults to 1MB; use `spawn` for unbounded output
