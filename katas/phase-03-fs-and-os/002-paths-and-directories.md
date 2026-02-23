---
id: paths-and-directories
phase: 3
phase_title: File System & OS Interaction
sequence: 2
title: Paths and Directories
difficulty: beginner
tags: [path, fs, directories, cross-platform]
prerequisites: [reading-and-writing-files]
estimated_minutes: 10
---

## Concept

The `path` module provides utilities for working with file and directory paths. It handles platform differences automatically — `/` on Linux/macOS, `\` on Windows.

**Never build paths with string concatenation.** Use `path.join()` or `path.resolve()`:

- `path.join(a, b, c)` — joins segments with the platform separator, normalizing `..` and `.`
- `path.resolve(a, b)` — resolves to an absolute path from right to left
- `path.basename(p)` — extracts the filename: `"/home/user/file.txt"` → `"file.txt"`
- `path.dirname(p)` — extracts the directory: `"/home/user/file.txt"` → `"/home/user"`
- `path.extname(p)` — extracts the extension: `"file.txt"` → `".txt"`
- `path.parse(p)` — returns `{ root, dir, base, name, ext }`

For ESM modules (`import`), `__dirname` and `__filename` don't exist. Use `import.meta.url` instead.

## Key Insight

> Never concatenate paths with `+` or template literals. Use `path.join()` — it handles platform separators, normalizes `..` segments, and prevents double-slash bugs. Cross-platform correctness is free if you use the `path` module.

## Experiment

```js
import { join, resolve, basename, dirname, extname, parse, sep } from "path";
import { mkdir, readdir, rmdir } from "fs/promises";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

console.log("=== Path operations ===\n");

// Platform separator
console.log("Platform separator:", JSON.stringify(sep));

// join vs string concatenation
const bad = "/home/user" + "/" + "docs" + "/" + "file.txt";
const good = join("/home", "user", "docs", "file.txt");
console.log("String concat:", bad);
console.log("path.join:    ", good);

// join normalizes .. and .
const normalized = join("/home/user", "docs", "..", "images", "./photo.png");
console.log("Normalized:   ", normalized);

// resolve builds absolute paths
const absolute = resolve("src", "utils", "helper.js");
console.log("Resolved:     ", absolute);

// Decompose a path
const filePath = "/home/user/project/src/index.js";
console.log("\nDecomposing:", filePath);
console.log("  basename:", basename(filePath));
console.log("  dirname: ", dirname(filePath));
console.log("  extname: ", extname(filePath));
console.log("  parse:   ", parse(filePath));

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.log("\nESM equivalents:");
console.log("  __filename:", __filename);
console.log("  __dirname: ", __dirname);

// Directory operations
console.log("\n=== Directory operations ===\n");

const testDir = join(tmpdir(), `kata-dirs-${Date.now()}`);
await mkdir(testDir, { recursive: true });
console.log("Created:", testDir);

// Create nested directories
await mkdir(join(testDir, "src", "utils"), { recursive: true });
await mkdir(join(testDir, "tests"), { recursive: true });

const entries = await readdir(testDir);
console.log("Contents:", entries);

// readdir with types
const detailed = await readdir(testDir, { withFileTypes: true });
for (const entry of detailed) {
  console.log(`  ${entry.name} (${entry.isDirectory() ? "dir" : "file"})`);
}

// Cleanup
import { rm } from "fs/promises";
await rm(testDir, { recursive: true });
console.log("Cleaned up");
```

## Expected Output

```
=== Path operations ===

Platform separator: "/"
String concat: /home/user/docs/file.txt
path.join:     /home/user/docs/file.txt
Normalized:    /home/user/images/photo.png
Resolved:      <cwd>/src/utils/helper.js

Decomposing: /home/user/project/src/index.js
  basename: index.js
  dirname:  /home/user/project/src
  extname:  .js
  parse:    { root: '/', dir: '/home/user/project/src', base: 'index.js', ext: '.js', name: 'index' }

ESM equivalents:
  __filename: <path>
  __dirname:  <path>

=== Directory operations ===

Created: /tmp/kata-dirs-<timestamp>
Contents: [ 'src', 'tests' ]
  src (dir)
  tests (dir)
Cleaned up
```

## Challenge

1. Write a function that lists all `.js` files recursively in a directory tree using `readdir({ recursive: true })`
2. What happens if you call `mkdir` without `{ recursive: true }` and the parent doesn't exist?
3. Use `path.relative()` to compute the relative path between two absolute paths

## Common Mistakes

- Using string concatenation for paths — breaks on Windows and creates bugs with double separators
- Using `__dirname` in ESM modules — it doesn't exist. Use `fileURLToPath(import.meta.url)` with `path.dirname()`
- Forgetting `{ recursive: true }` in `mkdir` for nested directories — throws `ENOENT` if parent doesn't exist
- Not using `{ withFileTypes: true }` in `readdir` — requires a separate `stat` call to check if entries are files or directories
