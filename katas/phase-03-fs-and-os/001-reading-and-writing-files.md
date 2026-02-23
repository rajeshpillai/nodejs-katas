---
id: reading-and-writing-files
phase: 3
phase_title: File System & OS Interaction
sequence: 1
title: Reading and Writing Files
difficulty: beginner
tags: [fs, file-system, async, sync]
prerequisites: [async-await]
estimated_minutes: 12
---

## Concept

The `fs` module is Node.js's interface to the file system. It provides three APIs:

1. **Callback API** — `fs.readFile(path, callback)` — the original Node.js pattern
2. **Promise API** — `fs.promises.readFile(path)` or `import { readFile } from "fs/promises"` — modern, works with async/await
3. **Synchronous API** — `fs.readFileSync(path)` — blocks the event loop, use only at startup

The Promise API is what you should use in almost all cases. The sync API blocks the entire event loop — acceptable during process initialization, but never in a server request handler.

File operations go through the libuv thread pool (default 4 threads). This means concurrent file operations beyond 4 will queue up.

## Key Insight

> Always use `fs/promises` for file operations in running applications. The sync API (`readFileSync`) blocks the event loop — use it only at startup for loading config. The callback API works but async/await is cleaner.

## Experiment

```js
import { writeFile, readFile, appendFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const filePath = join(tmpdir(), `kata-${Date.now()}.txt`);

// Write a file
await writeFile(filePath, "Hello, Node.js file system!\n");
console.log("1. File written:", filePath);

// Read it back
const content = await readFile(filePath, "utf-8");
console.log("2. File content:", JSON.stringify(content));

// Append to it
await appendFile(filePath, "Second line.\nThird line.\n");

// Read again
const updated = await readFile(filePath, "utf-8");
console.log("3. After append:");
updated.split("\n").forEach((line, i) => {
  if (line) console.log(`   Line ${i + 1}: ${line}`);
});

// Get file metadata
const info = await stat(filePath);
console.log("4. File stats:");
console.log(`   Size: ${info.size} bytes`);
console.log(`   Created: ${info.birthtime.toISOString()}`);
console.log(`   Is file: ${info.isFile()}`);
console.log(`   Is directory: ${info.isDirectory()}`);

// Read as Buffer (binary)
const buffer = await readFile(filePath);
console.log("5. As buffer:", buffer.constructor.name, `(${buffer.length} bytes)`);

// Cleanup
import { unlink } from "fs/promises";
await unlink(filePath);
console.log("6. File deleted");
```

## Expected Output

```
1. File written: /tmp/kata-<timestamp>.txt
2. File content: "Hello, Node.js file system!\n"
3. After append:
   Line 1: Hello, Node.js file system!
   Line 2: Second line.
   Line 3: Third line.
4. File stats:
   Size: <number> bytes
   Created: <ISO date>
   Is file: true
   Is directory: false
5. As buffer: Buffer (<number> bytes)
6. File deleted
```

## Challenge

1. Write a JSON object to a file with `JSON.stringify(data, null, 2)`, read it back and parse it
2. Try reading a file that doesn't exist — what error do you get? Handle it with `try/catch`
3. Use `readFile` without the `"utf-8"` encoding — what type is the result? Why?

## Common Mistakes

- Using `readFileSync` in a server request handler — blocks all other requests while the file is read
- Forgetting the `"utf-8"` encoding in `readFile` — returns a Buffer instead of a string
- Not handling `ENOENT` (file not found) errors — always wrap file operations in `try/catch`
- Writing sensitive data without proper file permissions — use the `mode` option: `writeFile(path, data, { mode: 0o600 })`
