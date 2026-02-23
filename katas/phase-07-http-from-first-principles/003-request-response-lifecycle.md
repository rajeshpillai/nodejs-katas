---
id: request-response-lifecycle
phase: 7
phase_title: HTTP from First Principles
sequence: 3
title: Request/Response Lifecycle
difficulty: intermediate
tags: [http, lifecycle, request, response, body-parsing, streaming]
prerequisites: [headers-and-content-types]
estimated_minutes: 15
---

## Concept

Every HTTP interaction follows a lifecycle:

**Client side:**
1. DNS resolution (hostname → IP)
2. TCP connection (three-way handshake)
3. TLS handshake (if HTTPS)
4. Send request (method, URL, headers, body)
5. Wait for response
6. Receive response (status, headers, body)
7. Connection close or keep-alive for reuse

**Server side (Node.js `http` module):**
1. `'request'` event fires with `(req, res)` objects
2. `req` is a Readable stream — read the request body from it
3. Process the request (validate, query DB, compute response)
4. `res.writeHead()` — send status and headers
5. `res.write()` — send body chunks (optional, for streaming)
6. `res.end()` — signal response is complete

The `req` object is a Readable stream because HTTP request bodies can be large (file uploads). Node.js doesn't buffer the entire body — it streams it to you. You must collect the chunks yourself.

The `res` object is a Writable stream. You can stream the response too — sending data as it becomes available instead of buffering everything in memory.

## Key Insight

> The request body is a stream, not a string. Node.js doesn't buffer it for you — you must read it yourself. This is by design: a 10 GB file upload shouldn't consume 10 GB of memory. Reading the body as a stream lets you process data as it arrives, respecting memory limits.

## Experiment

```js
import { createServer } from "http";

console.log("=== Request/Response Lifecycle ===\n");

const server = createServer(async (req, res) => {
  const start = performance.now();

  console.log(`[server] ${req.method} ${req.url}`);

  // Route: echo the request body
  if (req.method === "POST" && req.url === "/echo") {
    // Read the request body (it's a stream!)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString();

    console.log(`[server] Body received: ${body.length} chars`);

    const response = JSON.stringify({
      method: req.method,
      url: req.url,
      headers: {
        "content-type": req.headers["content-type"],
        "content-length": req.headers["content-length"],
      },
      body: body,
      bodyLength: body.length,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(response);
    return;
  }

  // Route: streaming response
  if (req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    });

    for (let i = 1; i <= 5; i++) {
      res.write(`Chunk ${i} at ${(performance.now() - start).toFixed(0)}ms\n`);
      await new Promise(r => setTimeout(r, 50));
    }

    res.end("Stream complete!\n");
    return;
  }

  // Route: JSON request parsing
  if (req.method === "POST" && req.url === "/json") {
    // Read and parse JSON body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString();

    try {
      const data = JSON.parse(rawBody);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: data, type: typeof data }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON", message: err.message }));
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found", path: req.url }));
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

console.log("=== POST with Body ===\n");

const echoRes = await fetch(`${base}/echo`, {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: "Hello, this is the request body!",
});
const echoData = await echoRes.json();
console.log("Echo response:", echoData);

console.log("\n=== JSON Request/Response ===\n");

const jsonRes = await fetch(`${base}/json`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Alice", scores: [95, 87, 92] }),
});
const jsonData = await jsonRes.json();
console.log("JSON response:", jsonData);

// Bad JSON
const badRes = await fetch(`${base}/json`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "not valid json {{{",
});
const badData = await badRes.json();
console.log("Bad JSON:", badRes.status, badData);

console.log("\n=== Streaming Response ===\n");

const streamRes = await fetch(`${base}/stream`);
const streamBody = await streamRes.text();
console.log("Streamed response:");
console.log(streamBody);

console.log("=== Response Headers ===\n");

const headerRes = await fetch(`${base}/echo`, {
  method: "POST",
  body: "test",
});

console.log("Response status:", headerRes.status, headerRes.statusText);
console.log("Response headers:");
for (const [key, value] of headerRes.headers) {
  console.log(`  ${key}: ${value}`);
}

console.log("\n=== 404 Handling ===\n");

const notFoundRes = await fetch(`${base}/nonexistent`);
const notFoundData = await notFoundRes.json();
console.log("Status:", notFoundRes.status);
console.log("Body:", notFoundData);

server.close();
console.log("\nServer closed");
```

## Expected Output

```
=== POST with Body ===

[server] POST /echo
[server] Body received: 31 chars
Echo response: {
  method: 'POST',
  url: '/echo',
  headers: { 'content-type': 'text/plain', 'content-length': '31' },
  body: 'Hello, this is the request body!',
  bodyLength: 31
}

=== JSON Request/Response ===

[server] POST /json
JSON response: {
  received: { name: 'Alice', scores: [ 95, 87, 92 ] },
  type: 'object'
}
[server] POST /json
Bad JSON: 400 { error: 'Invalid JSON', ... }

=== Streaming Response ===

[server] GET /stream
Streamed response:
Chunk 1 at 0ms
Chunk 2 at 50ms
...

=== Response Headers ===

Response status: 200 OK
Response headers:
  content-type: application/json
  ...

=== 404 Handling ===

Status: 404
Body: { error: 'Not Found', path: '/nonexistent' }
```

## Challenge

1. Build a body size limiter: reject requests with bodies larger than 1 MB. Read the stream and count bytes — abort with 413 "Payload Too Large" if the limit is exceeded
2. Implement content-type-aware body parsing: if `Content-Type` is `application/json`, parse as JSON. If `text/plain`, return a string. If `application/x-www-form-urlencoded`, parse as form data
3. Stream a large response (1 million lines) while monitoring memory usage — prove that streaming keeps memory constant

## Deep Dive

`res.writeHead()` vs `res.setHeader()`:
- `res.setHeader(name, value)` — sets a header but doesn't send it yet. Can be called multiple times
- `res.writeHead(status, headers)` — sends the status line and ALL headers immediately. After this, you can't add more headers
- `res.write()` implicitly calls `writeHead(200)` if you haven't called it yet

Node.js buffers the headers until you first call `write()` or `end()`. This lets you set headers at any point before sending the body. But once the first byte of the body is sent, headers are locked.

## Common Mistakes

- Not reading the request body — if you don't consume the body stream, keep-alive connections may stall or the next request may read the previous request's body
- Using `JSON.parse` without try/catch — malformed JSON throws a SyntaxError, crashing the request handler
- Setting headers after `writeHead()` — they're silently ignored, not an error
- Not setting `Content-Type` — clients default to `application/octet-stream` or `text/html`, which may not be what you want
