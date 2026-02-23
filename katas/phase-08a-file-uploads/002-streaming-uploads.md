---
id: streaming-uploads
phase: 8.5
phase_title: File Uploads & Multipart Streaming
sequence: 2
title: Streaming Uploads
difficulty: advanced
tags: [upload, streaming, memory, large-files, disk]
prerequisites: [multipart-form-data]
estimated_minutes: 15
---

## Concept

The previous kata parsed multipart by buffering the entire body in memory. That works for small uploads but fails catastrophically for large files — a 2 GB video upload would consume 2 GB of RAM.

The solution: **streaming**. Parse the multipart boundary as data arrives, and pipe file contents directly to disk (or another destination) without ever holding the entire file in memory.

A streaming multipart parser works like this:
1. Read incoming chunks from the request stream
2. Scan for boundary strings in the stream
3. When a new part begins, parse its headers
4. Pipe the part's body to a file write stream (or any Writable)
5. When the boundary is found again, the current part is complete

The memory usage is bounded by the `highWaterMark` of the streams involved — typically 64 KB — regardless of whether the uploaded file is 1 KB or 10 GB.

## Key Insight

> Streaming uploads are the difference between a server that handles 10 MB files and one that handles 10 GB files. By piping the upload directly to disk, memory usage is constant — proportional to the buffer size, not the file size. This is the same principle as `pipeline()`: connect streams, let backpressure regulate flow.

## Experiment

```js
import { createServer } from "http";
import { createWriteStream } from "fs";
import { mkdir, readdir, stat, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Transform } from "stream";

console.log("=== Streaming Upload Parser ===\n");

// A simplified streaming multipart parser
// In production, use busboy or formidable
class MultipartParser extends Transform {
  constructor(boundary) {
    super();
    this.boundary = Buffer.from(`\r\n--${boundary}`);
    this.endBoundary = Buffer.from(`\r\n--${boundary}--`);
    this.buffer = Buffer.alloc(0);
    this.state = "preamble";  // preamble | header | body
    this.currentPart = null;
    this.parts = [];
    this.firstBoundary = Buffer.from(`--${boundary}\r\n`);
  }

  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.process();
    callback();
  }

  _flush(callback) {
    this.process();
    if (this.currentPart) {
      this.emit("part-end", this.currentPart);
      this.currentPart = null;
    }
    callback();
  }

  process() {
    let keepGoing = true;
    while (keepGoing) {
      switch (this.state) {
        case "preamble":
          keepGoing = this.processPreamble();
          break;
        case "header":
          keepGoing = this.processHeader();
          break;
        case "body":
          keepGoing = this.processBody();
          break;
        default:
          keepGoing = false;
      }
    }
  }

  processPreamble() {
    const idx = this.buffer.indexOf(this.firstBoundary);
    if (idx === -1) return false;
    this.buffer = this.buffer.slice(idx + this.firstBoundary.length);
    this.state = "header";
    return true;
  }

  processHeader() {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return false;

    const headerText = this.buffer.slice(0, headerEnd).toString();
    this.buffer = this.buffer.slice(headerEnd + 4);

    // Parse headers
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
      }
    }

    const disposition = headers["content-disposition"] || "";
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    this.currentPart = {
      name: nameMatch?.[1] || null,
      filename: filenameMatch?.[1] || null,
      contentType: headers["content-type"] || null,
      size: 0,
    };

    this.emit("part-start", this.currentPart);
    this.state = "body";
    return true;
  }

  processBody() {
    // Look for the next boundary in our buffer
    const boundaryIdx = this.buffer.indexOf(this.boundary);
    const endIdx = this.buffer.indexOf(this.endBoundary);

    if (endIdx !== -1 && (boundaryIdx === -1 || endIdx <= boundaryIdx)) {
      // End boundary found — emit remaining body data
      const bodyData = this.buffer.slice(0, endIdx);
      if (bodyData.length > 0) {
        this.currentPart.size += bodyData.length;
        this.emit("part-data", bodyData, this.currentPart);
      }
      this.emit("part-end", this.currentPart);
      this.currentPart = null;
      this.state = "done";
      return false;
    }

    if (boundaryIdx !== -1) {
      // Next boundary found — emit body data before it
      const bodyData = this.buffer.slice(0, boundaryIdx);
      if (bodyData.length > 0) {
        this.currentPart.size += bodyData.length;
        this.emit("part-data", bodyData, this.currentPart);
      }
      this.emit("part-end", this.currentPart);
      this.currentPart = null;

      // Skip boundary + CRLF
      this.buffer = this.buffer.slice(boundaryIdx + this.boundary.length + 2);
      this.state = "header";
      return true;
    }

    // No boundary found — emit safe portion (keep last boundary-length bytes)
    const safeLen = this.buffer.length - this.boundary.length;
    if (safeLen > 0) {
      const safeData = this.buffer.slice(0, safeLen);
      this.currentPart.size += safeData.length;
      this.emit("part-data", safeData, this.currentPart);
      this.buffer = this.buffer.slice(safeLen);
    }
    return false;
  }
}

// --- Upload Server ---

const uploadDir = join(tmpdir(), `kata-uploads-${Date.now()}`);
await mkdir(uploadDir, { recursive: true });
console.log("Upload directory:", uploadDir);

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/upload") {
    res.writeHead(404).end();
    return;
  }

  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing boundary" }));
    return;
  }

  const parser = new MultipartParser(boundaryMatch[1]);
  const results = [];
  let currentWriter = null;
  let peakMemory = 0;

  parser.on("part-start", (part) => {
    console.log(`  [upload] Part started: ${part.name}${part.filename ? ` (${part.filename})` : ""}`);

    if (part.filename) {
      // File field — stream to disk
      const filePath = join(uploadDir, `${Date.now()}-${part.filename}`);
      currentWriter = createWriteStream(filePath);
      part.savedPath = filePath;
    } else {
      // Text field — collect in memory (small)
      part.chunks = [];
    }
    results.push(part);
  });

  parser.on("part-data", (data, part) => {
    if (currentWriter && part.filename) {
      currentWriter.write(data);
    } else if (part.chunks) {
      part.chunks.push(data);
    }

    // Track memory
    const mem = process.memoryUsage().rss;
    if (mem > peakMemory) peakMemory = mem;
  });

  parser.on("part-end", (part) => {
    if (currentWriter && part.filename) {
      currentWriter.end();
      currentWriter = null;
      console.log(`  [upload] File saved: ${part.filename} (${part.size} bytes)`);
    } else if (part.chunks) {
      part.value = Buffer.concat(part.chunks).toString();
      delete part.chunks;
      console.log(`  [upload] Field: ${part.name} = "${part.value}"`);
    }
  });

  req.pipe(parser);

  parser.on("end", () => {
    const response = {
      parts: results.map(p => ({
        name: p.name,
        filename: p.filename,
        contentType: p.contentType,
        size: p.size,
        ...(p.value !== undefined && { value: p.value }),
        ...(p.savedPath && { savedPath: p.savedPath }),
      })),
      peakMemoryMB: (peakMemory / 1024 / 1024).toFixed(1),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response, null, 2));
  });

  parser.on("error", (err) => {
    console.error("Parser error:", err);
    res.writeHead(500).end();
  });
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

console.log("\n--- Uploading mixed content ---\n");

// Build a multipart upload with text + binary
const boundary = "----TestBoundary" + Date.now();

// Simulate a 50 KB file (small enough for demo, shows the pattern)
const fakeFile = Buffer.alloc(50 * 1024, 0x42);  // 50 KB of 'B'

const multipartBody = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nMy Upload\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nA test file upload\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="data.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
  fakeFile,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const uploadRes = await fetch(`http://127.0.0.1:${port}/upload`, {
  method: "POST",
  headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  body: multipartBody,
});

