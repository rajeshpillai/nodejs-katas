---
id: http-protocol
phase: 7
phase_title: HTTP from First Principles
sequence: 1
title: The HTTP Protocol
difficulty: intermediate
tags: [http, protocol, request, response, headers]
prerequisites: [tcp-basics]
estimated_minutes: 15
---

## Concept

HTTP (HyperText Transfer Protocol) is a text-based request-response protocol built on top of TCP. Every web page, API call, and file download uses HTTP. Understanding it at the protocol level — not just the API level — is what separates backend developers from framework users.

An HTTP request looks like this on the wire:
```
GET /api/users HTTP/1.1\r\n
Host: example.com\r\n
Accept: application/json\r\n
\r\n
```

An HTTP response:
```
HTTP/1.1 200 OK\r\n
Content-Type: application/json\r\n
Content-Length: 27\r\n
\r\n
{"users":["alice","bob"]}
```

The structure: **request/status line** + **headers** (key-value pairs) + **blank line** (`\r\n\r\n`) + **body** (optional).

Headers and body are separated by a double CRLF (`\r\n\r\n`). The `Content-Length` header tells the receiver exactly how many bytes the body contains — this is length-prefix framing applied to HTTP.

## Key Insight

> HTTP is just text over TCP with a specific format. A request line, headers, a blank line, and an optional body. When you call `fetch()` or `http.request()`, you're just building this text format and sending it through a TCP socket. There's no magic — understanding the wire format lets you debug any HTTP issue.

## Experiment

```js
import { createServer } from "http";
import { createConnection } from "net";

console.log("=== HTTP Server ===\n");

// Create a basic HTTP server
const server = createServer((req, res) => {
  console.log("[server] Request:");
  console.log(`  Method: ${req.method}`);
  console.log(`  URL: ${req.url}`);
  console.log(`  HTTP Version: ${req.httpVersion}`);
  console.log("  Headers:");
  for (const [key, value] of Object.entries(req.headers)) {
    console.log(`    ${key}: ${value}`);
  }

  // Send response
  const body = JSON.stringify({
    message: "Hello from Node.js!",
    path: req.url,
    method: req.method,
  });

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Custom-Header": "kata-demo",
  });
  res.end(body);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
console.log(`Listening on http://127.0.0.1:${port}\n`);

console.log("=== Raw HTTP over TCP ===\n");

// Send a raw HTTP request via TCP to see the protocol on the wire
const rawResponse = await new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  const chunks = [];

  socket.on("connect", () => {
    // Build a raw HTTP request — this is exactly what http.request() does internally
    const request = [
      "GET /api/hello?name=world HTTP/1.1",
      "Host: 127.0.0.1:" + port,
      "Accept: application/json",
      "Connection: close",
      "",  // Blank line signals end of headers
      "",  // No body for GET
    ].join("\r\n");

    console.log("Sending raw request:");
    console.log(request.split("\r\n").map(l => `  > ${l}`).join("\n"));
    console.log();

    socket.write(request);
  });

  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
  socket.on("error", reject);
});

console.log("Raw response received:");
console.log(rawResponse.split("\r\n").map(l => `  < ${l}`).join("\n"));

console.log("\n=== Parsing HTTP Response ===\n");

// Parse the raw response
const [headerSection, ...bodyParts] = rawResponse.split("\r\n\r\n");
const headerLines = headerSection.split("\r\n");
const statusLine = headerLines[0];
const headers = {};

for (const line of headerLines.slice(1)) {
  const colonIndex = line.indexOf(":");
  if (colonIndex > 0) {
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();
    headers[key] = value;
  }
}

const body = bodyParts.join("\r\n\r\n");

console.log("Status line:", statusLine);
console.log("Parsed headers:", headers);
console.log("Body:", body);
console.log("Parsed JSON:", JSON.parse(body));

console.log("\n=== HTTP Methods ===\n");

