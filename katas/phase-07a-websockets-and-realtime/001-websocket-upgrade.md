---
id: websocket-upgrade
phase: 7.5
phase_title: WebSockets & Real-Time Systems
sequence: 1
title: HTTP to WebSocket Upgrade
difficulty: intermediate
tags: [websocket, upgrade, handshake, http, real-time]
prerequisites: [http-protocol]
estimated_minutes: 15
---

## Concept

WebSocket is a protocol that provides full-duplex communication over a single TCP connection. Unlike HTTP's request-response model where the client always initiates, WebSocket lets both client and server send messages at any time.

A WebSocket connection starts as an HTTP request with an `Upgrade` header:

```
GET /ws HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

The server responds with `101 Switching Protocols`:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After this handshake, the TCP connection is no longer HTTP — it's a WebSocket connection. Both sides can now send binary or text frames at will.

The `Sec-WebSocket-Accept` value is computed from the client's `Sec-WebSocket-Key` by appending a magic GUID and taking the SHA-1 hash, encoded as base64. This proves the server understands the WebSocket protocol.

## Key Insight

> WebSocket reuses the HTTP port (80/443) and starts with an HTTP handshake, so it works through proxies and firewalls that allow HTTP. After the upgrade, the TCP connection becomes a bidirectional message channel — no more request-response, no more polling. The server can push data to the client the instant it's available.

## Experiment

```js
import { createServer } from "http";
import { createHash } from "crypto";

console.log("=== WebSocket Upgrade Handshake ===\n");

// The magic GUID from RFC 6455
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B711";

function computeAcceptKey(clientKey) {
  return createHash("sha1")
    .update(clientKey + WS_MAGIC_GUID)
    .digest("base64");
}

// Demonstrate the key computation
const exampleKey = "dGhlIHNhbXBsZSBub25jZQ==";
console.log("Client key:", exampleKey);
console.log("Magic GUID:", WS_MAGIC_GUID);
console.log("SHA-1 of concatenation:", computeAcceptKey(exampleKey));
console.log("(This is the value from the RFC example)\n");

// Build a minimal WebSocket server using raw HTTP
const server = createServer((req, res) => {
  // Regular HTTP requests
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("This is a regular HTTP endpoint\n");
});

