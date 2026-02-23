---
id: upload-progress
phase: 8.5
phase_title: File Uploads & Multipart Streaming
sequence: 4
title: Upload Progress Tracking
difficulty: intermediate
tags: [upload, progress, streaming, events, backpressure]
prerequisites: [streaming-uploads]
estimated_minutes: 12
---

## Concept

For large uploads, users need feedback — a progress bar or percentage. Progress tracking requires knowing two things:

1. **Total size** — from the `Content-Length` request header
2. **Bytes received so far** — counted as chunks arrive

The server tracks progress during streaming and can report it via:
- **Server-Sent Events (SSE)** — a separate connection that pushes progress updates
- **WebSocket** — bidirectional, can send progress while receiving the upload
- **Polling endpoint** — client polls `GET /upload/status/:id` periodically

On the client side, `XMLHttpRequest` has an `upload.onprogress` event. The `fetch()` API doesn't expose upload progress natively, but you can use `ReadableStream` as the body to track outgoing bytes.

## Key Insight

> Upload progress is a streaming problem. The `Content-Length` header gives you the total, and each `data` event on the request stream gives you a chunk to count. The challenge is reporting this progress back to the client while the upload is still in progress — which requires a separate communication channel (SSE, WebSocket, or polling).

## Experiment

```js
import { createServer } from "http";
import { EventEmitter } from "events";
import { randomBytes } from "crypto";

console.log("=== Upload Progress Tracking ===\n");

// Global upload tracker
const uploads = new Map();

class UploadTracker extends EventEmitter {
  constructor(id, totalBytes) {
    super();
    this.id = id;
    this.totalBytes = totalBytes;
    this.receivedBytes = 0;
    this.startTime = Date.now();
    this.status = "uploading";
    this.lastReportTime = 0;
  }

  addBytes(count) {
    this.receivedBytes += count;
    const now = Date.now();

    // Throttle events to max 10 per second
    if (now - this.lastReportTime >= 100 || this.receivedBytes >= this.totalBytes) {
      this.lastReportTime = now;

      const elapsed = (now - this.startTime) / 1000;
      const speed = this.receivedBytes / elapsed;
      const remaining = this.totalBytes > 0
        ? (this.totalBytes - this.receivedBytes) / speed
        : 0;

      const progress = {
        id: this.id,
        received: this.receivedBytes,
        total: this.totalBytes,
        percent: this.totalBytes > 0
          ? Math.round(this.receivedBytes / this.totalBytes * 100)
          : 0,
        speed: Math.round(speed),
        elapsed: elapsed.toFixed(1),
        remaining: remaining.toFixed(1),
        status: this.status,
      };

      this.emit("progress", progress);
    }
  }

  complete(result) {
    this.status = "complete";
    this.emit("complete", {
      id: this.id,
      totalBytes: this.receivedBytes,
      duration: ((Date.now() - this.startTime) / 1000).toFixed(1),
      ...result,
    });
  }

  error(message) {
    this.status = "error";
    this.emit("error", { id: this.id, error: message });
  }
}

// --- Server ---

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // POST /upload — accept upload with progress tracking
  if (req.method === "POST" && url.pathname === "/upload") {
    const uploadId = randomBytes(8).toString("hex");
    const totalBytes = parseInt(req.headers["content-length"] || "0");

    const tracker = new UploadTracker(uploadId, totalBytes);
    uploads.set(uploadId, tracker);

    // Log progress events
    tracker.on("progress", (p) => {
      const bar = "█".repeat(Math.floor(p.percent / 5)) + "░".repeat(20 - Math.floor(p.percent / 5));
      console.log(`  [${uploadId.slice(0, 8)}] ${bar} ${p.percent}% (${formatBytes(p.received)}/${formatBytes(p.total)}) ${formatBytes(p.speed)}/s`);
    });

    // Send upload ID immediately so client can track
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Upload-ID": uploadId,
      "Transfer-Encoding": "chunked",
    });

    // Stream the upload, counting bytes
    let totalReceived = 0;
    const chunks = [];

    try {
      for await (const chunk of req) {
        totalReceived += chunk.length;
        chunks.push(chunk);
        tracker.addBytes(chunk.length);
      }

      tracker.complete({
        size: totalReceived,
        message: "Upload complete",
      });

      res.end(JSON.stringify({
        uploadId,
        size: totalReceived,
        status: "complete",
      }));

    } catch (err) {
      tracker.error(err.message);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end(JSON.stringify({ error: err.message }));
    }

    // Clean up tracker after 5 minutes
    setTimeout(() => uploads.delete(uploadId), 5 * 60 * 1000);
    return;
  }

  // GET /upload/status/:id — poll progress
  if (req.method === "GET" && url.pathname.startsWith("/upload/status/")) {
    const id = url.pathname.split("/").pop();
    const tracker = uploads.get(id);

    if (!tracker) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload not found" }));
      return;
    }

    const elapsed = (Date.now() - tracker.startTime) / 1000;
    const speed = tracker.receivedBytes / (elapsed || 1);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: tracker.id,
      status: tracker.status,
      received: tracker.receivedBytes,
      total: tracker.totalBytes,
      percent: tracker.totalBytes > 0
        ? Math.round(tracker.receivedBytes / tracker.totalBytes * 100)
        : 0,
      speed: Math.round(speed),
    }));
    return;
  }

  // GET /upload/events/:id — Server-Sent Events for progress
  if (req.method === "GET" && url.pathname.startsWith("/upload/events/")) {
    const id = url.pathname.split("/").pop();
    const tracker = uploads.get(id);

    if (!tracker) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const onProgress = (p) => {
      res.write(`data: ${JSON.stringify(p)}\n\n`);
    };

    const onComplete = (data) => {
      res.write(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
      cleanup();
    };

    const onError = (data) => {
      res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
      cleanup();
    };

    const cleanup = () => {
      tracker.removeListener("progress", onProgress);
      tracker.removeListener("complete", onComplete);
      tracker.removeListener("error", onError);
      res.end();
    };

    tracker.on("progress", onProgress);
    tracker.on("complete", onComplete);
    tracker.on("error", onError);

    req.on("close", cleanup);
    return;
  }

  res.writeHead(404).end();
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

// --- Demo: upload with progress ---

console.log("--- Uploading 200 KB file ---\n");

// Create a 200 KB test payload
const payload = Buffer.alloc(200 * 1024, 0x41);

const uploadRes = await fetch(`${base}/upload`, {
  method: "POST",
  headers: {
    "Content-Length": String(payload.length),
    "Content-Type": "application/octet-stream",
  },
  body: payload,
});

const result = await uploadRes.json();
console.log("\nResult:", result);

// Poll the status endpoint
const statusRes = await fetch(`${base}/upload/status/${result.uploadId}`);
const status = await statusRes.json();
console.log("Final status:", status);

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Upload Progress Tracking ===

--- Uploading 200 KB file ---

  [<id>] ████████████████████ 100% (200 KB/200 KB) <speed>/s

Result: { uploadId: '<hex>', size: 204800, status: 'complete' }
Final status: { id: '<hex>', status: 'complete', received: 204800, total: 204800, percent: 100, speed: ... }
```

## Challenge

1. Build a multi-file upload with per-file progress: track each file independently and report aggregate progress
2. Implement upload resumption: if the connection drops at 50%, the client can restart from byte 50% using the `Range` or a custom header
3. Add speed throttling: limit upload speed to N bytes/second using backpressure (pause the request stream, resume after a delay)

## Common Mistakes

- Reporting progress too frequently — 1000 events per second floods the client. Throttle to 5-10 updates per second
- Not cleaning up SSE connections when the upload finishes — leaked connections consume server resources
- Using `Content-Length` as the sole progress indicator — it can be absent or wrong. Always count actual bytes
- Not handling the case where the upload ID is checked before the upload starts — race condition between starting upload and polling
