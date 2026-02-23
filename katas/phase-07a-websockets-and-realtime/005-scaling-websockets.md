---
id: scaling-websockets
phase: 7.5
phase_title: WebSockets & Real-Time Systems
sequence: 5
title: Scaling WebSockets
difficulty: advanced
tags: [websocket, scaling, pub-sub, backpressure, sticky-sessions]
prerequisites: [realtime-state]
estimated_minutes: 15
---

## Concept

A single Node.js process can handle tens of thousands of concurrent WebSocket connections. But eventually you need multiple processes or servers. This introduces the core scaling challenge: **clients connected to different servers can't see each other's messages.**

Scaling strategies:

1. **Vertical scaling** — bigger server, more connections per process. Optimize memory per connection
2. **Sticky sessions** — a load balancer ensures the same client always reaches the same server. Simple but limits failover
3. **Pub/Sub backbone** — servers publish messages to a shared channel (Redis, NATS, Kafka). All servers subscribe and forward to their local clients
4. **Shared-nothing + routing** — each server owns a partition of rooms/users. Route connections to the right server

The pub/sub backbone is the most common approach. Redis Pub/Sub or a message broker acts as the glue between servers:

```
Client A → Server 1 → Redis Pub/Sub → Server 2 → Client B
```

## Key Insight

> WebSocket connections are stateful — they can't be load-balanced like HTTP requests. If Alice is connected to Server 1 and Bob to Server 2, a message from Alice to Bob must cross the server boundary. A pub/sub backbone (Redis, NATS) solves this: each server publishes to the backbone and subscribes for updates, making multi-server WebSocket systems work seamlessly.

## Experiment