// Different HTTP methods
const methods = [
  { method: "GET", path: "/users", desc: "Read a resource" },
  { method: "POST", path: "/users", desc: "Create a resource" },
  { method: "PUT", path: "/users/1", desc: "Replace a resource" },
  { method: "PATCH", path: "/users/1", desc: "Update fields" },
  { method: "DELETE", path: "/users/1", desc: "Delete a resource" },
  { method: "HEAD", path: "/users", desc: "Like GET but no body" },
  { method: "OPTIONS", path: "/users", desc: "What methods are supported?" },
];

console.log("HTTP Methods:");
for (const { method, path, desc } of methods) {
  console.log(`  ${method.padEnd(7)} ${path.padEnd(10)} — ${desc}`);
}

console.log("\n=== Status Codes ===\n");

const statusCodes = [
  [200, "OK", "Request succeeded"],
  [201, "Created", "Resource created (POST)"],
  [204, "No Content", "Success, no body (DELETE)"],
  [301, "Moved Permanently", "Resource moved, update your URL"],
  [304, "Not Modified", "Use your cached copy"],
  [400, "Bad Request", "Client sent invalid data"],
  [401, "Unauthorized", "Authentication required"],
  [403, "Forbidden", "Authenticated but not allowed"],
  [404, "Not Found", "Resource doesn't exist"],
  [429, "Too Many Requests", "Rate limit exceeded"],
  [500, "Internal Server Error", "Server bug"],
  [502, "Bad Gateway", "Upstream server failed"],
  [503, "Service Unavailable", "Server overloaded or in maintenance"],
];

console.log("Important status codes:");
for (const [code, text, meaning] of statusCodes) {
  console.log(`  ${code} ${text.padEnd(22)} — ${meaning}`);
}

server.close();
console.log("\nServer closed");
```

## Expected Output

```
=== HTTP Server ===

Listening on http://127.0.0.1:<port>

=== Raw HTTP over TCP ===

Sending raw request:
  > GET /api/hello?name=world HTTP/1.1
  > Host: 127.0.0.1:<port>
  > Accept: application/json
  > Connection: close
  >
  >

[server] Request:
  Method: GET
  URL: /api/hello?name=world
  HTTP Version: 1.1
  Headers:
    host: 127.0.0.1:<port>
    accept: application/json
    connection: close

Raw response received:
  < HTTP/1.1 200 OK
  < Content-Type: application/json
  < X-Custom-Header: kata-demo
  < ...
  <
  < {"message":"Hello from Node.js!","path":"/api/hello?name=world","method":"GET"}

=== Parsing HTTP Response ===

Status line: HTTP/1.1 200 OK
Parsed headers: { ... }
Body: {"message":"Hello from Node.js!","path":"/api/hello?name=world","method":"GET"}
Parsed JSON: { message: 'Hello from Node.js!', ... }

...
```

## Challenge

1. Build a raw HTTP client that sends a POST request with a JSON body over TCP — set `Content-Length` and `Content-Type` correctly
2. What happens if `Content-Length` is wrong? Set it too short and too long — observe what happens
3. Implement chunked transfer encoding: send a response in multiple chunks without knowing the total size upfront

## Deep Dive

HTTP/1.1 vs HTTP/1.0:
- **HTTP/1.0**: One request per TCP connection. Open, request, response, close.
- **HTTP/1.1**: Keep-alive by default. Multiple requests share one connection. The `Connection: close` header tells the server to close after the response.

This is why HTTP/1.1 needs `Content-Length` or `Transfer-Encoding: chunked` — without them, the client doesn't know where one response ends and the next begins on the same connection. HTTP/1.0 could rely on the TCP connection closing to signal "end of response."

## Common Mistakes

- Forgetting `Content-Length` — the client doesn't know when the body ends, especially on keep-alive connections
- Using `\n` instead of `\r\n` — the HTTP spec requires CRLF. Most servers accept `\n`, but it's technically non-compliant
- Not handling `Transfer-Encoding: chunked` — many responses use chunked encoding instead of Content-Length
- Confusing 401 and 403 — 401 means "you're not authenticated" (log in), 403 means "you're authenticated but not authorized" (access denied)
