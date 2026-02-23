---
id: content-encoding-and-range
phase: 7
phase_title: HTTP from First Principles
sequence: 5
title: Content Encoding and Range Requests
difficulty: advanced
tags: [http, compression, gzip, brotli, range-requests, 206]
prerequisites: [http-keep-alive]
estimated_minutes: 15
---

## Concept

Two HTTP features that are essential for production web servers:

### Content Encoding (Compression)

The `Content-Encoding` header tells the client that the response body is compressed. The client sends `Accept-Encoding: gzip, br` to say what it supports, and the server compresses the response accordingly.

Common encodings:
- **gzip** — widely supported, decent compression
- **br** (Brotli) — better compression ratio, slower to compress, great for static assets
- **deflate** — legacy, avoid it (inconsistent implementations)

Compression reduces bandwidth by 60–90% for text content (HTML, JSON, CSS, JS). It's one of the highest-impact performance optimizations.

### Range Requests (Partial Content)

Range requests let the client ask for a specific byte range of a resource. The server responds with `206 Partial Content` and only sends the requested range.

Use cases:
- **Resuming downloads** — download interrupted at byte 50000? Request `Range: bytes=50000-`
- **Media streaming** — video player seeks to 2:30, requests only those bytes
- **Large file downloads** — download in parallel chunks

## Key Insight

> Compression and range requests are how the web stays fast. Compression shrinks a 500 KB JSON response to 50 KB. Range requests let you resume a 2 GB download from byte 1.5 GB instead of starting over. Both are transparent to the application — middleware handles them.

## Experiment

