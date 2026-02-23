---
id: temporary-storage
phase: 8.5
phase_title: File Uploads & Multipart Streaming
sequence: 5
title: Temporary Storage and Cleanup
difficulty: intermediate
tags: [upload, temp-files, cleanup, disk, lifecycle]
prerequisites: [file-size-limits]
estimated_minutes: 12
---

## Concept

Uploaded files typically go through a lifecycle:

1. **Receive** — stream to a temporary location on disk
2. **Validate** — check file type, scan for viruses, verify integrity
3. **Process** — resize images, transcode video, extract metadata
4. **Store permanently** — move to final storage (local disk, S3, database)
5. **Clean up** — delete the temp file

Temporary storage must be:
- **In the right place** — `os.tmpdir()` or a configured upload directory
- **Uniquely named** — prevent collisions with concurrent uploads
- **Cleaned up reliably** — even when the process crashes, validation fails, or the client disconnects
- **Size-bounded** — the temp directory shouldn't fill up the disk

The most common mistake is forgetting cleanup. Every code path — success, validation failure, error, timeout, client disconnect — must delete temp files. A `try/finally` pattern or a periodic cleanup job ensures nothing is left behind.

## Key Insight

> Temp files are a resource that must be managed like database connections — acquire, use, release. Every file you write to `/tmp` is a commitment to clean it up. Use `try/finally`, periodic sweeps, and unique naming to prevent the three temp file bugs: leaks, collisions, and disk exhaustion.

## Experiment

```js
import { createWriteStream } from "fs";
import { writeFile, readFile, unlink, readdir, stat, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createServer } from "http";

console.log("=== Temporary File Management ===\n");

// --- Temp File Manager ---

class TempFileManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.tracked = new Map();  // path → { createdAt, purpose }
    this.maxAge = 60 * 60 * 1000;  // 1 hour
  }

  async init() {
    await mkdir(this.baseDir, { recursive: true });
    console.log(`[temp] Directory: ${this.baseDir}`);
  }

  // Create a unique temp file path
  createPath(extension = "", purpose = "unknown") {
    const id = randomBytes(16).toString("hex");
    const name = extension ? `${id}${extension}` : id;
    const path = join(this.baseDir, name);

    this.tracked.set(path, {
      createdAt: Date.now(),
      purpose,
    });

    return path;
  }

  // Create a writable stream to a temp file
  createWriteStream(extension = "", purpose = "upload") {
    const path = this.createPath(extension, purpose);
    const stream = createWriteStream(path);
    stream.tempPath = path;
    return stream;
  }

  // Clean up a specific temp file
  async cleanup(path) {
    try {
      await unlink(path);
      this.tracked.delete(path);
      return true;
    } catch (err) {
      if (err.code === "ENOENT") {
        this.tracked.delete(path);
        return false;  // Already deleted
      }
      throw err;
    }
  }

  // Move a temp file to permanent storage
  async persist(tempPath, destPath) {
    const { rename } = await import("fs/promises");
    try {
      await rename(tempPath, destPath);
    } catch (err) {
      // Cross-device move — fall back to copy + delete
      if (err.code === "EXDEV") {
        const { copyFile } = await import("fs/promises");
        await copyFile(tempPath, destPath);
        await unlink(tempPath);
      } else {
        throw err;
      }
    }
    this.tracked.delete(tempPath);
  }

  // Periodic cleanup — remove old temp files
  async sweep() {
    const now = Date.now();
    let cleaned = 0;

    try {
      const entries = await readdir(this.baseDir);

      for (const entry of entries) {
        const path = join(this.baseDir, entry);
        try {
          const info = await stat(path);
          const age = now - info.mtimeMs;

          if (age > this.maxAge) {
            await unlink(path);
            this.tracked.delete(path);
            cleaned++;
          }
        } catch {
          // File may have been deleted already
        }
      }
    } catch {
      // Directory may not exist
    }

    return cleaned;
  }

  // Get status
  async getStatus() {
    try {
      const entries = await readdir(this.baseDir);
      let totalSize = 0;

      for (const entry of entries) {
        try {
          const info = await stat(join(this.baseDir, entry));
          totalSize += info.size;
        } catch {}
      }

      return {
        directory: this.baseDir,
        fileCount: entries.length,
        trackedCount: this.tracked.size,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      };
    } catch {
      return { directory: this.baseDir, fileCount: 0, trackedCount: 0, totalSizeMB: "0" };
    }
  }

  // Destroy — clean up everything
  async destroy() {
    await rm(this.baseDir, { recursive: true, force: true });
    this.tracked.clear();
  }
}

// --- Demo ---

const tempDir = join(tmpdir(), `kata-temp-${Date.now()}`);
const manager = new TempFileManager(tempDir);
await manager.init();

console.log("\n--- Creating temp files ---\n");

// Simulate uploads
const file1 = manager.createPath(".jpg", "avatar upload");
await writeFile(file1, Buffer.alloc(1024 * 50, 0xFF));  // 50 KB
console.log("Created:", file1);

const file2 = manager.createPath(".pdf", "document upload");
await writeFile(file2, Buffer.alloc(1024 * 200, 0x25));  // 200 KB
console.log("Created:", file2);

const file3 = manager.createPath(".tmp", "processing");
await writeFile(file3, Buffer.alloc(1024 * 100, 0x00));  // 100 KB
console.log("Created:", file3);

console.log("\nStatus:", await manager.getStatus());

console.log("\n--- Simulating upload lifecycle ---\n");

// Success path: upload → validate → persist
console.log("Upload lifecycle (success):");
const uploadPath = manager.createPath(".jpg", "user-avatar");
await writeFile(uploadPath, Buffer.alloc(1024, 0xFF));

console.log("  1. Received → temp file created");
console.log("  2. Validating...");

// Simulate validation passing
const isValid = true;
if (isValid) {
  const permanentDir = join(tempDir, "permanent");
  await mkdir(permanentDir, { recursive: true });
  const destPath = join(permanentDir, "avatar-user123.jpg");
  await manager.persist(uploadPath, destPath);
  console.log("  3. Persisted to:", destPath);
}

// Failure path: upload → validate → cleanup
console.log("\nUpload lifecycle (validation failure):");
const badUploadPath = manager.createPath(".exe", "suspicious-file");
await writeFile(badUploadPath, Buffer.alloc(512, 0x4D));

console.log("  1. Received → temp file created");
console.log("  2. Validating... FAILED (disallowed type)");
await manager.cleanup(badUploadPath);
console.log("  3. Temp file cleaned up");

// Error path: upload interrupted
console.log("\nUpload lifecycle (client disconnect):");
const interruptedPath = manager.createPath(".zip", "large-upload");

try {
  await writeFile(interruptedPath, Buffer.alloc(100));
  throw new Error("Client disconnected");
} catch (err) {
  console.log(`  Error: ${err.message}`);
} finally {
  // finally block ensures cleanup
  await manager.cleanup(interruptedPath);
  console.log("  Temp file cleaned up in finally block");
}

console.log("\nStatus after lifecycle:", await manager.getStatus());

console.log("\n--- Periodic sweep ---\n");

// Create some "old" files by writing them and pretending they're old
const oldFile = manager.createPath(".tmp", "stale-upload");
await writeFile(oldFile, "old data");

// For demo, set maxAge to 0 so everything is "expired"
manager.maxAge = 0;
const cleaned = await manager.sweep();
console.log(`Sweep cleaned ${cleaned} expired files`);
console.log("Status after sweep:", await manager.getStatus());

// Cleanup
await manager.destroy();
console.log("\nAll temp files destroyed");
```

