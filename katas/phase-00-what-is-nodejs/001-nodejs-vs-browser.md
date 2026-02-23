---
id: nodejs-vs-browser
phase: 0
phase_title: What is Node.js Really?
sequence: 1
title: Node.js vs the Browser
difficulty: beginner
tags: [runtime, v8, globals]
prerequisites: []
estimated_minutes: 10
---

## Concept

JavaScript runs in two very different environments: the **browser** and **Node.js**. Both use the V8 engine to execute JavaScript, but the host APIs they expose are completely different.

In a browser, you get `window`, `document`, `fetch`, `localStorage` — APIs for rendering web pages.

In Node.js, you get `process`, `fs`, `net`, `http`, `crypto` — APIs for building servers and interacting with the operating system.

The globals tell you which environment you're in. If `process` exists, you're in Node.js. If `window` exists, you're in a browser.

## Key Insight

> Node.js is not "JavaScript on a server." It is a completely different runtime environment that shares the same language engine (V8) but exposes operating system capabilities instead of browser APIs.

## Experiment

```js
// What environment are we in?
console.log("Node.js version:", process.version);
console.log("Platform:", process.platform);
console.log("Architecture:", process.arch);
console.log("Process ID:", process.pid);

// Memory usage — a system-level API that doesn't exist in browsers
const mem = process.memoryUsage();
console.log("Heap used:", Math.round(mem.heapUsed / 1024), "KB");

// Check which globals exist
console.log("\nGlobal check:");
console.log("  typeof process:", typeof process);
console.log("  typeof window:", typeof window);
console.log("  typeof document:", typeof document);
console.log("  typeof globalThis:", typeof globalThis);
```

## Expected Output

```
Node.js version: v22.x.x
Platform: linux
Architecture: x64
Process ID: <number>
Heap used: <number> KB

Global check:
  typeof process: object
  typeof window: undefined
  typeof document: undefined
  typeof globalThis: object
```

## Challenge

Extend the experiment:
1. Print the current working directory using `process.cwd()`
2. Print all available CPU cores using `import { cpus } from "os"`
3. Print the command-line arguments with `process.argv`

## Common Mistakes

- Assuming `window` or `document` exist in Node.js — they don't
- Thinking Node.js is a browser without a UI — it's a completely different runtime
- Using browser-specific APIs (`localStorage`, `XMLHttpRequest`) in Node.js code
