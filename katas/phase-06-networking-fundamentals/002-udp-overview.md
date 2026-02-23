---
id: udp-overview
phase: 6
phase_title: Networking Fundamentals
sequence: 2
title: UDP Overview
difficulty: intermediate
tags: [udp, dgram, datagrams, networking, connectionless]
prerequisites: [tcp-basics]
estimated_minutes: 12
---

## Concept

UDP (User Datagram Protocol) is TCP's lightweight sibling. Where TCP provides reliable, ordered delivery with connection management, UDP provides **none of that** — and that's its strength.

UDP properties:
- **Connectionless** — no handshake, no connection state
- **Unreliable** — packets can be lost, duplicated, or arrive out of order
- **Message-oriented** — each `send()` produces exactly one datagram. Unlike TCP, message boundaries are preserved
- **Low overhead** — no connection setup, no acknowledgments, no retransmission

Node.js exposes UDP through the `dgram` module. Use cases:
- **DNS** — fast lookups where retrying is cheaper than connection overhead
- **Video/audio streaming** — missing a frame is better than waiting for retransmission
- **Game networking** — position updates must be fast, slightly stale data is acceptable
- **Service discovery** — broadcast/multicast to find services on a network
- **Metrics/logging** — fire-and-forget telemetry (StatsD protocol)

## Key Insight

> UDP preserves message boundaries — if you send a 100-byte message, the receiver gets exactly one 100-byte message (or nothing at all). This is the opposite of TCP, where message boundaries are lost. Choose UDP when speed matters more than reliability, and when your application can handle lost or out-of-order messages.

## Experiment

```js
import { createSocket } from "dgram";

console.log("=== UDP Server and Client ===\n");

// Create a UDP server (receiver)
const server = createSocket("udp4");

const received = [];

server.on("message", (msg, rinfo) => {
  const text = msg.toString();
  received.push(text);
  console.log(`[server] Received "${text}" from ${rinfo.address}:${rinfo.port} (${rinfo.size} bytes)`);

  // Send a response back to the sender
  const reply = Buffer.from(`ACK: ${text}`);
  server.send(reply, rinfo.port, rinfo.address);
});

server.on("listening", () => {
  const addr = server.address();
  console.log(`[server] Listening on ${addr.address}:${addr.port}`);
});

// Bind to a random port
await new Promise((resolve) => {
  server.bind(0, "127.0.0.1", resolve);
});

const serverPort = server.address().port;

console.log("\n--- Sending messages ---\n");

// Create a UDP client (sender)
const client = createSocket("udp4");

// Bind client to receive responses
await new Promise((resolve) => {
  client.bind(0, "127.0.0.1", resolve);
});

const clientPort = client.address().port;
console.log(`[client] Bound to port ${clientPort}`);

// Send messages (fire and forget!)
const messages = ["Hello, UDP!", "Fast and light", "No connection needed"];

for (const msg of messages) {
  const buf = Buffer.from(msg);
  await new Promise((resolve, reject) => {
    client.send(buf, serverPort, "127.0.0.1", (err) => {
      if (err) reject(err);
      else {
        console.log(`[client] Sent: "${msg}" (${buf.length} bytes)`);
        resolve();
      }
    });
  });
}

// Collect responses
const responses = [];
await new Promise((resolve) => {
  client.on("message", (msg) => {
    responses.push(msg.toString());
    if (responses.length >= messages.length) resolve();
  });
  setTimeout(resolve, 500);  // Safety timeout
});

console.log("\n[client] Responses received:");
for (const r of responses) {
  console.log(`  ${r}`);
}

console.log("\n=== UDP vs TCP Comparison ===\n");

console.log("Feature          | TCP          | UDP");
console.log("-----------------|--------------|-------------");
console.log("Connection       | Required     | None");
console.log("Reliability      | Guaranteed   | Best effort");
console.log("Ordering         | Guaranteed   | No guarantee");
console.log("Message boundary | None (stream)| Preserved");
console.log("Overhead         | High (40B+)  | Low (8B)");
console.log("Speed            | Slower       | Faster");

console.log("\n=== Message Boundaries Preserved ===\n");

// Unlike TCP, each send() = exactly one message received
const boundaryServer = createSocket("udp4");
const boundaryMessages = [];

await new Promise(resolve => boundaryServer.bind(0, "127.0.0.1", resolve));
const bPort = boundaryServer.address().port;

boundaryServer.on("message", (msg) => {
  boundaryMessages.push(msg.toString());
});

const sender = createSocket("udp4");

// Send 5 messages rapidly
for (let i = 0; i < 5; i++) {
  await new Promise((resolve) => {
    sender.send(Buffer.from(`msg-${i}`), bPort, "127.0.0.1", resolve);
  });
}

await new Promise(r => setTimeout(r, 100));

console.log("Sent 5 separate messages");
console.log("Received", boundaryMessages.length, "separate messages:");
for (const m of boundaryMessages) {
  console.log(`  "${m}"`);
}
console.log("(Each message arrived as a distinct datagram)");

// Cleanup
client.close();
server.close();
sender.close();
boundaryServer.close();

console.log("\nAll sockets closed");
```

## Expected Output

```
=== UDP Server and Client ===

[server] Listening on 127.0.0.1:<port>

--- Sending messages ---

[client] Bound to port <port>
[client] Sent: "Hello, UDP!" (11 bytes)
[server] Received "Hello, UDP!" from 127.0.0.1:<port> (11 bytes)
[client] Sent: "Fast and light" (14 bytes)
[server] Received "Fast and light" from 127.0.0.1:<port> (14 bytes)
[client] Sent: "No connection needed" (20 bytes)
[server] Received "No connection needed" from 127.0.0.1:<port> (20 bytes)

[client] Responses received:
  ACK: Hello, UDP!
  ACK: Fast and light
  ACK: No connection needed

=== UDP vs TCP Comparison ===

...

=== Message Boundaries Preserved ===

Sent 5 separate messages
Received 5 separate messages:
  "msg-0"
  "msg-1"
  "msg-2"
  "msg-3"
  "msg-4"
(Each message arrived as a distinct datagram)

All sockets closed
```

## Challenge

1. Build a simple DNS-style lookup: client sends a hostname, server responds with an IP address from a hardcoded map. Measure round-trip time
2. Implement a basic reliability layer over UDP: sequence numbers, acknowledgments, and retransmission of lost messages
3. What is the maximum UDP datagram size? What happens if you exceed it? (Hint: MTU and fragmentation)

## Deep Dive

UDP datagram size limits:
- **Theoretical max**: 65,507 bytes (65,535 byte IP packet - 20 byte IP header - 8 byte UDP header)
- **Practical max without fragmentation**: ~1,472 bytes on Ethernet (1,500 byte MTU - 20 IP - 8 UDP)
- **Safe size**: 512 bytes (fits in any network without fragmentation)

When a datagram exceeds the network MTU, IP fragmentation occurs. If any fragment is lost, the entire datagram is lost. This is why DNS responses over 512 bytes switch to TCP.

## Common Mistakes

- Using UDP when you need reliability — you'll end up reimplementing TCP badly
- Not handling the case where `send()` errors — even "fire and forget" can fail (no route to host, socket closed)
- Assuming datagrams arrive in order — they might not, especially over the internet
- Sending datagrams larger than the MTU — causes fragmentation and increases the chance of packet loss
