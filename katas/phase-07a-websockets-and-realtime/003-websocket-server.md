---
id: websocket-server
phase: 7.5
phase_title: WebSockets & Real-Time Systems
sequence: 3
title: Building a WebSocket Server
difficulty: advanced
tags: [websocket, server, real-time, connections, messaging]
prerequisites: [websocket-framing]
estimated_minutes: 20
---

## Concept

A production WebSocket server handles the complete lifecycle: upgrade handshake, frame parsing, message dispatch, connection tracking, ping/pong heartbeats, and graceful shutdown.

Building on the frame encoder/decoder from the previous kata, we'll construct a minimal but functional WebSocket server from scratch — no libraries. This teaches you exactly what `ws` or `socket.io` do under the hood.

The server must:
1. Accept HTTP upgrade requests and complete the WebSocket handshake
2. Parse incoming frames (handling masking, control frames, fragmentation)
3. Send frames to connected clients
4. Track active connections
5. Handle disconnections and errors gracefully

## Key Insight

> A WebSocket server is an event-driven state machine. Each connection tracks its own state (handshaking, open, closing, closed), buffers partial frames, and responds to control messages. The server's job is to manage many of these state machines concurrently — and Node.js's event loop makes this natural.

## Experiment

```js
import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { connect as tcpConnect } from "net";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B711";

// --- Frame utilities (from previous kata) ---

function encodeFrame(data, opcode = 0x01) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let headerSize = len < 126 ? 2 : (len < 65536 ? 4 : 10);
  const frame = Buffer.alloc(headerSize + len);
  frame[0] = 0x80 | opcode;
  if (len < 126) {
    frame[1] = len;
  } else if (len < 65536) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
  }
  payload.copy(frame, headerSize);
  return frame;
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0F;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7F;
  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = buffer.readUInt32BE(6);
    offset = 10;
  }
  let maskKey = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + payloadLen) return null;
  let payload = Buffer.from(buffer.slice(offset, offset + payloadLen));
  if (masked && maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }
  return { fin, opcode, masked, payloadLength: payloadLen, payload, totalLength: offset + payloadLen };
}

// --- WebSocket Server ---

class WebSocketServer {
  constructor(httpServer) {
    this.clients = new Set();
    this.httpServer = httpServer;

    httpServer.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket);
    });
  }

  handleUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = createHash("sha1")
      .update(key + WS_MAGIC_GUID)
      .digest("base64");

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "", "",
    ].join("\r\n"));

    // Create client connection object
    const client = {
      socket,
      id: randomBytes(4).toString("hex"),
      buffer: Buffer.alloc(0),
      alive: true,
    };

    this.clients.add(client);
    console.log(`[ws] Client ${client.id} connected (${this.clients.size} total)`);

    // Send welcome message
    socket.write(encodeFrame(JSON.stringify({
      type: "welcome",
      id: client.id,
      clients: this.clients.size,
    })));

    // Handle incoming data
    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      this.processFrames(client);
    });

    socket.on("close", () => {
      this.clients.delete(client);
      console.log(`[ws] Client ${client.id} disconnected (${this.clients.size} total)`);
    });

    socket.on("error", (err) => {
      console.log(`[ws] Client ${client.id} error: ${err.message}`);
      this.clients.delete(client);
    });
  }

  processFrames(client) {
    while (client.buffer.length > 0) {
      const frame = decodeFrame(client.buffer);
      if (!frame) break;  // Incomplete frame

      client.buffer = client.buffer.slice(frame.totalLength);

      switch (frame.opcode) {
        case 0x01:  // Text
        case 0x02:  // Binary
          this.onMessage(client, frame.payload.toString(), frame.opcode);
          break;
        case 0x08:  // Close
          this.onClose(client, frame.payload);
          break;
        case 0x09:  // Ping
          client.socket.write(encodeFrame(frame.payload, 0x0A));  // Pong
          break;
        case 0x0A:  // Pong
          client.alive = true;
          break;
      }
    }
  }

  onMessage(client, message, opcode) {
    console.log(`[ws] Message from ${client.id}: ${message}`);

    // Echo back to sender
    try {
      const data = JSON.parse(message);
      if (data.type === "broadcast") {
        this.broadcast(JSON.stringify({
          type: "broadcast",
          from: client.id,
          message: data.message,
        }), client);
      } else {
        client.socket.write(encodeFrame(JSON.stringify({
          type: "echo",
          original: data,
        })));
      }
    } catch {
      client.socket.write(encodeFrame(JSON.stringify({
        type: "echo",
        original: message,
      })));
    }
  }

  onClose(client, payload) {
    const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
    const reason = payload.length > 2 ? payload.slice(2).toString() : "";
    console.log(`[ws] Close from ${client.id}: code=${code} reason="${reason}"`);

    // Send close response
    const closePayload = Buffer.alloc(2);
    closePayload.writeUInt16BE(1000, 0);
    client.socket.write(encodeFrame(closePayload, 0x08));
    client.socket.end();
  }

  broadcast(message, exclude = null) {
    const frame = encodeFrame(message);
    for (const client of this.clients) {
      if (client !== exclude) {
        client.socket.write(frame);
      }
    }
  }

  // Ping all clients to detect dead connections
  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) {
        console.log(`[ws] Client ${client.id} failed heartbeat — disconnecting`);
        client.socket.destroy();
        this.clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.write(encodeFrame("ping", 0x09));
    }
  }
}

// --- Demo ---

console.log("=== WebSocket Server Demo ===\n");

const httpServer = createServer((req, res) => {
  res.writeHead(200).end("HTTP endpoint\n");
});

await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
const { port } = httpServer.address();

const wsServer = new WebSocketServer(httpServer);

// Start heartbeat
const heartbeatInterval = setInterval(() => wsServer.heartbeat(), 5000);

// Build a tiny WebSocket client over raw TCP, using the same frame helpers.
// Client frames must be masked per RFC 6455.
function maskFrame(data, opcode = 0x01) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  const mask = randomBytes(4);
  const headerSize = len < 126 ? 2 : (len < 65536 ? 4 : 10);
  const frame = Buffer.alloc(headerSize + 4 + len);
  frame[0] = 0x80 | opcode;
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
  }
  mask.copy(frame, headerSize);
  for (let i = 0; i < len; i++) {
    frame[headerSize + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return frame;
}

async function connectClient(name) {
  return new Promise((resolve, reject) => {
    const sock = tcpConnect(port, "127.0.0.1");
    const messages = [];
    let buffer = Buffer.alloc(0);
    let handshakeDone = false;
    let resolved = false;

    const client = {
      name,
      messages,
      send(text) { sock.write(maskFrame(text)); },
      close(code = 1000, reason = "Done") {
        const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
        payload.writeUInt16BE(code, 0);
        payload.write(reason, 2);
        sock.write(maskFrame(payload, 0x08));
        setTimeout(() => sock.end(), 10);
      },
    };

    sock.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      sock.write(
        "GET / HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    sock.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const idx = buffer.indexOf("\r\n\r\n");
        if (idx === -1) return;
        buffer = buffer.slice(idx + 4);
        handshakeDone = true;
        console.log(`[${name}] Connected`);
        if (!resolved) { resolved = true; resolve(client); }
      }
      while (handshakeDone) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.slice(frame.totalLength);
        if (frame.opcode === 0x01) {
          const data = JSON.parse(frame.payload.toString());
          messages.push(data);
          console.log(`[${name}] Received:`, data.type, data.type === "broadcast" ? `from ${data.from}: "${data.message}"` : "");
        } else if (frame.opcode === 0x09) {
          sock.write(maskFrame(frame.payload.toString(), 0x0A));
        }
      }
    });

    sock.on("close", () => console.log(`[${name}] Disconnected`));
    sock.on("error", (err) => { if (!resolved) reject(err); });
  });
}

// Connect two clients
const client1 = await connectClient("Alice");
const client2 = await connectClient("Bob");

await new Promise(r => setTimeout(r, 100));

// Send messages
console.log("\n--- Sending messages ---\n");

client1.send(JSON.stringify({ type: "echo", text: "Hello from Alice" }));
await new Promise(r => setTimeout(r, 50));

client2.send(JSON.stringify({ type: "broadcast", message: "Hi everyone!" }));
await new Promise(r => setTimeout(r, 50));

client1.send(JSON.stringify({ type: "broadcast", message: "Hey Bob!" }));
await new Promise(r => setTimeout(r, 50));

console.log("\n--- Connection stats ---\n");
console.log("Active clients:", wsServer.clients.size);

// Clean shutdown
console.log("\n--- Shutting down ---\n");
client1.close(1000, "Done");
await new Promise(r => setTimeout(r, 50));

client2.close(1000, "Done");
await new Promise(r => setTimeout(r, 50));

clearInterval(heartbeatInterval);
httpServer.close();

console.log("\nServer closed");
```

