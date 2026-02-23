---
id: socket-lifecycle
phase: 6
phase_title: Networking Fundamentals
sequence: 3
title: Socket Lifecycle
difficulty: intermediate
tags: [tcp, sockets, lifecycle, events, half-close, state]
prerequisites: [tcp-basics]
estimated_minutes: 15
---

## Concept

A TCP socket goes through a well-defined lifecycle. Understanding these states is essential for building reliable network applications — especially for handling graceful shutdowns, detecting dead connections, and debugging network issues.

The socket lifecycle:

1. **Created** — `new net.Socket()` or from `createConnection()`
2. **Connecting** — TCP three-way handshake in progress
3. **Connected** — data can flow in both directions
4. **Half-closed** — one side called `end()`, can still receive from the other side
5. **Closed** — both sides done, resources released

Key events in order:
- `'lookup'` — DNS resolved (if connecting by hostname)
- `'connect'` — TCP handshake complete
- `'ready'` — socket is fully ready
- `'data'` — data received (zero or more)
- `'end'` — remote side called `end()` (FIN received)
- `'close'` — socket fully closed
- `'error'` — error occurred (always before `'close'`)

The half-close mechanism is powerful: a client can say "I'm done sending" (`end()`) while still receiving the server's response. HTTP/1.1 uses this — the client sends the request and calls `end()`, then reads the response.

## Key Insight

> A socket's `'end'` event means the other side is done *sending*, not that the connection is closed. You can still write to the socket after receiving `'end'`. This half-close design enables request-response protocols: send a request, signal "done sending," then read the response. Call `socket.end()` when *you're* done — only `'close'` means the connection is truly finished.

## Experiment

```js
import { createServer, createConnection } from "net";

console.log("=== Socket Lifecycle Events ===\n");

const serverEvents = [];
const clientEvents = [];

const server = createServer((socket) => {
  const log = (event, detail = "") => {
    const msg = `[server-socket] ${event}${detail ? ": " + detail : ""}`;
    serverEvents.push(event);
    console.log(msg);
  };

  log("connection", `from ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on("data", (data) => log("data", `"${data.toString().trim()}"`));
  socket.on("end", () => {
    log("end", "client finished sending");
    // Half-close: we can still send!
    socket.write("Server's final message\n");
    socket.end();  // Now we're done too
  });
  socket.on("close", (hadError) => log("close", `hadError=${hadError}`));
  socket.on("error", (err) => log("error", err.message));
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

// Client with event tracking
const client = createConnection({ host: "127.0.0.1", port });

const clientLog = (event, detail = "") => {
  const msg = `[client] ${event}${detail ? ": " + detail : ""}`;
  clientEvents.push(event);
  console.log(msg);
};

client.on("lookup", (err, address, family) => clientLog("lookup", `${address} (IPv${family})`));
client.on("connect", () => clientLog("connect"));
client.on("ready", () => clientLog("ready"));
client.on("data", (data) => clientLog("data", `"${data.toString().trim()}"`));
client.on("end", () => clientLog("end", "server finished sending"));
client.on("close", (hadError) => clientLog("close", `hadError=${hadError}`));
client.on("error", (err) => clientLog("error", err.message));

// Wait for connection
await new Promise(resolve => client.on("connect", resolve));

// Send data then half-close
client.write("Hello from client\n");

// Small delay to see the response
await new Promise(r => setTimeout(r, 50));

// Client signals "done sending"
client.end();

// Wait for full close
await new Promise(resolve => client.on("close", resolve));

console.log("\n=== Event Summary ===\n");
console.log("Client events:", clientEvents.join(" → "));
console.log("Server events:", serverEvents.join(" → "));

server.close();
await new Promise(r => setTimeout(r, 50));

console.log("\n=== Half-Close Demonstration ===\n");

const server2 = createServer(async (socket) => {
  // Read all data first (until client calls end())
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));

  await new Promise(resolve => socket.on("end", resolve));
  const request = Buffer.concat(chunks).toString();

  console.log("[server2] Full request received:", JSON.stringify(request.trim()));

  // Process and respond (client already called end() but is still listening)
  const response = `Processed: ${request.trim().toUpperCase()}`;
  socket.write(response);
  socket.end();
});