```js
import { createServer } from "http";
import { createGzip, createBrotliCompress, gzipSync, brotliCompressSync, gunzipSync } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

console.log("=== Content Encoding (Compression) ===\n");

// Generate test data (highly compressible)
const largeData = JSON.stringify({
  users: Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    bio: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(3),
  }))
});

console.log("Uncompressed size:", largeData.length, "bytes");

// Compress with gzip
const gzipped = gzipSync(Buffer.from(largeData));
console.log("Gzip size:        ", gzipped.length, "bytes", `(${(100 - gzipped.length / largeData.length * 100).toFixed(1)}% smaller)`);

// Compress with Brotli
const brotli = brotliCompressSync(Buffer.from(largeData));
console.log("Brotli size:      ", brotli.length, "bytes", `(${(100 - brotli.length / largeData.length * 100).toFixed(1)}% smaller)`);

console.log("\n=== Compression Server ===\n");

const server = createServer(async (req, res) => {
  if (req.url === "/data") {
    const acceptEncoding = req.headers["accept-encoding"] || "";

    // Content negotiation for encoding
    let encoding = null;
    let compressor = null;

    if (acceptEncoding.includes("br")) {
      encoding = "br";
      compressor = createBrotliCompress();
    } else if (acceptEncoding.includes("gzip")) {
      encoding = "gzip";
      compressor = createGzip();
    }

    if (encoding) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": encoding,
        "Vary": "Accept-Encoding",
      });
      // Stream through compressor
      await pipeline(
        Readable.from([largeData]),
        compressor,
        res,
      );
    } else {
      // No compression
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(largeData),
      });
      res.end(largeData);
    }
    return;
  }

  // Range request support
  if (req.url === "/file") {
    const content = Buffer.from("0123456789ABCDEF".repeat(100));
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      // Parse Range header: "bytes=start-end"
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : content.length - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${content.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "application/octet-stream",
        });
        res.end(content.slice(start, end + 1));
        return;
      }
    }

    // Full response
    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": content.length,
      "Content-Type": "application/octet-stream",
    });
    res.end(content);
    return;
  }

  res.writeHead(404).end();
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

// Test compression
console.log("Requesting with Accept-Encoding: gzip");
const gzipRes = await fetch(`${base}/data`, {
  headers: { "Accept-Encoding": "gzip" },
});

console.log("  Content-Encoding:", gzipRes.headers.get("content-encoding"));
console.log("  Vary:", gzipRes.headers.get("vary"));

// fetch() automatically decompresses
const data = await gzipRes.json();
console.log("  Decompressed users:", data.users.length);

console.log("\nRequesting with Accept-Encoding: br");
const brRes = await fetch(`${base}/data`, {
  headers: { "Accept-Encoding": "br" },
});
console.log("  Content-Encoding:", brRes.headers.get("content-encoding"));
await brRes.json();  // Consume body

console.log("\nRequesting without Accept-Encoding:");
const plainRes = await fetch(`${base}/data`, {
  headers: { "Accept-Encoding": "" },
});
console.log("  Content-Encoding:", plainRes.headers.get("content-encoding") || "(none)");
console.log("  Content-Length:", plainRes.headers.get("content-length"));
await plainRes.text();

console.log("\n=== Range Requests ===\n");

// Full request
const fullRes = await fetch(`${base}/file`);
const fullBody = await fullRes.arrayBuffer();
console.log("Full response:", fullRes.status, `(${fullBody.byteLength} bytes)`);
console.log("Accept-Ranges:", fullRes.headers.get("accept-ranges"));

// Range request: first 10 bytes
const range1Res = await fetch(`${base}/file`, {
  headers: { "Range": "bytes=0-9" },
});
const range1Body = Buffer.from(await range1Res.arrayBuffer());
console.log("\nRange bytes=0-9:", range1Res.status, range1Res.statusText);
console.log("  Content-Range:", range1Res.headers.get("content-range"));
console.log("  Body:", range1Body.toString());

// Range request: bytes 10-19
const range2Res = await fetch(`${base}/file`, {
  headers: { "Range": "bytes=10-19" },
});
const range2Body = Buffer.from(await range2Res.arrayBuffer());
console.log("\nRange bytes=10-19:", range2Res.status);
console.log("  Content-Range:", range2Res.headers.get("content-range"));
console.log("  Body:", range2Body.toString());

// Range request: last 16 bytes (suffix range)
const range3Res = await fetch(`${base}/file`, {
  headers: { "Range": "bytes=1584-" },
});
const range3Body = Buffer.from(await range3Res.arrayBuffer());
console.log("\nRange bytes=1584-:", range3Res.status);
console.log("  Content-Range:", range3Res.headers.get("content-range"));
console.log("  Body length:", range3Body.length, "bytes");

console.log("\n=== Compression Ratios by Content Type ===\n");

const samples = {
  "JSON": JSON.stringify({ data: Array(50).fill({ key: "value", num: 42 }) }),
  "HTML": "<html><body>" + "<p>Lorem ipsum dolor sit amet</p>".repeat(50) + "</body></html>",
  "CSS": "body { margin: 0; }\n".repeat(50) + ".container { display: flex; }\n".repeat(50),
  "Random bytes": Buffer.from(Array.from({ length: 1000 }, () => Math.floor(Math.random() * 256))).toString("latin1"),
};

console.log("Content type    | Original | Gzip     | Ratio");
console.log("----------------|----------|----------|------");
for (const [type, content] of Object.entries(samples)) {
  const original = Buffer.byteLength(content);
  const compressed = gzipSync(Buffer.from(content)).length;
  const ratio = (compressed / original * 100).toFixed(0);
  console.log(`${type.padEnd(15)} | ${String(original).padStart(8)} | ${String(compressed).padStart(8)} | ${ratio}%`);
}

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Content Encoding (Compression) ===

Uncompressed size: <number> bytes
Gzip size:         <number> bytes (XX.X% smaller)
Brotli size:       <number> bytes (XX.X% smaller)

=== Compression Server ===

Requesting with Accept-Encoding: gzip
  Content-Encoding: gzip
  Vary: Accept-Encoding
  Decompressed users: 100

Requesting with Accept-Encoding: br
  Content-Encoding: br

Requesting without Accept-Encoding:
  Content-Encoding: (none)
  Content-Length: <original size>

=== Range Requests ===

Full response: 200 (1600 bytes)
Accept-Ranges: bytes

Range bytes=0-9: 206 Partial Content
  Content-Range: bytes 0-9/1600
  Body: 0123456789

Range bytes=10-19: 206
  Content-Range: bytes 10-19/1600
  Body: ABCDEF0123

...

=== Compression Ratios by Content Type ===

Content type    | Original | Gzip     | Ratio
...
JSON            |    <num> |    <num> | <low>%
HTML            |    <num> |    <num> | <low>%
Random bytes    |    <num> |    <num> | ~100%
```

## Challenge

1. Build compression middleware: a function that wraps a request handler and automatically compresses responses based on `Accept-Encoding`. Don't compress images or already-compressed content
2. Implement a download resumption server: client sends `Range`, server responds with 206. On disconnect, client resumes from where it left off
3. What is the `Vary` header and why is it critical for caching with compression? What happens if you omit it?

## Deep Dive

The `Vary` header tells caches that the response differs based on certain request headers. `Vary: Accept-Encoding` means: "the same URL returns different content depending on the `Accept-Encoding` request header." Without it, a cache might serve a gzip-compressed response to a client that only supports Brotli, or serve compressed content to a client that sent no `Accept-Encoding`.

Range request status codes:
- `206 Partial Content` — partial response for a valid range
- `416 Range Not Satisfiable` — requested range is outside the resource bounds
- `200 OK` — server can ignore the Range header and send the full response

## Common Mistakes

- Compressing already-compressed content (JPEG, PNG, ZIP) — wastes CPU and may actually increase size
- Not setting `Vary: Accept-Encoding` — caches serve wrong encoding to clients
- Compressing tiny responses — the gzip header overhead (~20 bytes) makes small responses larger
- Not handling `Range: bytes=0-` (request for everything as a range) — should work like a normal request
- Setting `Content-Length` to the uncompressed size when `Content-Encoding` is set — the length must reflect the compressed size