const result = await uploadRes.json();
console.log("\nUpload result:");
console.log(JSON.stringify(result, null, 2));

// Verify the file was saved
const files = await readdir(uploadDir);
console.log("\nFiles in upload dir:", files);
for (const f of files) {
  const info = await stat(join(uploadDir, f));
  console.log(`  ${f}: ${info.size} bytes`);
}

// Cleanup
await rm(uploadDir, { recursive: true });
server.close();
console.log("\nDone");
```

## Expected Output

```
=== Streaming Upload Parser ===

Upload directory: /tmp/kata-uploads-<timestamp>

--- Uploading mixed content ---

  [upload] Part started: title
  [upload] Field: title = "My Upload"
  [upload] Part started: description
  [upload] Field: description = "A test file upload"
  [upload] Part started: file (data.bin)
  [upload] File saved: data.bin (51200 bytes)

Upload result:
{
  "parts": [
    { "name": "title", "size": 9, "value": "My Upload" },
    { "name": "description", "size": 18, "value": "A test file upload" },
    { "name": "file", "filename": "data.bin", "contentType": "application/octet-stream", "size": 51200, "savedPath": "..." }
  ],
  "peakMemoryMB": "..."
}

Files in upload dir: [ '<timestamp>-data.bin' ]
  <timestamp>-data.bin: 51200 bytes
```

## Challenge

1. Add upload progress tracking: emit `progress` events with `{ bytesReceived, totalBytes }` (use the `Content-Length` header for total)
2. Implement file size limits per part: abort the upload with 413 if any single file exceeds 10 MB
3. Stream the uploaded file directly to a cloud storage API (simulate with a Writable) — no temp file on disk

## Common Mistakes

- Holding entire files in memory — use streaming to disk for any file that could be large
- Not cleaning up temp files on error — if parsing fails mid-upload, delete any partially written files
- Trusting the `filename` from the client — it could contain path traversal (`../../etc/passwd`). Always sanitize
- Not setting upload timeouts — a slow client can hold a connection open indefinitely