await new Promise(resolve => server2.listen(0, "127.0.0.1", resolve));
const port2 = server2.address().port;

const client2 = createConnection({ host: "127.0.0.1", port: port2 });
await new Promise(resolve => client2.on("connect", resolve));

// Send request data in multiple chunks
client2.write("hello ");
client2.write("world");
client2.end();  // Signal "done sending"

// Read the response (still possible after end())
const response = await new Promise((resolve) => {
  const chunks = [];
  client2.on("data", (chunk) => chunks.push(chunk));
  client2.on("end", () => resolve(Buffer.concat(chunks).toString()));
});

console.log("[client2] Response:", response);

await new Promise(resolve => client2.on("close", resolve));
server2.close();

console.log("\n=== Detecting Dead Connections ===\n");

const server3 = createServer((socket) => {
  // Enable keep-alive to detect dead connections
  socket.setKeepAlive(true, 1000);

  // Set a timeout for inactivity
  socket.setTimeout(2000);

  socket.on("timeout", () => {
    console.log("[server3] Socket timed out (no data for 2s)");
    socket.end("Timeout: closing connection\n");
  });

  socket.on("data", (data) => {
    console.log("[server3] Data:", data.toString().trim());
    socket.write("OK\n");
  });

  socket.on("close", () => console.log("[server3] Connection closed"));
});

await new Promise(resolve => server3.listen(0, "127.0.0.1", resolve));
const port3 = server3.address().port;

const client3 = createConnection({ host: "127.0.0.1", port: port3 });
await new Promise(resolve => client3.on("connect", resolve));

client3.write("ping\n");
await new Promise(r => setTimeout(r, 100));

// Collect timeout message
client3.on("data", (data) => {
  console.log("[client3] Received:", data.toString().trim());
});

// Wait for timeout
console.log("[client3] Waiting for server timeout...");
await new Promise(resolve => client3.on("close", resolve));

server3.close();
console.log("\nDone");
```

## Expected Output

```
=== Socket Lifecycle Events ===

[client] lookup: 127.0.0.1 (IPv4)
[client] connect
[client] ready
[server-socket] connection: from 127.0.0.1:<port>
[server-socket] data: "Hello from client"
[server-socket] end: client finished sending
[client] data: "Server's final message"
[client] end: server finished sending
[server-socket] close: hadError=false
[client] close: hadError=false

=== Event Summary ===

Client events: lookup → connect → ready → data → end → close
Server events: connection → data → end → close

=== Half-Close Demonstration ===

[server2] Full request received: "hello world"
[client2] Response: Processed: HELLO WORLD

=== Detecting Dead Connections ===

[server3] Data: ping
[client3] Received: OK
[client3] Waiting for server timeout...
[server3] Socket timed out (no data for 2s)
[client3] Received: Timeout: closing connection
[server3] Connection closed

Done
```

## Challenge

1. Build a connection that detects if the remote side crashes (vs cleanly disconnects). What's the difference between `'end'` and `'error'` + `'close'`?
2. Implement a connection pool: maintain N pre-connected sockets to a server, reuse them for requests, and replace broken connections
3. What does `socket.setNoDelay(true)` do? When would you want to disable Nagle's algorithm?

## Deep Dive

TCP's half-close (FIN) mechanism:
- When you call `socket.end()`, Node.js sends a TCP FIN packet
- The other side receives the `'end'` event
- But the connection is still half-open — the other side can still send data
- When the other side also calls `end()`, a second FIN is sent
- After both FINs and their ACKs, the connection enters TIME_WAIT (typically 2 minutes on Linux)

`socket.destroy()` skips the graceful shutdown and sends a TCP RST (reset), immediately terminating the connection. The other side gets an `ECONNRESET` error.

## Common Mistakes

- Not distinguishing `'end'` from `'close'` — `'end'` means the remote stopped sending, `'close'` means the socket is fully done
- Forgetting to handle `'error'` before `'close'` — errors always precede close, and unhandled errors crash the process
- Not setting timeouts — a socket with no timeout and no keep-alive can hang forever if the network goes down
- Writing to a socket after it's ended — causes an `ERR_STREAM_WRITE_AFTER_END` error