## Expected Output

```
=== Temporary File Management ===

[temp] Directory: /tmp/kata-temp-<timestamp>

--- Creating temp files ---

Created: /tmp/kata-temp-.../abc123.jpg
Created: /tmp/kata-temp-.../def456.pdf
Created: /tmp/kata-temp-.../ghi789.tmp

Status: { directory: '...', fileCount: 3, trackedCount: 3, totalSizeMB: '0.34' }

--- Simulating upload lifecycle ---

Upload lifecycle (success):
  1. Received → temp file created
  2. Validating...
  3. Persisted to: .../permanent/avatar-user123.jpg

Upload lifecycle (validation failure):
  1. Received → temp file created
  2. Validating... FAILED (disallowed type)
  3. Temp file cleaned up

Upload lifecycle (client disconnect):
  Error: Client disconnected
  Temp file cleaned up in finally block

...

--- Periodic sweep ---

Sweep cleaned <N> expired files
Status after sweep: { ... fileCount: 0 ... }

All temp files destroyed
```

## Challenge

1. Implement disk quota enforcement: the temp directory should never exceed 1 GB total. Before accepting a new upload, check current usage and reject with 507 (Insufficient Storage) if full
2. Build an atomic write pattern: write to a temp file, then atomically rename to the final path. This ensures partial writes never appear at the final location
3. Add a startup sweep: when the server starts, scan the temp directory and delete any files from previous runs (orphaned by crashes)

## Deep Dive

Why `rename()` for persisting files:

`fs.rename()` is atomic on the same filesystem — the file either exists at the old path or the new path, never both or neither. This prevents partial writes: if the server crashes during a `copyFile()`, the destination could have a partial file. With `rename()`, either the move happened or it didn't.

The caveat: `rename()` fails with `EXDEV` across filesystem boundaries (e.g., `/tmp` on a ramdisk to `/data` on an SSD). In that case, fall back to copy + delete, accepting the non-atomicity.

## Common Mistakes

- Not cleaning up temp files on every error path — the most common temp file bug. Use `try/finally`
- Using predictable temp file names — `upload-1.tmp`, `upload-2.tmp` creates race conditions with concurrent uploads. Use random names
- Not running periodic sweeps — even with `finally` blocks, process crashes leave orphan files. A cron-style sweep catches them
- Writing temp files to the application directory — use `os.tmpdir()` or a dedicated upload directory. App directories may not be writable in production
