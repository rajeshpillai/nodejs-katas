---
id: tcp-basics
phase: 6
phase_title: Networking Fundamentals
sequence: 1
title: TCP Basics with the net Module
difficulty: intermediate
tags: [tcp, net, sockets, networking, server]
prerequisites: [readable-streams]
estimated_minutes: 15
---

## Concept

TCP (Transmission Control Protocol) is the foundation of most internet communication. HTTP, WebSockets, databases, email — they all run over TCP. Node.js exposes TCP through the `net` module.

A TCP connection is a **bidirectional byte stream** between two endpoints. Key properties:

- **Reliable** — bytes arrive in order, none are lost (retransmission handles packet loss)
- **Connection-oriented** — a three-way handshake (SYN, SYN-ACK, ACK) establishes the connection before data flows
- **Stream-based** — there are no message boundaries. If you send "Hello" then "World", the receiver might get "HelloWorld" or "Hel" then "loWorld"

The `net` module gives you:
- `net.createServer()` — create a TCP server that accepts connections
- `net.createConnection()` — connect to a TCP server as a client
- Each connection is a `Duplex` stream (both Readable and Writable)

## Key Insight

> TCP is a byte stream, not a message stream. There are no built-in message boundaries. If you send two 100-byte messages, the receiver might get one 200-byte chunk, or five 40-byte chunks, or any other combination. You must implement your own framing (length-prefix, delimiters, etc.) to know where one message ends and the next begins.

## Experiment

```js
import { createServer, createConnection } from "net";

console.log("=== TCP Server and Client ===\n");

// Create a TCP server
const server = createServer((socket) => {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[server] Client connected: ${addr}`);

  // socket is a Duplex stream — both readable and writable
  socket.on("data", (data) => {
    console.log(`[server] Received from ${addr}: ${data.toString().trim()}`);
    // Echo back with transformation
    socket.write(`Echo: ${data.toString().toUpperCase()}`);
  });

  socket.on("end", () => {
    console.log(`[server] Client disconnected: ${addr}`);
  });

  socket.on("error", (err) => {
    console.log(`[server] Socket error: ${err.message}`);
  });
});

// Start listening
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    console.log(`[server] Listening on 127.0.0.1:${port}`);
    resolve();
  });
});

const { port } = server.address();

console.log("\n--- Client connecting ---\n");

// Create a TCP client
const client = createConnection({ host: "127.0.0.1", port });

await new Promise((resolve) => {
  client.on("connect", () => {
    console.log("[client] Connected to server");
    resolve();
  });
});

// Send messages
client.write("Hello, TCP!\n");
client.write("Streams are powerful\n");

// Read responses
let responseCount = 0;
await new Promise((resolve) => {
  client.on("data", (data) => {
    console.log(`[client] Response: ${data.toString().trim()}`);
    responseCount++;
    if (responseCount >= 2) resolve();
  });
  // Safety timeout
  setTimeout(resolve, 500);
});

console.log("\n=== Socket Properties ===\n");

console.log("[client] localAddress:", client.localAddress);
console.log("[client] localPort:", client.localPort);
console.log("[client] remoteAddress:", client.remoteAddress);
console.log("[client] remotePort:", client.remotePort);
console.log("[client] bytesWritten:", client.bytesWritten);
console.log("[client] bytesRead:", client.bytesRead);

console.log("\n=== Server Properties ===\n");

console.log("[server] address:", server.address());
console.log("[server] listening:", server.listening);

// Show active connections
server.getConnections((err, count) => {
  if (!err) console.log("[server] Active connections:", count);
});

await new Promise(r => setTimeout(r, 50));

// Clean shutdown
console.log("\n--- Shutting down ---\n");

client.end();  // Gracefully close client side

await new Promise((resolve) => {
  client.on("close", () => {
    console.log("[client] Connection closed");
    resolve();
  });
});

server.close(() => {
  console.log("[server] Server closed");
});

await new Promise(r => setTimeout(r, 50));
```

## Expected Output

```
=== TCP Server and Client ===

[server] Listening on 127.0.0.1:<port>

--- Client connecting ---

[client] Connected to server
[server] Client connected: 127.0.0.1:<port>
[server] Received from 127.0.0.1:<port>: Hello, TCP!
[client] Response: Echo: HELLO, TCP!
[server] Received from 127.0.0.1:<port>: Streams are powerful
[client] Response: Echo: STREAMS ARE POWERFUL

=== Socket Properties ===

[client] localAddress: 127.0.0.1
[client] localPort: <port>
[client] remoteAddress: 127.0.0.1
[client] remotePort: <port>
[client] bytesWritten: <number>
[client] bytesRead: <number>

=== Server Properties ===

[server] address: { address: '127.0.0.1', family: 'IPv4', port: <port> }
[server] listening: true
[server] Active connections: 1

--- Shutting down ---

[server] Client disconnected: 127.0.0.1:<port>
[client] Connection closed
[server] Server closed
```

## Challenge

1. Build a TCP chat server — multiple clients connect, and any message from one client is broadcast to all others
2. What happens if the server crashes while clients are connected? What events fire on the client socket?
3. Connect a TCP client to a non-existent server — observe the error and implement retry logic with exponential backoff

## Deep Dive

TCP socket lifecycle events in order:
1. `'connect'` — connection established (client only)
2. `'data'` — data received (zero or more times)
3. `'end'` — other side called `socket.end()` (half-close)
4. `'close'` — socket fully closed (after both sides close)
5. `'error'` — an error occurred (always followed by `'close'`)

The `'end'` event represents a TCP half-close — one side is done sending but can still receive. This is used in HTTP to signal "I'm done sending the request, waiting for your response."

## Common Mistakes

- Assuming each `write()` produces one `'data'` event — TCP can coalesce or split writes. You need framing
- Not handling `'error'` on sockets — unhandled errors crash the process
- Using `socket.destroy()` instead of `socket.end()` — `destroy()` is abrupt (RST packet), `end()` is graceful (FIN packet)
- Forgetting to handle the case where `server.listen()` fails — port already in use is a common production error