// Handle WebSocket upgrade requests
server.on("upgrade", (req, socket, head) => {
  console.log("[server] Upgrade request received");
  console.log("  URL:", req.url);
  console.log("  Headers:");
  console.log("    Upgrade:", req.headers.upgrade);
  console.log("    Connection:", req.headers.connection);
  console.log("    Sec-WebSocket-Key:", req.headers["sec-websocket-key"]);
  console.log("    Sec-WebSocket-Version:", req.headers["sec-websocket-version"]);

  const clientKey = req.headers["sec-websocket-key"];
  if (!clientKey) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Compute the accept key
  const acceptKey = computeAcceptKey(clientKey);
  console.log("  Computed Accept:", acceptKey);

  // Send the 101 Switching Protocols response
  const response = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey}`,
    "",
    "",
  ].join("\r\n");

  socket.write(response);
  console.log("[server] Upgrade complete — connection is now WebSocket\n");

  // Now we have a raw TCP socket in WebSocket mode
  // We'd need to implement frame parsing (next kata)

  // For now, just demonstrate the raw socket is alive
  socket.on("data", (data) => {
    console.log("[server] Received raw bytes:", [...data.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join(' '));
  });

  // Send a close after a delay
  setTimeout(() => socket.destroy(), 500);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

console.log("=== Client Connection ===\n");

// Use Node.js built-in WebSocket (available since Node 22)
// First, connect with raw TCP to see the handshake
import { createConnection } from "net";

const rawSocket = createConnection({ host: "127.0.0.1", port });

await new Promise(resolve => rawSocket.on("connect", resolve));

// Send a WebSocket upgrade request manually
const key = Buffer.from("my-websocket-key!").toString("base64");
const upgradeRequest = [
  "GET /ws HTTP/1.1",
  `Host: 127.0.0.1:${port}`,
  "Upgrade: websocket",
  "Connection: Upgrade",
  `Sec-WebSocket-Key: ${key}`,
  "Sec-WebSocket-Version: 13",
  "",
  "",
].join("\r\n");

console.log("Sending upgrade request:");
console.log(upgradeRequest.split("\r\n").map(l => `  > ${l}`).join("\n"));

rawSocket.write(upgradeRequest);

// Read the response
const response = await new Promise(resolve => {
  rawSocket.once("data", (data) => resolve(data.toString()));
});

console.log("Received upgrade response:");
console.log(response.split("\r\n").map(l => `  < ${l}`).join("\n"));

// Verify the accept key
const expectedAccept = computeAcceptKey(key);
const responseAccept = response.match(/Sec-WebSocket-Accept: (.+)\r\n/)?.[1];
console.log("\nKey verification:");
console.log("  Expected:", expectedAccept);
console.log("  Received:", responseAccept);
console.log("  Valid:", expectedAccept === responseAccept);

rawSocket.destroy();

console.log("\n=== Why WebSocket? ===\n");

const comparison = [
  ["Feature", "HTTP Polling", "HTTP Long-Poll", "WebSocket"],
  ["Latency", "Poll interval", "~Instant", "Instant"],
  ["Direction", "Client→Server", "Server→Client", "Bidirectional"],
  ["Overhead", "Headers/request", "Headers/response", "2-14 bytes/frame"],
  ["Server push", "No", "One response", "Unlimited"],
  ["Connection", "New each time", "Held open", "Persistent"],
];

for (const row of comparison) {
  console.log(`  ${row.map(c => c.padEnd(16)).join("| ")}`);
  if (row[0] === "Feature") {
    console.log("  " + "-".repeat(70));
  }
}

await new Promise(r => setTimeout(r, 600));
server.close();
console.log("\nDone");
```

## Expected Output

```
=== WebSocket Upgrade Handshake ===

Client key: dGhlIHNhbXBsZSBub25jZQ==
Magic GUID: 258EAFA5-E914-47DA-95CA-5AB0DC85B711
SHA-1 of concatenation: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
(This is the value from the RFC example)

[server] Upgrade request received
  URL: /ws
  Headers:
    Upgrade: websocket
    Connection: Upgrade
    Sec-WebSocket-Key: <base64 key>
    Sec-WebSocket-Version: 13
  Computed Accept: <base64 hash>
[server] Upgrade complete — connection is now WebSocket

=== Client Connection ===

Sending upgrade request:
  > GET /ws HTTP/1.1
  > ...

Received upgrade response:
  < HTTP/1.1 101 Switching Protocols
  < Upgrade: websocket
  < Connection: Upgrade
  < Sec-WebSocket-Accept: <hash>

Key verification:
  Expected: <hash>
  Received: <hash>
  Valid: true

=== Why WebSocket? ===

  ...comparison table...
```

## Challenge

1. What happens if the client sends a wrong `Sec-WebSocket-Version` (not 13)? The server should respond with `426 Upgrade Required` and include `Sec-WebSocket-Version: 13` in the response
2. Implement WebSocket subprotocol negotiation: the client sends `Sec-WebSocket-Protocol: chat, json` and the server picks one and includes it in the response
3. Why does the WebSocket handshake use a SHA-1 hash of the key instead of just echoing the key back? What attack does this prevent?

## Deep Dive

Why the `Sec-WebSocket-Key` / `Sec-WebSocket-Accept` handshake exists:

It's NOT for security or authentication. It serves two purposes:
1. **Proof of intent** — confirms the server actually understands WebSocket, not just forwarding random HTTP headers
2. **Cache prevention** — ensures intermediary proxies don't cache the upgrade response and serve it to other clients

The `Sec-` prefix on headers means "this header cannot be set by JavaScript in a browser." It prevents a webpage from crafting a fake WebSocket upgrade via `fetch()`.

## Common Mistakes

- Trying to use WebSocket without the HTTP upgrade handshake — the protocol requires starting as HTTP
- Forgetting the `Connection: Upgrade` header alongside `Upgrade: websocket` — both are required
- Not validating `Sec-WebSocket-Version: 13` — current WebSocket protocol version, reject others
- Confusing WebSocket with Server-Sent Events (SSE) — SSE is server-to-client only, over regular HTTP, simpler but less capable
