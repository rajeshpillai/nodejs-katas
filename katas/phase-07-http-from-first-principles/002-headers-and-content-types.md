---
id: headers-and-content-types
phase: 7
phase_title: HTTP from First Principles
sequence: 2
title: Headers and Content Types
difficulty: intermediate
tags: [http, headers, content-type, content-length, mime]
prerequisites: [http-protocol]
estimated_minutes: 12
---

## Concept

HTTP headers are metadata about the request or response. They're key-value pairs that control caching, authentication, content negotiation, connection behavior, and more.

**Request headers** (client → server):
- `Host` — which server (required in HTTP/1.1, enables virtual hosting)
- `Accept` — what content types the client understands (`application/json`, `text/html`)
- `Authorization` — credentials (`Bearer <token>`, `Basic <base64>`)
- `Content-Type` — body format when sending data
- `Content-Length` — body size in bytes
- `User-Agent` — client identification
- `Cookie` — session data

**Response headers** (server → client):
- `Content-Type` — what the body is (`application/json; charset=utf-8`)
- `Content-Length` — body size
- `Set-Cookie` — store session data in the browser
- `Cache-Control` — caching rules
- `Location` — redirect target (with 301/302 status)
- `Access-Control-Allow-Origin` — CORS permission

The `Content-Type` header is critical — it tells the receiver how to interpret the body bytes. Without it, `{"name":"alice"}` is just a meaningless string of characters.

## Key Insight

> `Content-Type` is a contract between sender and receiver. The sender says "these bytes are JSON" (`application/json`) and the receiver knows to parse them accordingly. Send HTML with a JSON content type and the client will try to JSON.parse it and fail. The content type doesn't change the bytes — it changes how they're interpreted.

## Experiment

```js
import { createServer } from "http";

console.log("=== HTTP Headers Server ===\n");

const server = createServer((req, res) => {
  // Inspect request headers
  if (req.url === "/echo-headers") {
    const body = JSON.stringify({
      method: req.method,
      url: req.url,
      headers: req.headers,
      rawHeaders: req.rawHeaders,  // Preserves case and duplicates
    }, null, 2);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  // Serve different content types
  if (req.url === "/text") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello, this is plain text.");
    return;
  }

  if (req.url === "/html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Hello</h1><p>This is HTML</p>");
    return;
  }

  if (req.url === "/json") {
    const data = { users: ["Alice", "Bob"], count: 2 };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.url === "/csv") {
    res.writeHead(200, {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=\"data.csv\"",
    });
    res.end("name,age\nAlice,30\nBob,25\n");
    return;
  }

  if (req.url === "/binary") {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": buf.length,
    });
    res.end(buf);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

console.log("=== Content Types ===\n");

const contentTypes = [
  { path: "/text", type: "text/plain" },
  { path: "/html", type: "text/html; charset=utf-8" },
  { path: "/json", type: "application/json" },
  { path: "/csv", type: "text/csv" },
  { path: "/binary", type: "application/octet-stream" },
];

for (const { path, type } of contentTypes) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const contentType = res.headers.get("content-type");
  const body = type.includes("octet") ? `<${(await res.arrayBuffer()).byteLength} bytes>` : await res.text();

  console.log(`${path}:`);
  console.log(`  Content-Type: ${contentType}`);
  console.log(`  Body: ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`);
  console.log();
}

console.log("=== Request Headers ===\n");

const res = await fetch(`http://127.0.0.1:${port}/echo-headers`, {
  headers: {
    "Accept": "application/json",
    "Authorization": "Bearer my-token-123",
    "X-Request-ID": "req-abc-456",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const echoData = await res.json();
console.log("Headers sent by fetch():");
for (const [key, value] of Object.entries(echoData.headers)) {
  console.log(`  ${key}: ${value}`);
}

console.log("\n=== Common MIME Types ===\n");

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

console.log("File extension → MIME type:");
for (const [ext, mime] of Object.entries(mimeTypes)) {
  console.log(`  ${ext.padEnd(7)} → ${mime}`);
}

console.log("\n=== Content Negotiation ===\n");

// Content negotiation: client says what it accepts, server picks the best match
const acceptHeaders = [
  "application/json",
  "text/html",
  "text/html, application/json;q=0.9",
  "*/*",
  "application/xml, application/json;q=0.8",
];

console.log("Accept header → Server should respond with:");
for (const accept of acceptHeaders) {
  // Simple parser: pick the highest quality match
  const types = accept.split(",").map(t => {
    const [type, ...params] = t.trim().split(";");
    const q = params.find(p => p.trim().startsWith("q="));
    return { type: type.trim(), q: q ? parseFloat(q.split("=")[1]) : 1.0 };
  }).sort((a, b) => b.q - a.q);

  console.log(`  "${accept}" → ${types[0].type} (q=${types[0].q})`);
}

server.close();
console.log("\nDone");
```

## Expected Output

```
=== Content Types ===

/text:
  Content-Type: text/plain
  Body: Hello, this is plain text.

/html:
  Content-Type: text/html; charset=utf-8
  Body: <h1>Hello</h1><p>This is HTML</p>

/json:
  Content-Type: application/json
  Body: {"users":["Alice","Bob"],"count":2}

/csv:
  Content-Type: text/csv
  Body: name,age\nAlice,30\nBob,25

/binary:
  Content-Type: application/octet-stream
  Body: <8 bytes>

=== Request Headers ===

Headers sent by fetch():
  accept: application/json
  authorization: Bearer my-token-123
  x-request-id: req-abc-456
  ...

=== Common MIME Types ===

...

=== Content Negotiation ===

...
```

## Challenge

1. Build a server that serves the same resource as JSON or HTML based on the `Accept` header — return JSON for `application/json` and HTML for `text/html`
2. Implement proper `Content-Length` calculation for a JSON response with Unicode characters — remember, `Content-Length` is in bytes, not characters
3. What happens if you set `Content-Type: text/html` but send JSON in the body? How do browsers handle this mismatch?

## Deep Dive

Why `charset=utf-8` matters in `Content-Type`:

`Content-Type: text/html` without a charset relies on the browser to guess the encoding. Different browsers may guess differently. Always specify: `Content-Type: text/html; charset=utf-8`.

For `application/json`, the charset is always UTF-8 by spec (RFC 8259), so `charset=utf-8` is optional but harmless.

The `Content-Length` header is in **bytes**, not characters. For ASCII text, bytes = characters. For UTF-8, multi-byte characters make them differ: `Buffer.byteLength("日本語")` is 9, but `"日本語".length` is 3.

## Common Mistakes

- Setting `Content-Length` using `string.length` instead of `Buffer.byteLength(string)` — wrong for non-ASCII characters
- Sending JSON with `Content-Type: text/plain` — clients won't auto-parse it
- Not setting `charset=utf-8` on HTML responses — browsers may guess wrong encoding
- Sending multiple `Content-Type` headers — only the last one takes effect in most implementations