## Expected Output

```
=== WebSocket Server Demo ===

[ws] Client <id> connected (1 total)
[Alice] Connected
[Alice] Received: welcome
[ws] Client <id> connected (2 total)
[Bob] Connected
[Bob] Received: welcome

--- Sending messages ---

[ws] Message from <id>: {"type":"echo","text":"Hello from Alice"}
[Alice] Received: echo
[ws] Message from <id>: {"type":"broadcast","message":"Hi everyone!"}
[Alice] Received: broadcast from <id>: "Hi everyone!"
[ws] Message from <id>: {"type":"broadcast","message":"Hey Bob!"}
[Bob] Received: broadcast from <id>: "Hey Bob!"

--- Connection stats ---

Active clients: 2

--- Shutting down ---

[ws] Close from <id>: code=1000 reason="Done"
[Alice] Disconnected
[ws] Close from <id>: code=1000 reason="Done"
[Bob] Disconnected

Server closed
```

## Challenge

1. Add room support: clients can join/leave rooms, and broadcasts are scoped to rooms
2. Implement connection authentication: the first message after connect must be `{ type: "auth", token: "..." }`. Disconnect clients that don't authenticate within 5 seconds
3. Add a maximum message size check — reject messages larger than 1 MB and close with code 1009 (Message Too Big)

## Deep Dive

Why build from scratch instead of using `ws`?

The `ws` library is excellent for production. But understanding the protocol internals means you can:
- Debug WebSocket issues at the frame level
- Implement custom extensions (compression, multiplexing)
- Optimize for specific use cases (binary protocols, minimal overhead)
- Understand what's happening when things go wrong

In production, use `ws` — it handles edge cases (fragmentation reassembly, UTF-8 validation, close handshake timeouts, permessage-deflate compression) that our minimal implementation skips.

## Common Mistakes

- Not responding to ping frames with pong — violates the protocol, may cause disconnection
- Sending unmasked frames from client or masked frames from server — protocol violation
- Not buffering partial frames — TCP can deliver half a WebSocket frame
- Forgetting the close handshake — both sides must exchange close frames for a clean shutdown
- Not tracking connections — leaked sockets when clients disconnect abruptly