```js
import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { EventEmitter } from "events";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B711";

function encodeFrame(data, opcode = 0x01) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  const headerSize = len < 126 ? 2 : (len < 65536 ? 4 : 10);
  const frame = Buffer.alloc(headerSize + len);
  frame[0] = 0x80 | opcode;
  if (len < 126) frame[1] = len;
  else if (len < 65536) { frame[1] = 126; frame.writeUInt16BE(len, 2); }
  else { frame[1] = 127; frame.writeUInt32BE(0, 2); frame.writeUInt32BE(len, 6); }
  payload.copy(frame, headerSize);
  return frame;
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0F;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7F;
  let offset = 2;
  if (payloadLen === 126) { payloadLen = buffer.readUInt16BE(2); offset = 4; }
  else if (payloadLen === 127) { payloadLen = buffer.readUInt32BE(6); offset = 10; }
  let maskKey = null;
  if (masked) { maskKey = buffer.slice(offset, offset + 4); offset += 4; }
  if (buffer.length < offset + payloadLen) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + payloadLen));
  if (masked && maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  return { opcode, payload, totalLength: offset + payloadLen };
}

// --- In-Process Pub/Sub (simulates Redis Pub/Sub) ---

class PubSubBroker extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
  }

  subscribe(channel, callback) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel).add(callback);
  }

  unsubscribe(channel, callback) {
    const subs = this.channels.get(channel);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) this.channels.delete(channel);
    }
  }

  publish(channel, message) {
    const subs = this.channels.get(channel);
    if (subs) {
      for (const cb of subs) {
        cb(message);
      }
    }
  }
}

// --- Scalable WebSocket Server ---

class ScalableWSServer {
  constructor(name, broker) {
    this.name = name;
    this.broker = broker;
    this.localClients = new Set();
    this.subscriptions = new Map();
  }

  addClient(socket) {
    const client = {
      id: randomBytes(4).toString("hex"),
      socket,
      name: null,
      rooms: new Set(),
      buffer: Buffer.alloc(0),
    };

    this.localClients.add(client);

    const send = (data) => socket.write(encodeFrame(JSON.stringify(data)));
    send({ type: "connected", server: this.name, id: client.id });

    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length > 0) {
        const frame = decodeFrame(client.buffer);
        if (!frame) break;
        client.buffer = client.buffer.slice(frame.totalLength);
        if (frame.opcode === 0x01) {
          const msg = JSON.parse(frame.payload.toString());
          this.handleMessage(client, msg);
        } else if (frame.opcode === 0x08) {
          socket.end();
          return;
        }
      }
    });

    socket.on("close", () => this.removeClient(client));
    socket.on("error", () => this.removeClient(client));

    return client;
  }

  handleMessage(client, msg) {
    switch (msg.type) {
      case "set_name":
        client.name = msg.name;
        break;

      case "join": {
        client.rooms.add(msg.room);

        // Subscribe to the pub/sub channel for this room
        const channel = `room:${msg.room}`;
        if (!this.subscriptions.has(channel)) {
          const handler = (data) => this.deliverToLocalClients(msg.room, data);
          this.broker.subscribe(channel, handler);
          this.subscriptions.set(channel, handler);
        }

        // Publish join event through the backbone
        this.broker.publish(channel, JSON.stringify({
          type: "user_joined",
          room: msg.room,
          user: client.name || client.id,
          server: this.name,
        }));
        break;
      }

      case "message": {
        const channel = `room:${msg.room}`;
        // Publish through the backbone — ALL servers receive this
        this.broker.publish(channel, JSON.stringify({
          type: "message",
          room: msg.room,
          from: client.name || client.id,
          text: msg.text,
          server: this.name,
          timestamp: Date.now(),
        }));
        break;
      }
    }
  }

  deliverToLocalClients(room, rawMessage) {
    const message = JSON.parse(rawMessage);
    const frame = encodeFrame(rawMessage);

    for (const client of this.localClients) {
      if (client.rooms.has(room)) {
        client.socket.write(frame);
      }
    }
  }

  removeClient(client) {
    for (const room of client.rooms) {
      this.broker.publish(`room:${room}`, JSON.stringify({
        type: "user_left",
        room,
        user: client.name || client.id,
        server: this.name,
      }));
    }
    this.localClients.delete(client);
  }

  getStats() {
    return {
      server: this.name,
      localClients: this.localClients.size,
      subscriptions: this.subscriptions.size,
    };
  }
}

// --- Demo: Two Servers Sharing a Pub/Sub Backbone ---

console.log("=== Scaling WebSockets with Pub/Sub ===\n");

const broker = new PubSubBroker();

// Create two WebSocket servers (simulating separate processes/machines)
function createWSServer(name) {
  const wsServer = new ScalableWSServer(name, broker);
  const httpServer = createServer();

  httpServer.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + WS_MAGIC_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    wsServer.addClient(socket);
  });

  return { wsServer, httpServer };
}

const server1 = createWSServer("Server-1");
const server2 = createWSServer("Server-2");

await new Promise(resolve => server1.httpServer.listen(0, "127.0.0.1", resolve));
await new Promise(resolve => server2.httpServer.listen(0, "127.0.0.1", resolve));

const port1 = server1.httpServer.address().port;
const port2 = server2.httpServer.address().port;

console.log(`Server-1 on port ${port1}`);
console.log(`Server-2 on port ${port2}`);

// Connect clients to DIFFERENT servers
async function connect(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  await new Promise(resolve => { ws.onopen = resolve; });
  ws.onmessage = (e) => messages.push(JSON.parse(e.data));
  await new Promise(r => setTimeout(r, 50));
  ws.send(JSON.stringify({ type: "set_name", name }));
  await new Promise(r => setTimeout(r, 50));
  return { ws, messages, name };
}

// Alice → Server 1, Bob → Server 2
const alice = await connect(port1, "Alice");
const bob = await connect(port2, "Bob");

console.log("\nAlice connected to Server-1");
console.log("Bob connected to Server-2");

// Both join the same room
alice.ws.send(JSON.stringify({ type: "join", room: "general" }));
bob.ws.send(JSON.stringify({ type: "join", room: "general" }));
await new Promise(r => setTimeout(r, 100));

console.log("\nBoth joined #general\n");

// Alice sends a message — Bob should receive it (via pub/sub backbone)
alice.ws.send(JSON.stringify({ type: "message", room: "general", text: "Hello from Server-1!" }));
await new Promise(r => setTimeout(r, 100));

bob.ws.send(JSON.stringify({ type: "message", room: "general", text: "Hello from Server-2!" }));
await new Promise(r => setTimeout(r, 100));

// Check what each received
const aliceChat = alice.messages.filter(m => m.type === "message");
const bobChat = bob.messages.filter(m => m.type === "message");

console.log("Alice (Server-1) received:");
for (const m of aliceChat) {
  console.log(`  [${m.server}] ${m.from}: ${m.text}`);
}

console.log("\nBob (Server-2) received:");
for (const m of bobChat) {
  console.log(`  [${m.server}] ${m.from}: ${m.text}`);
}

console.log("\n=== Server Stats ===\n");
console.log("Server-1:", server1.wsServer.getStats());
console.log("Server-2:", server2.wsServer.getStats());

console.log("\n=== Connection Capacity Planning ===\n");

const memPerConnection = 5;  // ~5 KB per idle WebSocket connection
const scenarios = [1000, 10000, 50000, 100000];

console.log("Estimated memory for idle WebSocket connections:");
for (const n of scenarios) {
  const memMB = (n * memPerConnection / 1024).toFixed(0);
  console.log(`  ${String(n).padStart(7)} connections → ~${memMB} MB`);
}

// Clean up
alice.ws.close();
bob.ws.close();
await new Promise(r => setTimeout(r, 100));
server1.httpServer.close();
server2.httpServer.close();

console.log("\nDone");
```

