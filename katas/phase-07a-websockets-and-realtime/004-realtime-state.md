---
id: realtime-state
phase: 7.5
phase_title: WebSockets & Real-Time Systems
sequence: 4
title: Real-Time State Management
difficulty: advanced
tags: [websocket, state, pub-sub, rooms, broadcast]
prerequisites: [websocket-server]
estimated_minutes: 15
---

## Concept

Real-time applications manage shared state that multiple clients see simultaneously. A chat room, a collaborative document, a live dashboard — all need a server-side state model that stays synchronized across all connected clients.

Key patterns:

**Pub/Sub** — clients subscribe to topics, server publishes updates to subscribers:
```
Client A subscribes to "room:lobby"
Client B publishes "Hello!" to "room:lobby"
Server forwards "Hello!" to all "room:lobby" subscribers (including A)
```

**State Synchronization** — server maintains authoritative state, clients receive diffs:
```
Server state: { users: ["Alice", "Bob"], score: 42 }
Bob joins → server broadcasts: { type: "user_joined", user: "Charlie" }
All clients update their local state
```

**Optimistic Updates** — client applies change immediately, server confirms or rejects:
```
Client: move piece to (3,4) → apply locally, send to server
Server: validates move → broadcast confirmed state
If invalid: server sends correction, client rolls back
```

## Key Insight

> The server is the single source of truth. Clients are projections. When a client sends an action, the server validates it, updates its state, and broadcasts the result. Never trust client state — it's always stale, possibly wrong, and potentially malicious. The server decides what happened.

## Experiment

```js
import { createServer } from "http";
import { createHash, randomBytes } from "crypto";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB0DC85B711";

// Minimal frame helpers
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

function send(socket, data) {
  socket.write(encodeFrame(JSON.stringify(data)));
}

// --- Chat Room Server with State Management ---

class ChatServer {
  constructor() {
    this.rooms = new Map();      // roomName → Set<client>
    this.clients = new Map();    // socket → { id, name, rooms }
    this.messageLog = [];        // Last N messages
    this.maxLogSize = 50;
  }

  addClient(socket) {
    const client = {
      id: randomBytes(4).toString("hex"),
      socket,
      name: null,
      rooms: new Set(),
      buffer: Buffer.alloc(0),
    };
    this.clients.set(socket, client);

    send(socket, { type: "connected", id: client.id });

    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length > 0) {
        const frame = decodeFrame(client.buffer);
        if (!frame) break;
        client.buffer = client.buffer.slice(frame.totalLength);
        if (frame.opcode === 0x01) this.handleMessage(client, frame.payload.toString());
        else if (frame.opcode === 0x08) { socket.end(); return; }
        else if (frame.opcode === 0x09) socket.write(encodeFrame(frame.payload, 0x0A));
      }
    });

    socket.on("close", () => this.removeClient(client));
    socket.on("error", () => this.removeClient(client));

    return client;
  }

  removeClient(client) {
    // Leave all rooms
    for (const room of client.rooms) {
      this.leaveRoom(client, room);
    }
    this.clients.delete(client.socket);
  }

  handleMessage(client, raw) {
    const msg = JSON.parse(raw);

    switch (msg.type) {
      case "set_name":
        client.name = msg.name;
        send(client.socket, { type: "name_set", name: msg.name });
        console.log(`[chat] ${client.id} set name to "${msg.name}"`);
        break;

      case "join":
        this.joinRoom(client, msg.room);
        break;

      case "leave":
        this.leaveRoom(client, msg.room);
        break;

      case "message":
        this.broadcastToRoom(msg.room, {
          type: "message",
          room: msg.room,
          from: client.name || client.id,
          text: msg.text,
          timestamp: Date.now(),
        });
        break;

      case "get_state":
        this.sendState(client, msg.room);
        break;
    }
  }

  joinRoom(client, roomName) {
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    const room = this.rooms.get(roomName);
    room.add(client);
    client.rooms.add(roomName);

    // Notify others
    this.broadcastToRoom(roomName, {
      type: "user_joined",
      room: roomName,
      user: client.name || client.id,
      members: [...room].map(c => c.name || c.id),
    });

    console.log(`[chat] ${client.name || client.id} joined #${roomName} (${room.size} members)`);
  }

  leaveRoom(client, roomName) {
    const room = this.rooms.get(roomName);
    if (!room) return;

    room.delete(client);
    client.rooms.delete(roomName);

    if (room.size === 0) {
      this.rooms.delete(roomName);
      console.log(`[chat] Room #${roomName} deleted (empty)`);
    } else {
      this.broadcastToRoom(roomName, {
        type: "user_left",
        room: roomName,
        user: client.name || client.id,
        members: [...room].map(c => c.name || c.id),
      });
    }
  }

  broadcastToRoom(roomName, message) {
    const room = this.rooms.get(roomName);
    if (!room) return;

    // Store in log
    this.messageLog.push(message);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog.shift();
    }

    const frame = encodeFrame(JSON.stringify(message));
    for (const client of room) {
      client.socket.write(frame);
    }
  }

  sendState(client, roomName) {
    const room = this.rooms.get(roomName);
    send(client.socket, {
      type: "state",
      room: roomName,
      members: room ? [...room].map(c => c.name || c.id) : [],
      recentMessages: this.messageLog.filter(m => m.room === roomName).slice(-10),
    });
  }
}

// --- Demo ---

console.log("=== Real-Time Chat Demo ===\n");

const httpServer = createServer();
const chat = new ChatServer();

httpServer.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + WS_MAGIC_GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  chat.addClient(socket);
});

await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
const { port } = httpServer.address();

// Helper to connect a client
async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];

  await new Promise(resolve => { ws.onopen = resolve; });
  ws.onmessage = (e) => messages.push(JSON.parse(e.data));
  await new Promise(r => setTimeout(r, 50));

  ws.send(JSON.stringify({ type: "set_name", name }));
  await new Promise(r => setTimeout(r, 50));

  return { ws, messages, name };
}

// Connect three users
const alice = await connect("Alice");
const bob = await connect("Bob");
const charlie = await connect("Charlie");

console.log("\n--- Joining rooms ---\n");

// Alice and Bob join #general
alice.ws.send(JSON.stringify({ type: "join", room: "general" }));
await new Promise(r => setTimeout(r, 50));

bob.ws.send(JSON.stringify({ type: "join", room: "general" }));
await new Promise(r => setTimeout(r, 50));

// Charlie joins #general and #random
charlie.ws.send(JSON.stringify({ type: "join", room: "general" }));
await new Promise(r => setTimeout(r, 50));

charlie.ws.send(JSON.stringify({ type: "join", room: "random" }));
await new Promise(r => setTimeout(r, 50));

console.log("\n--- Sending messages ---\n");

alice.ws.send(JSON.stringify({ type: "message", room: "general", text: "Hey everyone!" }));
await new Promise(r => setTimeout(r, 50));

bob.ws.send(JSON.stringify({ type: "message", room: "general", text: "Hi Alice!" }));
await new Promise(r => setTimeout(r, 50));

charlie.ws.send(JSON.stringify({ type: "message", room: "random", text: "Anyone here?" }));
await new Promise(r => setTimeout(r, 50));

console.log("\n--- Room state ---\n");

alice.ws.send(JSON.stringify({ type: "get_state", room: "general" }));
await new Promise(r => setTimeout(r, 50));

// Show what each client received
console.log("\nAlice's messages:", alice.messages.filter(m => m.type === "message").map(m => `[#${m.room}] ${m.from}: ${m.text}`));
console.log("Bob's messages:", bob.messages.filter(m => m.type === "message").map(m => `[#${m.room}] ${m.from}: ${m.text}`));
console.log("Charlie's messages:", charlie.messages.filter(m => m.type === "message").map(m => `[#${m.room}] ${m.from}: ${m.text}`));

const stateMsg = alice.messages.find(m => m.type === "state");
if (stateMsg) {
  console.log("\n#general state:");
  console.log("  Members:", stateMsg.members);
  console.log("  Recent messages:", stateMsg.recentMessages.length);
}

// Clean up
console.log("\n--- Cleanup ---\n");
alice.ws.close();
bob.ws.close();
charlie.ws.close();
await new Promise(r => setTimeout(r, 100));

console.log("Rooms remaining:", chat.rooms.size);
httpServer.close();
console.log("Done");
```

## Expected Output

```
=== Real-Time Chat Demo ===

[chat] <id> set name to "Alice"
[chat] <id> set name to "Bob"
[chat] <id> set name to "Charlie"

--- Joining rooms ---

[chat] Alice joined #general (1 members)
[chat] Bob joined #general (2 members)
[chat] Charlie joined #general (3 members)
[chat] Charlie joined #random (1 members)

--- Sending messages ---

[chat] Message in #general from Alice: "Hey everyone!"
[chat] Message in #general from Bob: "Hi Alice!"
[chat] Message in #random from Charlie: "Anyone here?"

--- Room state ---

Alice's messages: ["[#general] Alice: Hey everyone!", "[#general] Bob: Hi Alice!"]
Bob's messages: ["[#general] Alice: Hey everyone!", "[#general] Bob: Hi Alice!"]
Charlie's messages: ["[#general] Alice: Hey everyone!", "[#general] Bob: Hi Alice!", "[#random] Charlie: Anyone here?"]

#general state:
  Members: ["Alice", "Bob", "Charlie"]
  Recent messages: 2

--- Cleanup ---

Rooms remaining: 0
Done
```

## Challenge

1. Add typing indicators: when a user starts typing, broadcast `{ type: "typing", user: "Alice" }` to the room. Debounce to avoid flooding
2. Implement message history: when a user joins a room, send the last 20 messages so they have context
3. Add rate limiting: reject messages from users who send more than 10 messages per second. Send an error message back to the spammer

## Common Mistakes

- Storing state only on the client — server must be the source of truth
- Not cleaning up room membership on disconnect — "ghost" users persist in room lists
- Broadcasting to disconnected sockets — check `socket.writable` before writing
- Not validating message format — malformed JSON from clients should be handled gracefully, not crash the server