## Expected Output

```
=== Scaling WebSockets with Pub/Sub ===

Server-1 on port <port>
Server-2 on port <port>

Alice connected to Server-1
Bob connected to Server-2

Both joined #general

Alice (Server-1) received:
  [Server-1] Alice: Hello from Server-1!
  [Server-2] Bob: Hello from Server-2!

Bob (Server-2) received:
  [Server-1] Alice: Hello from Server-1!
  [Server-2] Bob: Hello from Server-2!

=== Server Stats ===

Server-1: { server: 'Server-1', localClients: 1, subscriptions: 1 }
Server-2: { server: 'Server-2', localClients: 1, subscriptions: 1 }

=== Connection Capacity Planning ===

Estimated memory for idle WebSocket connections:
     1000 connections → ~5 MB
    10000 connections → ~49 MB
    50000 connections → ~244 MB
   100000 connections → ~488 MB
```

## Challenge

1. Replace the in-process `PubSubBroker` with a real Redis Pub/Sub connection. Two separate Node.js processes should be able to relay messages between their clients
2. Implement backpressure for slow clients: if a client's socket buffer exceeds a threshold, queue messages in memory up to a limit, then disconnect the slow client
3. Add presence tracking: maintain a distributed set of who's online across all servers using Redis

## Deep Dive

Scaling approaches compared:

| Approach | Complexity | Latency | Failover |
|----------|-----------|---------|----------|
| Single server | Low | Lowest | None |
| Sticky sessions | Low | Low | Session lost |
| Redis Pub/Sub | Medium | +1ms | Reconnect to any |
| NATS/Kafka | High | +1-5ms | Seamless |

Memory per connection matters at scale. An idle WebSocket with `ws` library uses ~2-5 KB. With application state (user data, room membership), budget 10-50 KB per connection. At 100K connections, that's 1-5 GB of RAM just for connection state.

## Common Mistakes

- Publishing messages to the backbone AND to local clients — double delivery. Publish once to the backbone; let the subscription handler deliver locally
- Not unsubscribing from channels when the last local client leaves a room — leaked subscriptions consume broker resources
- Assuming message ordering across servers — pub/sub may deliver out of order. Include timestamps for ordering
- Not handling broker disconnections — if Redis goes down, your pub/sub backbone breaks. Implement reconnection logic
